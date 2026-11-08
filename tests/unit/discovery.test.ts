import { expect, test, vi } from 'vitest';
import { useFunctionMock } from '@chubbyts/chubbyts-function-mock/function-mock';
import type { OidcConfiguration, OidcConfigurationResolverOptions } from '../../src/discovery.js';
import { createOidcConfigurationResolver } from '../../src/discovery.js';
import { OidcConfigurationError } from '../../src/error.js';

const issuer = 'https://issuer.example.com';
const url = 'https://issuer.example.com/.well-known/openid-configuration';

const configuration: OidcConfiguration = {
  issuer,
  jwks_uri: 'https://issuer.example.com/jwks',
  authorization_endpoint: 'https://issuer.example.com/authorize',
  token_endpoint: 'https://issuer.example.com/token',
};

const createFetchMock = (
  expectedUrl: string,
  response: Response | (() => Promise<Response>),
): { callback: typeof globalThis.fetch } => ({
  callback: async (input, init) => {
    expect(String(input)).toBe(expectedUrl);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.redirect).toBe('manual');

    return typeof response === 'function' ? response() : response;
  },
});

const expectOidcConfigurationError = async (promise: Promise<unknown>, message: string): Promise<unknown> => {
  const error: unknown = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );

  expect(error).toBeInstanceOf(OidcConfigurationError);
  expect((error as OidcConfigurationError).name).toBe('OidcConfigurationError');
  expect((error as OidcConfigurationError).message).toBe(message);

  return (error as OidcConfigurationError).cause;
};

test.each<{ name: string; issuer: string }>([
  { name: 'relative', issuer: 'issuer.example.com' },
  { name: 'not a url', issuer: 'not a url' },
  { name: 'non http scheme', issuer: 'ftp://issuer.example.com' },
])('create resolver with invalid issuer: $name', ({ issuer: invalidIssuer }) => {
  expect(() => createOidcConfigurationResolver(invalidIssuer)).toThrow(
    `Invalid issuer "${invalidIssuer}": must be an absolute http(s) url`,
  );
});

test.each<{ name: string; options: Record<string, unknown>; message: string }>([
  { name: 'maxAge', options: { maxAge: -1 }, message: 'Invalid maxAge -1: must be a non-negative number of seconds' },
  {
    name: 'maxAge as string',
    options: { maxAge: '3600' },
    message: 'Invalid maxAge 3600: must be a non-negative number of seconds',
  },
  {
    name: 'timeout',
    options: { timeout: -0.5 },
    message: 'Invalid timeout -0.5: must be a non-negative number of seconds',
  },
  {
    name: 'timeout infinite',
    options: { timeout: Number.POSITIVE_INFINITY },
    message: 'Invalid timeout Infinity: must be a finite number of seconds',
  },
  {
    name: 'cooldown',
    options: { cooldown: Number.NaN },
    message: 'Invalid cooldown NaN: must be a non-negative number of seconds',
  },
])('create resolver with invalid option: $name', ({ options, message }) => {
  expect(() => createOidcConfigurationResolver(issuer, options as OidcConfigurationResolverOptions)).toThrow(message);
});

test('create resolver with infinite durations', () => {
  expect(
    createOidcConfigurationResolver(issuer, { maxAge: Number.POSITIVE_INFINITY, cooldown: Number.POSITIVE_INFINITY }),
  ).toBeInstanceOf(Function);
});

test('resolve configuration', async () => {
  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    createFetchMock(url, new Response(JSON.stringify(configuration))),
  ]);

  const oidcConfigurationResolver = createOidcConfigurationResolver(issuer, { fetch });

  expect(await oidcConfigurationResolver()).toEqual(configuration);

  expect(fetchMocks).toHaveLength(0);
});

test('resolve configuration with default fetch', async () => {
  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    createFetchMock(url, new Response(JSON.stringify(configuration))),
  ]);

  vi.stubGlobal('fetch', fetch);

  try {
    const oidcConfigurationResolver = createOidcConfigurationResolver(issuer);

    expect(await oidcConfigurationResolver()).toEqual(configuration);
  } finally {
    vi.unstubAllGlobals();
  }

  expect(fetchMocks).toHaveLength(0);
});

