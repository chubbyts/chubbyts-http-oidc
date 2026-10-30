import { expect, test, vi } from 'vitest';
import type * as jose from 'jose';
import type { CryptoKey } from 'jose';
import { CompactSign, SignJWT, createLocalJWKSet, errors, exportJWK, generateKeyPair } from 'jose';
import { useFunctionMock } from '@chubbyts/chubbyts-function-mock/dist/function-mock';
import { useObjectMock } from '@chubbyts/chubbyts-function-mock/dist/object-mock';
import type { ServerRequest } from '@chubbyts/chubbyts-http-types/message';
import type { MessageHelpers } from '@chubbyts/chubbyts-http-types/message-helper';
import type { OidcConfiguration, OidcConfigurationResolver } from '../../src/discovery.js';
import type { JwtTokenVerifierOptions } from '../../src/token.js';
import {
  MAX_CLOCK_TOLERANCE,
  SUPPORTED_ALGORITHMS,
  createBearerTokenExtractor,
  createJwtTokenVerifier,
} from '../../src/token.js';
import { InvalidTokenError, JwksError } from '../../src/error.js';

// spy (pass through) to assert how often a stale jwks gets imported
vi.mock('jose', async (importOriginal) => {
  const original = await importOriginal<typeof jose>();

  return { ...original, createLocalJWKSet: vi.fn(original.createLocalJWKSet) };
});

test.each<{ name: string; authorization: Array<string>; expectedToken: string | undefined }>([
  { name: 'without authorization header', authorization: [], expectedToken: undefined },
  { name: 'with other authorization scheme', authorization: ['Basic dXNlcjpwYXNzd29yZA=='], expectedToken: undefined },
  { name: 'without token', authorization: ['Bearer'], expectedToken: undefined },
  { name: 'with invalid token', authorization: ['Bearer some token'], expectedToken: undefined },
  { name: 'with prefixed authorization header', authorization: ['prefix Bearer some-token'], expectedToken: undefined },
  { name: 'with token', authorization: ['Bearer some-token'], expectedToken: 'some-token' },
  {
    name: 'with multiple spaces between scheme and token',
    authorization: ['Bearer   some-token'],
    expectedToken: 'some-token',
  },
  {
    name: 'with all b64token chars',
    authorization: ['Bearer aZ09-._~+/=='],
    expectedToken: 'aZ09-._~+/==',
  },
  { name: 'with control char in token', authorization: ['Bearer some\u0000token'], expectedToken: undefined },
  { name: 'with padding in the middle', authorization: ['Bearer some=token'], expectedToken: undefined },
  { name: 'with lowercase scheme', authorization: ['bearer some-token'], expectedToken: 'some-token' },
  {
    name: 'with multiple authorization headers',
    authorization: ['Bearer some-token', 'Bearer other-token'],
    expectedToken: undefined,
  },
])('extract token $name', ({ authorization, expectedToken }) => {
  // the helpers get mocked: the request is never read directly, any implementation can be used
  const serverRequest = { method: 'GET' } as ServerRequest;

  const [messageHelpers, messageHelpersMocks] = useObjectMock<MessageHelpers>([
    { name: 'getHeader', parameters: [serverRequest, 'authorization'], return: authorization },
  ]);

  const tokenExtractor = createBearerTokenExtractor(messageHelpers);

  expect(tokenExtractor(serverRequest)).toBe(expectedToken);

  expect(messageHelpersMocks).toHaveLength(0);
});

const issuer = 'https://issuer.example.com';
const jwksUri = 'https://issuer.example.com/jwks';

const configuration: OidcConfiguration = {
  issuer,
  jwks_uri: jwksUri,
};

const createKeyAndJwks = async (kid = 'key-1'): Promise<{ privateKey: CryptoKey; jwks: unknown }> => {
  const { publicKey, privateKey } = await generateKeyPair('RS256');

  const jwk = await exportJWK(publicKey);

  return { privateKey, jwks: { keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }] } };
};

const createToken = async (
  privateKey: CryptoKey,
  {
    iss,
    aud,
    iat,
    kid,
    typ,
    exp,
    withExp = true,
  }: { iss?: string; aud?: string; iat?: number; kid?: string; typ?: string; exp?: number; withExp?: boolean } = {},
): Promise<string> => {
  const signJwt = new SignJWT({ scope: 'openid' })
    .setProtectedHeader({ alg: 'RS256', kid: kid ?? 'key-1', ...(typ ? { typ } : {}) })
    .setSubject('subject-1')
    .setIssuer(iss ?? issuer)
    .setAudience(aud ?? 'audience-1')
    .setIssuedAt(iat);

  if (withExp) {
    signJwt.setExpirationTime(exp ?? (iat ?? Math.floor(Date.now() / 1000)) + 300);
  }

  return signJwt.sign(privateKey);
};

