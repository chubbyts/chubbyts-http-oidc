import type {
  CryptoKey,
  ExportedJWKSCache,
  FlattenedJWSInput,
  JSONWebKeySet,
  JWKSCacheInput,
  JWSHeaderParameters,
  JWTPayload,
  JWTVerifyGetKey,
} from 'jose';
import { createLocalJWKSet, createRemoteJWKSet, customFetch, errors, jwksCache, jwtVerify } from 'jose';
import type { ServerRequest } from '@chubbyts/chubbyts-http-types/message';
import type { MessageHelpers } from '@chubbyts/chubbyts-http-types/message-helper';
import type { OidcConfigurationResolver } from './discovery.js';
import { InvalidTokenError, JwksError } from './error.js';

export type TokenExtractor = (request: ServerRequest) => string | undefined;

export const createBearerTokenExtractor = (messageHelpers: MessageHelpers): TokenExtractor => {
  return (request: ServerRequest): string | undefined => {
    const values = messageHelpers.getHeader(request, 'authorization');

    // authorization is a singleton field (RFC 9110 5.5): with multiple values it is ambiguous which one to use
    if (values.length !== 1) {
      return undefined;
    }

    // b64token (rfc 6750 2.1): anything else (control chars, ...) is not a bearer token
    const match = /^Bearer +([\w\-.~+/]+=*)$/i.exec(values[0]);

    return match ? match[1] : undefined;
  };
};

export type TokenVerifier = (token: string) => Promise<JWTPayload>;

export type JwtTokenVerifierOptions = {
  audience: string | Array<string>;
  algorithms?: Array<string>;
  clockTolerance?: number;
  typ?: string;
  requiredClaims?: Array<string>;
  fetch?: typeof globalThis.fetch;
  jwksMaxAge?: number;
  jwksTimeout?: number;
  jwksCooldown?: number;
  jwksMaxStale?: number;
};

/**
 * All asymmetric signature algorithms supported by jose. Symmetric algorithms (HS*) are not supported at all: a
 * public (jwks) key must never be usable as a hmac secret (algorithm confusion).
 */
export const SUPPORTED_ALGORITHMS: ReadonlyArray<string> = [
  'EdDSA',
  'Ed25519',
  'ES256',
  'ES384',
  'ES512',
  'ML-DSA-44',
  'ML-DSA-65',
  'ML-DSA-87',
  'PS256',
  'PS384',
  'PS512',
  'RS256',
  'RS384',
  'RS512',
];

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value !== '';

const isNonEmptyAudience = (value: unknown): value is string | Array<string> => {
  return isNonEmptyString(value) || (Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString));
};

const isNonEmptyStringArray = (value: unknown): value is Array<string> => {
  return Array.isArray(value) && value.every(isNonEmptyString);
};

const quote = (values: ReadonlyArray<string>): string => values.map((value) => `"${value}"`).join(', ');

// typescript enforces a number, but a runtime check protects javascript consumers (or a misconfigured string) from a
// duration that silently ends up as NaN (a cache which is never valid, ...)
const assertNonNegative = (name: string, value: number): void => {
  if (typeof value !== 'number' || Number.isNaN(value) || value < 0) {
    throw new Error(`Invalid ${name} ${String(value)}: must be a non-negative number of seconds`);
  }
};

// AbortSignal.timeout() throws for Infinity
const assertFiniteNonNegative = (name: string, value: number): void => {
  assertNonNegative(name, value);

  if (!Number.isFinite(value)) {
    throw new TypeError(`Invalid ${name} ${String(value)}: must be a finite number of seconds`);
  }
};

const assertPositive = (name: string, value: number): void => {
  assertNonNegative(name, value);

  if (value === 0) {
    throw new Error(`Invalid ${name} 0: must be a positive number of seconds`);
  }
};

/**
 * A larger clock tolerance is most likely a misconfiguration (milliseconds instead of seconds) and would silently
 * accept long expired tokens.
 */
export const MAX_CLOCK_TOLERANCE = 300;