test('resolve configuration with trailing slash issuer', async () => {
  const issuerWithTrailingSlash = 'https://issuer.example.com/';

  const configurationWithTrailingSlashIssuer: OidcConfiguration = {
    ...configuration,
    issuer: issuerWithTrailingSlash,
  };

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    createFetchMock(url, new Response(JSON.stringify(configurationWithTrailingSlashIssuer))),
  ]);

  const oidcConfigurationResolver = createOidcConfigurationResolver(issuerWithTrailingSlash, { fetch });

  expect(await oidcConfigurationResolver()).toEqual(configurationWithTrailingSlashIssuer);

  expect(fetchMocks).toHaveLength(0);
});

test('resolve configuration with multiple trailing slashes issuer', async () => {
  const issuerWithTrailingSlashes = 'https://issuer.example.com//';

  const configurationWithTrailingSlashesIssuer: OidcConfiguration = {
    ...configuration,
    issuer: issuerWithTrailingSlashes,
  };

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    createFetchMock(url, new Response(JSON.stringify(configurationWithTrailingSlashesIssuer))),
  ]);

  const oidcConfigurationResolver = createOidcConfigurationResolver(issuerWithTrailingSlashes, { fetch });

  expect(await oidcConfigurationResolver()).toEqual(configurationWithTrailingSlashesIssuer);

  expect(fetchMocks).toHaveLength(0);
});

test('resolve configuration with expiring cache', async () => {
  vi.useFakeTimers();

  try {
    const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
      createFetchMock(url, new Response(JSON.stringify(configuration))),
      createFetchMock(url, new Response(JSON.stringify(configuration))),
    ]);

    const oidcConfigurationResolver = createOidcConfigurationResolver(issuer, { fetch, maxAge: 10 });

    expect(await oidcConfigurationResolver()).toEqual(configuration);

    vi.advanceTimersByTime(9999);

    expect(await oidcConfigurationResolver()).toEqual(configuration);
    expect(fetchMocks).toHaveLength(1);

    vi.advanceTimersByTime(1);

    expect(await oidcConfigurationResolver()).toEqual(configuration);
    expect(fetchMocks).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

test('resolve configuration with cache', async () => {
  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    createFetchMock(url, new Response(JSON.stringify(configuration))),
  ]);

  const oidcConfigurationResolver = createOidcConfigurationResolver(issuer, { fetch });

  const resolvedConfiguration = await oidcConfigurationResolver();

  expect(resolvedConfiguration).toEqual(configuration);
  expect(await oidcConfigurationResolver()).toBe(resolvedConfiguration);

  expect(fetchMocks).toHaveLength(0);
});

test('resolve configuration without cache', async () => {
  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    createFetchMock(url, new Response(JSON.stringify(configuration))),
    createFetchMock(url, new Response(JSON.stringify(configuration))),
  ]);

  const oidcConfigurationResolver = createOidcConfigurationResolver(issuer, { fetch, maxAge: 0 });

  expect(await oidcConfigurationResolver()).toEqual(configuration);
  expect(await oidcConfigurationResolver()).toEqual(configuration);

  expect(fetchMocks).toHaveLength(0);
});

test.each<{ name: string; response: Response }>([
  // a redirect is not followed (redirect: 'manual'): a https -> http redirect must not bypass the https checks
  {
    name: 'redirect',
    response: Response.redirect('https://other-issuer.example.com/.well-known/openid-configuration'),
  },
  { name: 'client error', response: new Response(undefined, { status: 404 }) },
  { name: 'server error', response: new Response(undefined, { status: 500 }) },
])('resolve configuration with failed response: $name', async ({ response }) => {
  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([createFetchMock(url, response)]);

  const oidcConfigurationResolver = createOidcConfigurationResolver(issuer, { fetch });

  await expectOidcConfigurationError(
    oidcConfigurationResolver(),
    `Cannot fetch oidc configuration from "https://issuer.example.com/.well-known/openid-configuration": status ${response.status}`,
  );

  expect(fetchMocks).toHaveLength(0);
});

test('resolve configuration with failed response cancels the body', async () => {
  const response = new Response('{"error":"internal"}', { status: 500 });

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([createFetchMock(url, response)]);

  const oidcConfigurationResolver = createOidcConfigurationResolver(issuer, { fetch });

  await expectOidcConfigurationError(
    oidcConfigurationResolver(),
    'Cannot fetch oidc configuration from "https://issuer.example.com/.well-known/openid-configuration": status 500',
  );

  expect(response.bodyUsed).toBe(true);

  expect(fetchMocks).toHaveLength(0);
});