const createJwksResponse = (jwks: unknown): Response => {
  return new Response(JSON.stringify(jwks), { headers: { 'content-type': 'application/json' } });
};

const expectInvalidTokenError = async (
  promise: Promise<unknown>,
  message: string,
  causeClass: new (...parameters: Array<never>) => Error,
): Promise<void> => {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );

  expect(error).toBeInstanceOf(InvalidTokenError);
  expect((error as InvalidTokenError).name).toBe('InvalidTokenError');
  expect((error as InvalidTokenError).message).toBe(message);
  expect((error as InvalidTokenError).cause).toBeInstanceOf(causeClass);
  expect(((error as InvalidTokenError).cause as Error).message).toBe(message);
};

test.each<{ name: string; audience: unknown }>([
  { name: 'undefined', audience: undefined },
  { name: 'empty string', audience: '' },
  { name: 'empty array', audience: [] },
  { name: 'array with empty string', audience: ['audience-1', ''] },
  { name: 'non string', audience: 123 },
])('create verifier with invalid audience: $name', ({ audience }) => {
  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([]);

  expect(() => createJwtTokenVerifier(oidcConfigurationResolver, { audience: audience as string })).toThrow(
    'Invalid audience: must be a non-empty string or a non-empty array of non-empty strings',
  );

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
});

const expectJwksError = async (
  promise: Promise<unknown>,
  message: string,
  causeClass: new (...parameters: Array<never>) => Error,
): Promise<void> => {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );

  expect(error).toBeInstanceOf(JwksError);
  expect((error as JwksError).name).toBe('JwksError');
  expect((error as JwksError).message).toBe(message);
  expect((error as JwksError).cause).toBeInstanceOf(causeClass);
  expect(((error as JwksError).cause as Error).message).toBe(message);
};

test.each<{ name: string; algorithms: unknown; message: string }>([
  {
    name: 'empty array',
    algorithms: [],
    message: 'Invalid algorithms: must be a non-empty array of supported (asymmetric) algorithms',
  },
  {
    name: 'non array',
    algorithms: 'RS256',
    message: 'Invalid algorithms: must be a non-empty array of supported (asymmetric) algorithms',
  },
  {
    name: 'symmetric algorithm',
    algorithms: ['RS256', 'HS256'],
    message: `Unsupported algorithms "HS256", supported (asymmetric) algorithms are ${SUPPORTED_ALGORITHMS.map(
      (algorithm) => `"${algorithm}"`,
    ).join(', ')}`,
  },
  {
    name: 'unknown and non string algorithms',
    algorithms: ['none', 42],
    message: `Unsupported algorithms "none", "42", supported (asymmetric) algorithms are ${SUPPORTED_ALGORITHMS.map(
      (algorithm) => `"${algorithm}"`,
    ).join(', ')}`,
  },
])('create verifier with invalid algorithms: $name', ({ algorithms, message }) => {
  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([]);

  expect(() =>
    createJwtTokenVerifier(oidcConfigurationResolver, {
      audience: 'audience-1',
      algorithms: algorithms as Array<string>,
    }),
  ).toThrow(message);

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
});

test('create verifier with all supported algorithms', () => {
  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([]);

  expect(SUPPORTED_ALGORITHMS).toEqual([
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
  ]);

  expect(
    createJwtTokenVerifier(oidcConfigurationResolver, {
      audience: 'audience-1',
      algorithms: [...SUPPORTED_ALGORITHMS],
    }),
  ).toBeInstanceOf(Function);

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
});