const assertClockTolerance = (value: number): void => {
  assertFiniteNonNegative('clockTolerance', value);

  if (value > MAX_CLOCK_TOLERANCE) {
    throw new Error(`Invalid clockTolerance ${String(value)}: must be at most ${MAX_CLOCK_TOLERANCE} seconds`);
  }
};

const assertSupportedAlgorithms = (algorithms: unknown): void => {
  if (algorithms === undefined) {
    return;
  }

  // an empty array would silently reject every token
  if (!Array.isArray(algorithms) || algorithms.length === 0) {
    throw new Error('Invalid algorithms: must be a non-empty array of supported (asymmetric) algorithms');
  }

  const unsupportedAlgorithms = algorithms.filter((algorithm) => !SUPPORTED_ALGORITHMS.includes(algorithm as string));

  if (unsupportedAlgorithms.length > 0) {
    throw new Error(
      `Unsupported algorithms ${quote(unsupportedAlgorithms.map(String))}, supported (asymmetric) algorithms are ${quote(
        SUPPORTED_ALGORITHMS,
      )}`,
    );
  }
};

const isFetchedJwksCache = (cache: JWKSCacheInput): cache is ExportedJWKSCache => typeof cache.uat === 'number';

const isTokenError = (error: unknown): error is errors.JOSEError => {
  return (
    error instanceof errors.JWTInvalid ||
    error instanceof errors.JWSInvalid ||
    error instanceof errors.JWTExpired ||
    error instanceof errors.JWTClaimValidationFailed ||
    error instanceof errors.JOSEAlgNotAllowed ||
    error instanceof errors.JOSENotSupported ||
    error instanceof errors.JWKSNoMatchingKey ||
    // ambiguous key selection (e.g. token without "kid" against a jwks with multiple keys of the same alg): the token
    // cannot be verified, treat it like a token without a matching key instead of an internal error
    error instanceof errors.JWKSMultipleMatchingKeys ||
    error instanceof errors.JWSSignatureVerificationFailed
  );
};