test('resolve configuration with failed response and errored body', async () => {
  const body = new ReadableStream({
    start: (controller) => {
      controller.error(new Error('connection reset'));
    },
  });

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    createFetchMock(url, new Response(body, { status: 500 })),
  ]);

  const oidcConfigurationResolver = createOidcConfigurationResolver(issuer, { fetch });

  // a failing cancel must not hide the actual error
  await expectOidcConfigurationError(
    oidcConfigurationResolver(),
    'Cannot fetch oidc configuration from "https://issuer.example.com/.well-known/openid-configuration": status 500',
  );

  expect(fetchMocks).toHaveLength(0);
});

test('resolve configuration with malformed json', async () => {
  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([createFetchMock(url, new Response('{'))]);

  const oidcConfigurationResolver = createOidcConfigurationResolver(issuer, { fetch });

  const cause = await expectOidcConfigurationError(
    oidcConfigurationResolver(),
    'Cannot fetch oidc configuration from "https://issuer.example.com/.well-known/openid-configuration": invalid json',
  );

  expect(cause).toBeInstanceOf(SyntaxError);

  expect(fetchMocks).toHaveLength(0);
});

test.each<{ name: string; body: string }>([
  { name: 'string', body: '"issuer"' },
  { name: 'null', body: 'null' },
  { name: 'array', body: '[]' },
])('resolve configuration with non object json: $name', async ({ body }) => {
  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([createFetchMock(url, new Response(body))]);

  const oidcConfigurationResolver = createOidcConfigurationResolver(issuer, { fetch });

  await expectOidcConfigurationError(
    oidcConfigurationResolver(),
    'Cannot fetch oidc configuration from "https://issuer.example.com/.well-known/openid-configuration": invalid json',
  );

  expect(fetchMocks).toHaveLength(0);
});

test('resolve configuration with issuer mismatch', async () => {
  const configurationWithOtherIssuer: OidcConfiguration = {
    ...configuration,
    issuer: 'https://other-issuer.example.com',
  };

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    createFetchMock(url, new Response(JSON.stringify(configurationWithOtherIssuer))),
  ]);

  const oidcConfigurationResolver = createOidcConfigurationResolver(issuer, { fetch });

  await expectOidcConfigurationError(
    oidcConfigurationResolver(),
    'Issuer mismatch: expected "https://issuer.example.com", given "https://other-issuer.example.com"',
  );

  expect(fetchMocks).toHaveLength(0);
});

test.each<{ name: string; issuer: unknown; given: string }>([
  { name: 'missing', issuer: undefined, given: 'undefined' },
  { name: 'null', issuer: null, given: 'null' },
  { name: 'number', issuer: 42, given: 'number' },
])('resolve configuration with invalid issuer: $name', async ({ issuer: givenIssuer, given }) => {
  const { issuer: _, ...configurationWithoutIssuer } = configuration;

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    createFetchMock(
      url,
      new Response(
        JSON.stringify(
          givenIssuer === undefined ? configurationWithoutIssuer : { ...configuration, issuer: givenIssuer },
        ),
      ),
    ),
  ]);

  const oidcConfigurationResolver = createOidcConfigurationResolver(issuer, { fetch });

  await expectOidcConfigurationError(
    oidcConfigurationResolver(),
    `Issuer mismatch: expected "https://issuer.example.com", given "${given}"`,
  );

  expect(fetchMocks).toHaveLength(0);
});

test('resolve configuration with timeout', async () => {
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

  const oidcConfigurationResolver = createOidcConfigurationResolver(issuer, { fetch, timeout: 0.01 });

  const error: unknown = await oidcConfigurationResolver().then(
    () => undefined,
    (e: unknown) => e,
  );

  expect(error).toBeInstanceOf(OidcConfigurationError);
  expect((error as Error).message).toBe(
    'Cannot fetch oidc configuration from "https://issuer.example.com/.well-known/openid-configuration": timeout after 0.01s',
  );
  expect(((error as Error).cause as Error).name).toBe('TimeoutError');

  expect(fetchMocks).toHaveLength(0);
});