test.each<{ name: string; options: Record<string, unknown>; message: string }>([
  {
    name: 'clockTolerance',
    options: { clockTolerance: -1 },
    message: 'Invalid clockTolerance -1: must be a non-negative number of seconds',
  },
  {
    name: 'clockTolerance infinite',
    options: { clockTolerance: Number.POSITIVE_INFINITY },
    message: 'Invalid clockTolerance Infinity: must be a finite number of seconds',
  },
  {
    name: 'clockTolerance too large',
    options: { clockTolerance: 301 },
    message: 'Invalid clockTolerance 301: must be at most 300 seconds',
  },
  {
    name: 'typ',
    options: { typ: 42 },
    message: 'Invalid typ: must be a non-empty string',
  },
  {
    name: 'typ empty',
    options: { typ: '' },
    message: 'Invalid typ: must be a non-empty string',
  },
  {
    name: 'requiredClaims',
    options: { requiredClaims: 42 },
    message: 'Invalid requiredClaims: must be an array of non-empty strings',
  },
  {
    name: 'requiredClaims with empty claim',
    options: { requiredClaims: ['sub', ''] },
    message: 'Invalid requiredClaims: must be an array of non-empty strings',
  },
  {
    name: 'jwksMaxAge zero',
    options: { jwksMaxAge: 0 },
    message: 'Invalid jwksMaxAge 0: must be a positive number of seconds',
  },
  {
    name: 'jwksMaxAge',
    options: { jwksMaxAge: -1 },
    message: 'Invalid jwksMaxAge -1: must be a non-negative number of seconds',
  },
  {
    name: 'jwksMaxAge as string',
    options: { jwksMaxAge: '600' },
    message: 'Invalid jwksMaxAge 600: must be a non-negative number of seconds',
  },
  {
    name: 'jwksTimeout',
    options: { jwksTimeout: -0.5 },
    message: 'Invalid jwksTimeout -0.5: must be a non-negative number of seconds',
  },
  {
    name: 'jwksTimeout infinite',
    options: { jwksTimeout: Number.POSITIVE_INFINITY },
    message: 'Invalid jwksTimeout Infinity: must be a finite number of seconds',
  },
  {
    name: 'jwksCooldown',
    options: { jwksCooldown: Number.NaN },
    message: 'Invalid jwksCooldown NaN: must be a non-negative number of seconds',
  },
  {
    name: 'jwksMaxStale',
    options: { jwksMaxStale: -1 },
    message: 'Invalid jwksMaxStale -1: must be a non-negative number of seconds',
  },
])('create verifier with invalid option: $name', ({ options, message }) => {
  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([]);

  expect(() =>
    createJwtTokenVerifier(oidcConfigurationResolver, {
      audience: 'audience-1',
      ...(options as Partial<JwtTokenVerifierOptions>),
    }),
  ).toThrow(message);

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
});

test('create verifier with infinite durations and max clock tolerance', () => {
  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([]);

  expect(
    createJwtTokenVerifier(oidcConfigurationResolver, {
      audience: 'audience-1',
      clockTolerance: MAX_CLOCK_TOLERANCE,
      jwksMaxAge: Number.POSITIVE_INFINITY,
      jwksCooldown: Number.POSITIVE_INFINITY,
      jwksMaxStale: Number.POSITIVE_INFINITY,
    }),
  ).toBeInstanceOf(Function);

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
});

