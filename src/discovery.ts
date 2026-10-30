import { OidcConfigurationError } from './error.js';

export type OidcConfiguration = {
  issuer: string;
  jwks_uri: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  userinfo_endpoint?: string;
  end_session_endpoint?: string;
  [key: string]: unknown;
};

export type OidcConfigurationResolver = () => Promise<OidcConfiguration>;

export type OidcConfigurationResolverOptions = {
  fetch?: typeof globalThis.fetch;
  maxAge?: number;
  timeout?: number;
  cooldown?: number;
};

const stripTrailingSlashes = (value: string): string => {
  return value.endsWith('/') ? stripTrailingSlashes(value.slice(0, -1)) : value;
};

// an absolute url with a http or https scheme (an issuer or a jwks uri with any other scheme makes no sense for a
// discovery / jwks fetch)
const isHttpUrl = (value: unknown): value is string => {
  return typeof value === 'string' && URL.canParse(value) && ['http:', 'https:'].includes(new URL(value).protocol);
};

const isHttpsUrl = (value: string): boolean => new URL(value).protocol === 'https:';

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const isTimeoutError = (error: unknown): boolean => {
  return error instanceof Error && error.name === 'TimeoutError';
};

// a string as is, anything else by its type (for error messages)
const describe = (value: unknown): string => {
  if (typeof value === 'string') {
    return value;
  }

  return value === null ? 'null' : typeof value;
};

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

export const createOidcConfigurationResolver = (
  issuer: string,
  options: OidcConfigurationResolverOptions = {},
): OidcConfigurationResolver => {
  const { fetch = globalThis.fetch, maxAge = 3600, timeout = 5, cooldown = 30 } = options;

  if (!isHttpUrl(issuer)) {
    throw new Error(`Invalid issuer "${issuer}": must be an absolute http(s) url`);
  }

  assertNonNegative('maxAge', maxAge);
  assertFiniteNonNegative('timeout', timeout);
  assertNonNegative('cooldown', cooldown);

  const url = `${stripTrailingSlashes(issuer)}/.well-known/openid-configuration`;

  // oxlint-disable-next-line functional/no-let
  let cache: { configuration: OidcConfiguration; validUntil: number } | undefined;

  // oxlint-disable-next-line functional/no-let
  let failure: { error: unknown; retryAfter: number } | undefined;

  // oxlint-disable-next-line functional/no-let
  let pending: Promise<OidcConfiguration> | undefined;

  const fetchConfiguration = async (): Promise<OidcConfiguration> => {
    // the discovery endpoint should not redirect (the issuer has to match exactly anyway), and following redirects
    // would silently bypass the https checks below (https -> http redirect)
    const response = await fetch(url, { signal: AbortSignal.timeout(timeout * 1000), redirect: 'manual' }).catch(
      (error: unknown) => {
        if (isTimeoutError(error)) {
          throw new OidcConfigurationError(
            `Cannot fetch oidc configuration from "${url}": timeout after ${timeout}s`,
            error,
          );
        }

        throw error;
      },
    );

    if (!response.ok) {
      // release the connection instead of waiting for the garbage collector
      await response.body?.cancel().catch(() => undefined);

      throw new OidcConfigurationError(`Cannot fetch oidc configuration from "${url}": status ${response.status}`);
    }

    const configuration: unknown = await response.json().catch((error: unknown) => {
      throw new OidcConfigurationError(`Cannot fetch oidc configuration from "${url}": invalid json`, error);
    });

    if (!isObject(configuration)) {
      throw new OidcConfigurationError(`Cannot fetch oidc configuration from "${url}": invalid json`);
    }

    if (configuration.issuer !== issuer) {
      throw new OidcConfigurationError(
        `Issuer mismatch: expected "${issuer}", given "${describe(configuration.issuer)}"`,
      );
    }

    // fail here with a clear message instead of an obscure error on the first token verification
    if (!isHttpUrl(configuration.jwks_uri)) {
      throw new OidcConfigurationError(
        `Missing or invalid jwks_uri "${describe(configuration.jwks_uri)}" for issuer "${issuer}"`,
      );
    }

    // a https issuer must not downgrade its keys to plain http (mitm on the jwks fetch means forged tokens)
    if (isHttpsUrl(issuer) && !isHttpsUrl(configuration.jwks_uri)) {
      throw new OidcConfigurationError(`Insecure jwks_uri "${configuration.jwks_uri}" for https issuer "${issuer}"`);
    }

    return configuration as OidcConfiguration;
  };

  // an issuer outage should not take the resource server down: keep serving the last known configuration (the jwks
  // itself is fetched and cached separately) and only fail if there never was one
  const resolveStaleConfiguration = (error: unknown): OidcConfiguration => {
    if (cache) {
      return cache.configuration;
    }

    throw error;
  };

  const resolveConfiguration = async (): Promise<OidcConfiguration> => {
    try {
      const configuration = await fetchConfiguration();

      cache = { configuration, validUntil: Date.now() + maxAge * 1000 };
      failure = undefined;

      return configuration;
    } catch (error) {
      // fail fast during an outage instead of hitting the issuer with every request
      failure = { error, retryAfter: Date.now() + cooldown * 1000 };

      return resolveStaleConfiguration(error);
    } finally {
      pending = undefined;
    }
  };

  return async (): Promise<OidcConfiguration> => {
    if (cache && cache.validUntil > Date.now()) {
      return cache.configuration;
    }

    if (failure && failure.retryAfter > Date.now()) {
      return resolveStaleConfiguration(failure.error);
    }

    // concurrent cache misses share one in-flight request
    pending ??= resolveConfiguration();

    return pending;
  };
};