export const createJwtTokenVerifier = (
  oidcConfigurationResolver: OidcConfigurationResolver,
  options: JwtTokenVerifierOptions,
): TokenVerifier => {
  // typescript enforces the audience, but a runtime check protects javascript consumers (or a misconfigured
  // "undefined") from silently skipping the audience check and accepting any token of the issuer
  if (!isNonEmptyAudience(options.audience)) {
    throw new Error('Invalid audience: must be a non-empty string or a non-empty array of non-empty strings');
  }

  assertSupportedAlgorithms(options.algorithms);

  // jose would only fail on verification time with an obscure error (or a misleading "typ" mismatch)
  if (options.typ !== undefined && !isNonEmptyString(options.typ)) {
    throw new Error('Invalid typ: must be a non-empty string');
  }

  if (options.requiredClaims !== undefined && !isNonEmptyStringArray(options.requiredClaims)) {
    throw new Error('Invalid requiredClaims: must be an array of non-empty strings');
  }

  // jose rejects symmetric algorithms for a jwks anyway, but an explicit allow-list does not rely on that
  const algorithms = options.algorithms ?? [...SUPPORTED_ALGORITHMS];

  // "iss" and "aud" get required by jose through the issuer / audience options, "exp" needs to be required explicitly,
  // otherwise a token without expiration would be valid forever
  const requiredClaims = ['exp', ...(options.requiredClaims ?? [])];

  const {
    clockTolerance = 0,
    jwksMaxAge = 600,
    jwksTimeout = 5,
    jwksCooldown = 30,
    // bounded by default: a key the issuer removed (e.g. a compromised one) must not stay valid for as long as a jwks
    // outage lasts, Infinity trades this for availability
    jwksMaxStale = 3600,
  } = options;

  assertClockTolerance(clockTolerance);
  // jose treats a jwks with a max age of 0 as always expired: it would get refetched with every verification
  assertPositive('jwksMaxAge', jwksMaxAge);
  assertFiniteNonNegative('jwksTimeout', jwksTimeout);
  assertNonNegative('jwksCooldown', jwksCooldown);
  assertNonNegative('jwksMaxStale', jwksMaxStale);

  const createJwkSetResolver = (jwksUri: string): JWTVerifyGetKey => {
    // jose stores each successfully fetched jwks together with its fetch time ("uat") in here
    const fetchedJwksCache: JWKSCacheInput = {};

    const remoteJwkSet = createRemoteJWKSet(new URL(jwksUri), {
      ...(options.fetch ? { [customFetch]: options.fetch } : {}),
      cacheMaxAge: jwksMaxAge * 1000,
      // jose requires an integer, but seconds to milliseconds is not always one (2.01 * 1000 = 2009.9999999999998)
      timeoutDuration: Math.round(jwksTimeout * 1000),
      cooldownDuration: jwksCooldown * 1000,
      [jwksCache]: fetchedJwksCache,
    });

    // oxlint-disable-next-line functional/no-let
    let failure: { error: unknown; retryAfter: number } | undefined;

    // oxlint-disable-next-line functional/no-let
    let staleJwkSet: { jwks: JSONWebKeySet; resolve: ReturnType<typeof createLocalJWKSet> } | undefined;

    // a jwks outage should not take the resource server down: jose does not serve a stale jwks once its cache expired,
    // so verify against the last known keys (if there ever were any) instead of failing, but only for jwksMaxStale
    // after the cache expired: a key the issuer removed since (e.g. a compromised one) must not stay valid for as long
    // as the outage lasts
    const resolveStaleKey = async (
      protectedHeader: JWSHeaderParameters,
      token: FlattenedJWSInput,
      error: unknown,
    ): Promise<CryptoKey> => {
      if (
        !isFetchedJwksCache(fetchedJwksCache) ||
        Date.now() >= fetchedJwksCache.uat + (jwksMaxAge + jwksMaxStale) * 1000
      ) {
        throw error;
      }

      const { jwks } = fetchedJwksCache;

      // importing the keys is not for free, do it once per fetched jwks instead of once per verification
      if (staleJwkSet?.jwks !== jwks) {
        staleJwkSet = { jwks, resolve: createLocalJWKSet(jwks) };
      }

      return staleJwkSet.resolve(protectedHeader, token);
    };

    return async (protectedHeader: JWSHeaderParameters, token: FlattenedJWSInput): Promise<CryptoKey> => {
      // fail fast (or serve stale) during an outage instead of hitting the jwks uri with every request
      if (failure && failure.retryAfter > Date.now()) {
        return resolveStaleKey(protectedHeader, token, failure.error);
      }

      try {
        return await remoteJwkSet(protectedHeader, token);
      } catch (error) {
        if (isTokenError(error)) {
          throw error;
        }

        // any other jose error is about the jwks itself (non 200 status, timeout, invalid json, malformed keys),
        // errors of the fetch implementation (unreachable jwks uri, ...) are passed through as they are
        const jwksError = error instanceof errors.JOSEError ? new JwksError(error.message, error) : error;

        failure = { error: jwksError, retryAfter: Date.now() + jwksCooldown * 1000 };

        return resolveStaleKey(protectedHeader, token, jwksError);
      }
    };
  };

  // oxlint-disable-next-line functional/no-let
  let cache: { jwksUri: string; jwkSetResolver: JWTVerifyGetKey } | undefined;

  const resolveJwkSet = (jwksUri: string): JWTVerifyGetKey => {
    if (cache?.jwksUri === jwksUri) {
      return cache.jwkSetResolver;
    }

    const jwkSetResolver = createJwkSetResolver(jwksUri);

    // oxlint-disable-next-line functional/immutable-data
    cache = { jwksUri, jwkSetResolver };

    return jwkSetResolver;
  };

  return async (token: string): Promise<JWTPayload> => {
    const configuration = await oidcConfigurationResolver();

    try {
      const { payload } = await jwtVerify(token, resolveJwkSet(configuration.jwks_uri), {
        issuer: configuration.issuer,
        audience: options.audience,
        algorithms,
        clockTolerance,
        typ: options.typ,
        requiredClaims,
      });

      return payload;
    } catch (error) {
      if (isTokenError(error)) {
        throw new InvalidTokenError(error.message, error);
      }

      throw error;
    }
  };
};