test('verify token', async () => {
  const { privateKey, jwks } = await createKeyAndJwks();

  const token = await createToken(privateKey);

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async (input) => {
        expect(String(input)).toBe(jwksUri);

        return createJwksResponse(jwks);
      },
    },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, { audience: 'audience-1', fetch });

  expect(await tokenVerifier(token)).toEqual(
    expect.objectContaining({ iss: issuer, aud: 'audience-1', sub: 'subject-1', scope: 'openid' }),
  );

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify token with audience array', async () => {
  const { privateKey, jwks } = await createKeyAndJwks();

  const token = await createToken(privateKey);

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async () => createJwksResponse(jwks),
    },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, {
    audience: ['audience-2', 'audience-1'],
    fetch,
  });

  expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ aud: 'audience-1', sub: 'subject-1' }));

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify token with cached jwk set', async () => {
  const { privateKey, jwks } = await createKeyAndJwks();

  const token = await createToken(privateKey);

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async (input) => {
        expect(String(input)).toBe(jwksUri);

        return createJwksResponse(jwks);
      },
    },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, { audience: 'audience-1', fetch });

  expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
  expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify token with changed jwks uri', async () => {
  const otherJwksUri = 'https://issuer.example.com/other-jwks';

  const { privateKey, jwks } = await createKeyAndJwks();

  const token = await createToken(privateKey);

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
    { parameters: [], return: Promise.resolve({ ...configuration, jwks_uri: otherJwksUri }) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async (input) => {
        expect(String(input)).toBe(jwksUri);

        return createJwksResponse(jwks);
      },
    },
    {
      callback: async (input) => {
        expect(String(input)).toBe(otherJwksUri);

        return createJwksResponse(jwks);
      },
    },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, { audience: 'audience-1', fetch });

  expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
  expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify token with invalid issuer', async () => {
  const { privateKey, jwks } = await createKeyAndJwks();

  const token = await createToken(privateKey, { iss: 'https://other-issuer.example.com' });

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async () => createJwksResponse(jwks),
    },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, { audience: 'audience-1', fetch });

  await expectInvalidTokenError(tokenVerifier(token), 'unexpected "iss" claim value', errors.JWTClaimValidationFailed);

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify token with invalid audience', async () => {
  const { privateKey, jwks } = await createKeyAndJwks();

  const token = await createToken(privateKey, { aud: 'audience-2' });

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async () => createJwksResponse(jwks),
    },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, { audience: 'audience-1', fetch });

  await expectInvalidTokenError(tokenVerifier(token), 'unexpected "aud" claim value', errors.JWTClaimValidationFailed);

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify expired token', async () => {
  const { privateKey, jwks } = await createKeyAndJwks();

  // expired 60 seconds ago
  const token = await createToken(privateKey, { iat: Math.floor(Date.now() / 1000) - 360 });

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async () => createJwksResponse(jwks),
    },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, { audience: 'audience-1', fetch });

  await expectInvalidTokenError(tokenVerifier(token), '"exp" claim timestamp check failed', errors.JWTExpired);

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify expired token within clock tolerance', async () => {
  const { privateKey, jwks } = await createKeyAndJwks();

  // expired 60 seconds ago
  const token = await createToken(privateKey, { iat: Math.floor(Date.now() / 1000) - 360 });

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async () => createJwksResponse(jwks),
    },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, {
    audience: 'audience-1',
    clockTolerance: 120,
    fetch,
  });

  expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify token without expiration', async () => {
  const { privateKey, jwks } = await createKeyAndJwks();

  const token = await createToken(privateKey, { withExp: false });

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async () => createJwksResponse(jwks),
    },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, { audience: 'audience-1', fetch });

  await expectInvalidTokenError(tokenVerifier(token), 'missing required "exp" claim', errors.JWTClaimValidationFailed);

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify token with missing required claim', async () => {
  const { privateKey, jwks } = await createKeyAndJwks();

  const token = await createToken(privateKey);

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async () => createJwksResponse(jwks),
    },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, {
    audience: 'audience-1',
    requiredClaims: ['sub', 'jti'],
    fetch,
  });

  await expectInvalidTokenError(tokenVerifier(token), 'missing required "jti" claim', errors.JWTClaimValidationFailed);

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify token with matching typ', async () => {
  const { privateKey, jwks } = await createKeyAndJwks();

  const token = await createToken(privateKey, { typ: 'at+jwt' });

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async () => createJwksResponse(jwks),
    },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, {
    audience: 'audience-1',
    typ: 'at+jwt',
    fetch,
  });

  expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test.each<{ name: string; typ: string | undefined }>([
  { name: 'without typ', typ: undefined },
  { name: 'with other typ', typ: 'JWT' },
])('verify token $name and expected typ', async ({ typ }) => {
  const { privateKey, jwks } = await createKeyAndJwks();

  const token = await createToken(privateKey, { typ });

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async () => createJwksResponse(jwks),
    },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, {
    audience: 'audience-1',
    typ: 'at+jwt',
    fetch,
  });

  await expectInvalidTokenError(
    tokenVerifier(token),
    'unexpected "typ" JWT header value',
    errors.JWTClaimValidationFailed,
  );

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify token with not allowed algorithm', async () => {
  const { privateKey } = await createKeyAndJwks();

  const token = await createToken(privateKey);

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, {
    audience: 'audience-1',
    algorithms: ['ES256'],
    fetch,
  });

  await expectInvalidTokenError(
    tokenVerifier(token),
    '"alg" (Algorithm) Header Parameter value not allowed',
    errors.JOSEAlgNotAllowed,
  );

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify invalid token with default options', async () => {
  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, { audience: 'audience-1' });

  await expectInvalidTokenError(tokenVerifier('invalid'), 'Invalid Compact JWS', errors.JWSInvalid);

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
});