test('resolve configuration with unreachable issuer', async () => {
  const fetchError = new TypeError('fetch failed');

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    createFetchMock(url, () => Promise.reject(fetchError)),
  ]);

  const oidcConfigurationResolver = createOidcConfigurationResolver(issuer, { fetch });

  await expect(oidcConfigurationResolver()).rejects.toBe(fetchError);

  expect(fetchMocks).toHaveLength(0);
});

test('resolve configuration concurrently', async () => {
  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    createFetchMock(url, new Response(JSON.stringify(configuration))),
  ]);

  const oidcConfigurationResolver = createOidcConfigurationResolver(issuer, { fetch });

  const [first, second, third] = await Promise.all([
    oidcConfigurationResolver(),
    oidcConfigurationResolver(),
    oidcConfigurationResolver(),
  ]);

  expect(first).toEqual(configuration);
  expect(second).toBe(first);
  expect(third).toBe(first);

  expect(fetchMocks).toHaveLength(0);
});

test('resolve configuration concurrently with failure', async () => {
  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    createFetchMock(url, new Response(undefined, { status: 500 })),
  ]);

  const oidcConfigurationResolver = createOidcConfigurationResolver(issuer, { fetch });

  const results = await Promise.allSettled([oidcConfigurationResolver(), oidcConfigurationResolver()]);

  expect(results).toHaveLength(2);

  for (const result of results) {
    expect(result.status).toBe('rejected');
    expect((result as PromiseRejectedResult).reason).toBeInstanceOf(Error);
    expect(((result as PromiseRejectedResult).reason as Error).message).toBe(
      'Cannot fetch oidc configuration from "https://issuer.example.com/.well-known/openid-configuration": status 500',
    );
  }

  expect(fetchMocks).toHaveLength(0);
});

test('resolve configuration with failure cooldown', async () => {
  vi.useFakeTimers();

  try {
    const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
      createFetchMock(url, new Response(undefined, { status: 500 })),
      createFetchMock(url, new Response(JSON.stringify(configuration))),
    ]);

    const oidcConfigurationResolver = createOidcConfigurationResolver(issuer, { fetch, cooldown: 10 });

    const firstError: unknown = await oidcConfigurationResolver().then(
      () => undefined,
      (e: unknown) => e,
    );

    expect(firstError).toBeInstanceOf(Error);
    expect((firstError as Error).message).toBe(
      'Cannot fetch oidc configuration from "https://issuer.example.com/.well-known/openid-configuration": status 500',
    );

    vi.advanceTimersByTime(9999);

    // within cooldown: same error, no fetch
    await expect(oidcConfigurationResolver()).rejects.toBe(firstError);
    expect(fetchMocks).toHaveLength(1);

    vi.advanceTimersByTime(1);

    // after cooldown: fetch again, success clears the failure
    expect(await oidcConfigurationResolver()).toEqual(configuration);
    expect(await oidcConfigurationResolver()).toEqual(configuration);
    expect(fetchMocks).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

test('resolve configuration with expired cache and failed refresh', async () => {
  vi.useFakeTimers();

  try {
    const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
      createFetchMock(url, new Response(JSON.stringify(configuration))),
      createFetchMock(url, new Response(undefined, { status: 500 })),
      createFetchMock(
        url,
        new Response(JSON.stringify({ ...configuration, jwks_uri: 'https://issuer.example.com/jwks2' })),
      ),
    ]);

    const oidcConfigurationResolver = createOidcConfigurationResolver(issuer, { fetch, maxAge: 10, cooldown: 10 });

    expect(await oidcConfigurationResolver()).toEqual(configuration);

    vi.advanceTimersByTime(10000);

    // expired cache, failed refresh: serve the stale configuration instead of failing
    expect(await oidcConfigurationResolver()).toEqual(configuration);
    expect(fetchMocks).toHaveLength(1);

    vi.advanceTimersByTime(9999);

    // within cooldown: still stale, no fetch
    expect(await oidcConfigurationResolver()).toEqual(configuration);
    expect(fetchMocks).toHaveLength(1);

    vi.advanceTimersByTime(1);

    // after cooldown: fetch again, success replaces the stale configuration
    expect(await oidcConfigurationResolver()).toEqual({
      ...configuration,
      jwks_uri: 'https://issuer.example.com/jwks2',
    });
    expect(fetchMocks).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});