test('verify token with non json payload', async () => {
  const { privateKey, jwks } = await createKeyAndJwks();

  const token = await new CompactSign(new TextEncoder().encode('not json'))
    .setProtectedHeader({ alg: 'RS256', kid: 'key-1' })
    .sign(privateKey);

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async () => createJwksResponse(jwks),
    },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, { audience: 'audience-1', fetch });

  await expectInvalidTokenError(
    tokenVerifier(token),
    'JWT Claims Set must be a top-level JSON object',
    errors.JWTInvalid,
  );

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify token with unsupported algorithm', async () => {
  const token = await new SignJWT({ scope: 'openid' })
    .setProtectedHeader({ alg: 'HS256', kid: 'key-1' })
    .setIssuer(issuer)
    .setAudience('audience-1')
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode('some-secret-which-is-at-least-32-bytes-long'));

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  // rejected by the default algorithms allow-list, before the jwks gets fetched
  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, { audience: 'audience-1', fetch });

  await expectInvalidTokenError(
    tokenVerifier(token),
    '"alg" (Algorithm) Header Parameter value not allowed',
    errors.JOSEAlgNotAllowed,
  );

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify token with unknown key id', async () => {
  const { privateKey, jwks } = await createKeyAndJwks();

  const token = await createToken(privateKey, { kid: 'key-2' });

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async () => createJwksResponse(jwks),
    },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, { audience: 'audience-1', fetch });

  await expectInvalidTokenError(
    tokenVerifier(token),
    'no applicable key found in the JSON Web Key Set',
    errors.JWKSNoMatchingKey,
  );

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify token without key id against jwks with multiple matching keys', async () => {
  const { privateKey, jwks } = await createKeyAndJwks();
  const { jwks: otherJwks } = await createKeyAndJwks();

  const token = await new SignJWT({ scope: 'openid' })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject('subject-1')
    .setIssuer(issuer)
    .setAudience('audience-1')
    .setExpirationTime(Math.floor(Date.now() / 1000) + 300)
    .sign(privateKey);

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async () =>
        createJwksResponse({
          keys: [
            ...(jwks as { keys: Array<unknown> }).keys,
            ...(otherJwks as { keys: Array<{ kid: string }> }).keys.map((key) => ({ ...key, kid: 'key-2' })),
          ],
        }),
    },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, { audience: 'audience-1', fetch });

  await expectInvalidTokenError(
    tokenVerifier(token),
    'multiple matching keys found in the JSON Web Key Set',
    errors.JWKSMultipleMatchingKeys,
  );

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify token with invalid signature', async () => {
  const { jwks } = await createKeyAndJwks();
  const { privateKey: otherPrivateKey } = await createKeyAndJwks();

  const token = await createToken(otherPrivateKey);

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async () => createJwksResponse(jwks),
    },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, { audience: 'audience-1', fetch });

  await expectInvalidTokenError(
    tokenVerifier(token),
    'signature verification failed',
    errors.JWSSignatureVerificationFailed,
  );

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify token with failing oidc configuration resolver', async () => {
  const { privateKey } = await createKeyAndJwks();

  const token = await createToken(privateKey);

  const error = new Error('Cannot fetch oidc configuration from "https://issuer.example.com": status 500');

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], error },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, { audience: 'audience-1', fetch });

  await expect(tokenVerifier(token)).rejects.toBe(error);

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify token with unreachable jwks uri', async () => {
  const { privateKey } = await createKeyAndJwks();

  const token = await createToken(privateKey);

  const error = new TypeError('fetch failed');

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async () => Promise.reject(error),
    },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, { audience: 'audience-1', fetch });

  await expect(tokenVerifier(token)).rejects.toBe(error);

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify token with failing jwks uri', async () => {
  const { privateKey } = await createKeyAndJwks();

  const token = await createToken(privateKey);

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async () => new Response('Internal Server Error', { status: 500 }),
    },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, { audience: 'audience-1', fetch });

  await expectJwksError(
    tokenVerifier(token),
    'Expected 200 OK from the JSON Web Key Set HTTP response',
    errors.JOSEError,
  );

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify token with invalid jwks json', async () => {
  const { privateKey } = await createKeyAndJwks();

  const token = await createToken(privateKey);

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async () => new Response('{', { headers: { 'content-type': 'application/json' } }),
    },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, { audience: 'audience-1', fetch });

  await expectJwksError(
    tokenVerifier(token),
    'Failed to parse the JSON Web Key Set HTTP response as JSON',
    errors.JOSEError,
  );

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test.each<{ name: string; jwks: unknown }>([
  { name: 'non object', jwks: 'keys' },
  { name: 'without keys', jwks: {} },
  { name: 'with non array keys', jwks: { keys: 'key' } },
  { name: 'with non object key', jwks: { keys: ['key'] } },
])('verify token with malformed jwks: $name', async ({ jwks }) => {
  const { privateKey } = await createKeyAndJwks();

  const token = await createToken(privateKey);

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async () => createJwksResponse(jwks),
    },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, { audience: 'audience-1', fetch });

  await expectJwksError(tokenVerifier(token), 'JSON Web Key Set malformed', errors.JWKSInvalid);

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify token with jwks timeout', async () => {
  const { privateKey } = await createKeyAndJwks();

  const token = await createToken(privateKey);

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async (_input, init) => {
        const signal = init?.signal as AbortSignal;

        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason as Error));
        });
      },
    },
  ]);

  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, {
    audience: 'audience-1',
    fetch,
    jwksTimeout: 0.05,
  });

  const start = performance.now();

  const error: unknown = await tokenVerifier(token).then(
    () => undefined,
    (e: unknown) => e,
  );

  const duration = performance.now() - start;

  expect(error).toBeInstanceOf(JwksError);
  expect((error as JwksError).message).toBe('request timed out');
  expect((error as JwksError).cause).toBeInstanceOf(errors.JWKSTimeout);

  // 0.05s, not 50s (or 0.00005s): the timeout is given in seconds
  expect(duration).toBeGreaterThanOrEqual(40);
  expect(duration).toBeLessThan(1000);

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify token with jwks timeout not resulting in integer milliseconds', async () => {
  const { privateKey, jwks } = await createKeyAndJwks();

  const token = await createToken(privateKey);

  const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
    { parameters: [], return: Promise.resolve(configuration) },
  ]);

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async () => createJwksResponse(jwks),
    },
  ]);

  // 2.01 * 1000 = 2009.9999999999998, jose rejects a non-integer timeout duration
  const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, {
    audience: 'audience-1',
    fetch,
    jwksTimeout: 2.01,
  });

  expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ iss: issuer, sub: 'subject-1' }));

  expect(oidcConfigurationResolverMocks).toHaveLength(0);
  expect(fetchMocks).toHaveLength(0);
});

test('verify token with unreachable jwks uri within cooldown', async () => {
  vi.useFakeTimers();

  try {
    const { privateKey, jwks } = await createKeyAndJwks();

    const token = await createToken(privateKey);

    const error = new TypeError('fetch failed');

    const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
    ]);

    const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
      {
        callback: async () => Promise.reject(error),
      },
      {
        callback: async () => createJwksResponse(jwks),
      },
    ]);

    const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, {
      audience: 'audience-1',
      fetch,
      jwksCooldown: 10,
    });

    await expect(tokenVerifier(token)).rejects.toBe(error);
    expect(fetchMocks).toHaveLength(1);

    vi.advanceTimersByTime(9999);

    // within cooldown, no jwks known: fail fast with the same error, no fetch
    await expect(tokenVerifier(token)).rejects.toBe(error);
    expect(fetchMocks).toHaveLength(1);

    vi.advanceTimersByTime(1);

    // after cooldown: fetch again
    expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(0);

    expect(oidcConfigurationResolverMocks).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

test('verify token with failing jwks uri within cooldown', async () => {
  vi.useFakeTimers();

  try {
    const { privateKey, jwks } = await createKeyAndJwks();

    const token = await createToken(privateKey);

    const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
    ]);

    const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
      {
        callback: async () => new Response('Internal Server Error', { status: 500 }),
      },
      {
        callback: async () => createJwksResponse(jwks),
      },
    ]);

    const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, {
      audience: 'audience-1',
      fetch,
      jwksCooldown: 10,
    });

    await expectJwksError(
      tokenVerifier(token),
      'Expected 200 OK from the JSON Web Key Set HTTP response',
      errors.JOSEError,
    );
    expect(fetchMocks).toHaveLength(1);

    vi.advanceTimersByTime(9999);

    // within cooldown, no jwks known: fail fast with the same (wrapped) error, no fetch
    await expectJwksError(
      tokenVerifier(token),
      'Expected 200 OK from the JSON Web Key Set HTTP response',
      errors.JOSEError,
    );
    expect(fetchMocks).toHaveLength(1);

    vi.advanceTimersByTime(1);

    // after cooldown: fetch again
    expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(0);

    expect(oidcConfigurationResolverMocks).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