test('resolve configuration without failure cooldown', async () => {
  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    createFetchMock(url, new Response(undefined, { status: 500 })),
    createFetchMock(url, new Response(JSON.stringify(configuration))),
  ]);

  const oidcConfigurationResolver = createOidcConfigurationResolver(issuer, { fetch, cooldown: 0 });

  await expect(oidcConfigurationResolver()).rejects.toThrow('status 500');
  expect(await oidcConfigurationResolver()).toEqual(configuration);

  expect(fetchMocks).toHaveLength(0);
});

test.each<{ name: string; givenIssuer: string; jwks_uri: unknown; given: string }>([
  {
    name: 'https issuer and invalid jwks_uri',
    givenIssuer: 'https://issuer.example.com',
    jwks_uri: 'not-a-url',
    given: 'not-a-url',
  },
  {
    name: 'https issuer and relative jwks_uri',
    givenIssuer: 'https://issuer.example.com',
    jwks_uri: '/jwks',
    given: '/jwks',
  },
  {
    name: 'https issuer and non http jwks_uri',
    givenIssuer: 'https://issuer.example.com',
    jwks_uri: 'data:application/json,{}',
    given: 'data:application/json,{}',
  },
  {
    name: 'https issuer and missing jwks_uri',
    givenIssuer: 'https://issuer.example.com',
    jwks_uri: undefined,
    given: 'undefined',
  },
  { name: 'https issuer and null jwks_uri', givenIssuer: 'https://issuer.example.com', jwks_uri: null, given: 'null' },
  {
    name: 'https issuer and non string jwks_uri',
    givenIssuer: 'https://issuer.example.com',
    jwks_uri: 42,
    given: 'number',
  },
  {
    // stringifies to a valid url, but is not a string
    name: 'https issuer and array jwks_uri',
    givenIssuer: 'https://issuer.example.com',
    jwks_uri: ['https://issuer.example.com/jwks'],
    given: 'object',
  },
  {
    name: 'http issuer and invalid jwks_uri',
    givenIssuer: 'http://issuer.example.com',
    jwks_uri: 'not-a-url',
    given: 'not-a-url',
  },
  {
    name: 'http issuer and missing jwks_uri',
    givenIssuer: 'http://issuer.example.com',
    jwks_uri: undefined,
    given: 'undefined',
  },
])('resolve configuration with $name', async ({ givenIssuer, jwks_uri, given }) => {
  const invalidConfiguration = { ...configuration, issuer: givenIssuer, jwks_uri };

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    createFetchMock(
      `${givenIssuer}/.well-known/openid-configuration`,
      new Response(JSON.stringify(invalidConfiguration)),
    ),
  ]);

  const oidcConfigurationResolver = createOidcConfigurationResolver(givenIssuer, { fetch });

  await expectOidcConfigurationError(
    oidcConfigurationResolver(),
    `Missing or invalid jwks_uri "${given}" for issuer "${givenIssuer}"`,
  );

  expect(fetchMocks).toHaveLength(0);
});

test('resolve configuration with https issuer and http jwks_uri', async () => {
  const insecureConfiguration = { ...configuration, jwks_uri: 'http://issuer.example.com/jwks' };

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    createFetchMock(url, new Response(JSON.stringify(insecureConfiguration))),
  ]);

  const oidcConfigurationResolver = createOidcConfigurationResolver(issuer, { fetch });

  await expectOidcConfigurationError(
    oidcConfigurationResolver(),
    'Insecure jwks_uri "http://issuer.example.com/jwks" for https issuer "https://issuer.example.com"',
  );

  expect(fetchMocks).toHaveLength(0);
});

test('resolve configuration with http issuer and http jwks_uri', async () => {
  const httpIssuer = 'http://issuer.example.com';
  const httpUrl = 'http://issuer.example.com/.well-known/openid-configuration';

  const httpConfiguration: OidcConfiguration = {
    ...configuration,
    issuer: httpIssuer,
    jwks_uri: 'http://issuer.example.com/jwks',
  };

  const [fetch, fetchMocks] = useFunctionMock<typeof globalThis.fetch>([
    createFetchMock(httpUrl, new Response(JSON.stringify(httpConfiguration))),
  ]);

  const oidcConfigurationResolver = createOidcConfigurationResolver(httpIssuer, { fetch });

  expect(await oidcConfigurationResolver()).toEqual(httpConfiguration);

  expect(fetchMocks).toHaveLength(0);
});