test('verify token with expired jwks cache and failed refresh', async () => {
  vi.useFakeTimers();

  try {
    const { privateKey, jwks } = await createKeyAndJwks();
    const { privateKey: otherPrivateKey, jwks: otherJwks } = await createKeyAndJwks('key-2');

    const token = await createToken(privateKey);
    const otherToken = await createToken(otherPrivateKey, { kid: 'key-2' });

    const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
    ]);

    const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
      {
        callback: async () => createJwksResponse(jwks),
      },
      {
        callback: async () => new Response('Internal Server Error', { status: 500 }),
      },
      {
        callback: async () => createJwksResponse(otherJwks),
      },
    ]);

    const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, {
      audience: 'audience-1',
      fetch,
      jwksMaxAge: 10,
      jwksCooldown: 10,
    });

    expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(2);

    vi.advanceTimersByTime(9999);

    // fresh cache: no fetch
    expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(2);

    vi.advanceTimersByTime(1);

    // expired cache, failed refresh: verify against the stale jwks instead of failing
    expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(1);

    vi.advanceTimersByTime(9999);

    // within cooldown: still stale, no fetch
    expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(1);

    vi.advanceTimersByTime(1);

    // after cooldown: fetch again, success replaces the stale jwks
    expect(await tokenVerifier(otherToken)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(0);

    expect(oidcConfigurationResolverMocks).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

test('verify token with expired jwks cache and failed refresh beyond max stale', async () => {
  vi.useFakeTimers();

  try {
    const { privateKey, jwks } = await createKeyAndJwks();

    const token = await createToken(privateKey);

    const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
    ]);

    const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
      {
        callback: async () => createJwksResponse(jwks),
      },
      {
        callback: async () => new Response('Internal Server Error', { status: 500 }),
      },
      {
        callback: async () => new Response('Internal Server Error', { status: 500 }),
      },
      {
        callback: async () => createJwksResponse(jwks),
      },
    ]);

    const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, {
      audience: 'audience-1',
      fetch,
      jwksMaxAge: 10,
      jwksCooldown: 10,
      jwksMaxStale: 15,
    });

    vi.mocked(createLocalJWKSet).mockClear();

    expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(3);

    vi.advanceTimersByTime(10000);

    // expired cache, failed refresh: verify against the stale jwks
    expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(2);

    vi.advanceTimersByTime(9999);

    // within cooldown: still stale, no fetch
    expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(2);

    vi.advanceTimersByTime(5000);

    // after cooldown, failed refresh again, one millisecond before max stale: still stale
    expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(1);

    // the stale jwks got imported once, not once per verification
    expect(createLocalJWKSet).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);

    // max stale reached (within cooldown): the stale jwks is not used anymore, fail with the last jwks error
    await expectJwksError(
      tokenVerifier(token),
      'Expected 200 OK from the JSON Web Key Set HTTP response',
      errors.JOSEError,
    );
    expect(fetchMocks).toHaveLength(1);

    vi.advanceTimersByTime(9999);

    // after cooldown: fetch again, success revives the verification
    expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(0);

    expect(oidcConfigurationResolverMocks).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

test('verify token with expired jwks cache and failed refresh beyond default max stale', async () => {
  vi.useFakeTimers();

  try {
    const { privateKey, jwks } = await createKeyAndJwks();

    // the token must outlive the default max stale of one hour
    const token = await createToken(privateKey, { exp: Math.floor(Date.now() / 1000) + 7200 });

    const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
    ]);

    const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
      {
        callback: async () => createJwksResponse(jwks),
      },
      {
        callback: async () => new Response('Internal Server Error', { status: 500 }),
      },
      {
        callback: async () => new Response('Internal Server Error', { status: 500 }),
      },
      {
        callback: async () => createJwksResponse(jwks),
      },
    ]);

    const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, {
      audience: 'audience-1',
      fetch,
      jwksMaxAge: 10,
      jwksCooldown: 10,
    });

    expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(3);

    vi.advanceTimersByTime(10000);

    // expired cache, failed refresh: verify against the stale jwks
    expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(2);

    vi.advanceTimersByTime(3600000 - 1);

    // after cooldown, failed refresh again, one millisecond before the default max stale of one hour: still stale
    expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(1);

    vi.advanceTimersByTime(1);

    // max stale reached (within cooldown): the stale jwks is not used anymore, fail with the last jwks error
    await expectJwksError(
      tokenVerifier(token),
      'Expected 200 OK from the JSON Web Key Set HTTP response',
      errors.JOSEError,
    );
    expect(fetchMocks).toHaveLength(1);

    vi.advanceTimersByTime(9999);

    // after cooldown: fetch again, success revives the verification
    expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(0);

    expect(oidcConfigurationResolverMocks).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

test('verify token with expired jwks cache and failed refresh without max stale', async () => {
  vi.useFakeTimers();

  try {
    const { privateKey, jwks } = await createKeyAndJwks();

    const token = await createToken(privateKey);

    const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
    ]);

    const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
      {
        callback: async () => createJwksResponse(jwks),
      },
      {
        callback: async () => Promise.reject(new TypeError('fetch failed')),
      },
    ]);

    const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, {
      audience: 'audience-1',
      fetch,
      jwksMaxAge: 10,
      jwksMaxStale: 0,
    });

    expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(1);

    vi.advanceTimersByTime(10000);

    // expired cache, failed refresh: no stale serving at all, the fetch error is passed through
    await expect(tokenVerifier(token)).rejects.toThrow(new TypeError('fetch failed'));
    expect(fetchMocks).toHaveLength(0);

    expect(oidcConfigurationResolverMocks).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

test('verify token with rotated key', async () => {
  vi.useFakeTimers();

  try {
    const { privateKey, jwks } = await createKeyAndJwks();
    const { privateKey: otherPrivateKey, jwks: otherJwks } = await createKeyAndJwks('key-2');

    const token = await createToken(privateKey);
    const otherToken = await createToken(otherPrivateKey, { kid: 'key-2' });

    const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
    ]);

    const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
      {
        callback: async () => createJwksResponse(jwks),
      },
      {
        callback: async () => createJwksResponse(otherJwks),
      },
    ]);

    const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, {
      audience: 'audience-1',
      fetch,
      jwksCooldown: 10,
    });

    expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(1);

    vi.advanceTimersByTime(9999);

    // unknown key id within cooldown: no refetch (rate limit)
    await expectInvalidTokenError(
      tokenVerifier(otherToken),
      'no applicable key found in the JSON Web Key Set',
      errors.JWKSNoMatchingKey,
    );
    expect(fetchMocks).toHaveLength(1);

    vi.advanceTimersByTime(1);

    // unknown key id after cooldown: refetch
    expect(await tokenVerifier(otherToken)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(0);

    expect(oidcConfigurationResolverMocks).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

test('verify token with unknown key id and failed jwks refresh', async () => {
  vi.useFakeTimers();

  try {
    const { privateKey, jwks } = await createKeyAndJwks();
    const { privateKey: otherPrivateKey } = await createKeyAndJwks('key-2');

    const token = await createToken(privateKey);
    const otherToken = await createToken(otherPrivateKey, { kid: 'key-2' });

    const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
    ]);

    const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
      {
        callback: async () => createJwksResponse(jwks),
      },
      {
        callback: async () => Promise.reject(new TypeError('fetch failed')),
      },
    ]);

    const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, {
      audience: 'audience-1',
      fetch,
      jwksCooldown: 10,
    });

    expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(1);

    vi.advanceTimersByTime(10000);

    // unknown key id, failed refetch: the token cannot be verified against the stale jwks
    await expectInvalidTokenError(
      tokenVerifier(otherToken),
      'no applicable key found in the JSON Web Key Set',
      errors.JWKSNoMatchingKey,
    );
    expect(fetchMocks).toHaveLength(0);

    // within cooldown: known keys keep working, no fetch
    expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(0);

    expect(oidcConfigurationResolverMocks).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

test('verify token with unknown key id does not trigger the failure cooldown', async () => {
  vi.useFakeTimers();

  try {
    const { privateKey, jwks } = await createKeyAndJwks();
    const { privateKey: otherPrivateKey } = await createKeyAndJwks('key-2');

    const token = await createToken(privateKey);
    const otherToken = await createToken(otherPrivateKey, { kid: 'key-2' });

    const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
      { parameters: [], return: Promise.resolve(configuration) },
    ]);

    const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
      {
        callback: async () => createJwksResponse(jwks),
      },
      {
        callback: async () => createJwksResponse(jwks),
      },
      {
        callback: async () => createJwksResponse(jwks),
      },
    ]);

    const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, {
      audience: 'audience-1',
      fetch,
      jwksMaxAge: 5,
      jwksCooldown: 10,
    });

    expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(2);

    vi.advanceTimersByTime(5000);

    // expired cache, successful refetch, but still no matching key: a token error, not an outage
    await expectInvalidTokenError(
      tokenVerifier(otherToken),
      'no applicable key found in the JSON Web Key Set',
      errors.JWKSNoMatchingKey,
    );
    expect(fetchMocks).toHaveLength(1);

    vi.advanceTimersByTime(5000);

    // expired cache: refetch (no failure cooldown got triggered by the token error)
    expect(await tokenVerifier(token)).toEqual(expect.objectContaining({ sub: 'subject-1' }));
    expect(fetchMocks).toHaveLength(0);

    expect(oidcConfigurationResolverMocks).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});
