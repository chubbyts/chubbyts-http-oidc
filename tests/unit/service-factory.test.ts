import { describe, expect, test } from 'vitest';
import { useFunctionMock } from '@chubbyts/chubbyts-function-mock/dist/function-mock';
import { useObjectMock } from '@chubbyts/chubbyts-function-mock/dist/object-mock';
import type { Container } from '@chubbyts/chubbyts-dic-types/dist/container';
import type { ConfigFactory } from '@chubbyts/chubbyts-dic-config/dist/dic-config';
import { createContainerByConfigFactory } from '@chubbyts/chubbyts-dic-config/dist/dic-config';
import type { Logger } from '@chubbyts/chubbyts-log-types/dist/log';
import { createResponseFactory, createServerRequestFactory } from '@chubbyts/chubbyts-http/message-factory';
import { createResponseHelpers, createServerRequestHelpers } from '@chubbyts/chubbyts-http/message-helper';
import type { Handler } from '@chubbyts/chubbyts-http-types/handler';
import type { Response, ServerRequest } from '@chubbyts/chubbyts-http-types/message';
import type { Middleware } from '@chubbyts/chubbyts-http-types/middleware';
import type { OidcConfigurationResolver } from '../../src/discovery.js';
import { InvalidTokenError, OidcConfigurationError } from '../../src/error.js';
import type { OidcAttributes } from '../../src/middleware.js';
import type { TokenExtractor, TokenVerifier } from '../../src/token.js';
import type { OidcConfig } from '../../src/service-factory.js';
import {
  bearerTokenExtractorServiceFactory,
  jwtTokenVerifierServiceFactory,
  oidcAuthenticationMiddlewareServiceFactory,
  oidcConfigurationResolverServiceFactory,
} from '../../src/service-factory.js';

// the create functions return opaque closures, so the wiring gets proven by exercising the created services against
// mocked collaborators (fetch, resolver, extractor, verifier, logger, handler)

// @chubbyts/chubbyts-http is used as implementation of @chubbyts/chubbyts-http-types
const serverRequestFactory = createServerRequestFactory();
const serverRequestHelpers = createServerRequestHelpers();
const responseFactory = createResponseFactory();
const responseHelpers = createResponseHelpers();

const createRequest = (uri: string, headers: Record<string, string> = {}): ServerRequest =>
  Object.entries(headers).reduce(
    (request, [name, value]) => serverRequestHelpers.withHeader(request, name, value),
    serverRequestFactory('GET', uri),
  );

const discoveryUrl = 'https://issuer.example.com/.well-known/openid-configuration';

const createDiscoveryFetchMock = (url: string) => {
  return useFunctionMock<typeof globalThis.fetch>([
    {
      callback: async (input: string | URL | Request, init?: RequestInit): Promise<globalThis.Response> => {
        expect(input).toBe(url);
        expect(init?.redirect).toBe('manual');

        return new globalThis.Response(undefined, { status: 503 });
      },
    },
  ]);
};

const expectDiscoveryError = async (promise: Promise<unknown>, url: string) => {
  await expect(promise).rejects.toThrow(
    new OidcConfigurationError(`Cannot fetch oidc configuration from "${url}": status 503`),
  );
};

describe('bearerTokenExtractorServiceFactory', () => {
  test('create', () => {
    const [container, containerMocks] = useObjectMock<Container>([
      { name: 'get', parameters: ['serverRequestHelpers'], return: serverRequestHelpers },
    ]);

    const service = bearerTokenExtractorServiceFactory()(container);

    expect(service(createRequest('https://api.example.com/resource', { authorization: 'Bearer token' }))).toBe('token');
    expect(service(createRequest('https://api.example.com/resource'))).toBeUndefined();

    expect(containerMocks).toHaveLength(0);
  });
});

describe('oidcConfigurationResolverServiceFactory', () => {
  test('without name', async () => {
    const [fetch, fetchMocks] = createDiscoveryFetchMock(discoveryUrl);

    const oidcConfig: OidcConfig = {
      issuer: 'https://issuer.example.com',
      audience: 'https://api.example.com',
      fetch,
      maxAge: 1800,
    };

    const [container, containerMocks] = useObjectMock<Container>([
      { name: 'get', parameters: ['config'], return: { chubbyts: { oidc: oidcConfig } } },
    ]);

    const service = oidcConfigurationResolverServiceFactory()(container);

    // the configured issuer gets resolved through the configured fetch
    await expectDiscoveryError(service(), discoveryUrl);

    expect(fetchMocks).toHaveLength(0);
    expect(containerMocks).toHaveLength(0);
  });

  test('with name', async () => {
    const [fetch, fetchMocks] = createDiscoveryFetchMock(discoveryUrl);

    const [container, containerMocks] = useObjectMock<Container>([
      {
        name: 'get',
        parameters: ['config'],
        return: {
          chubbyts: {
            oidc: {
              api: { issuer: 'https://issuer.example.com', audience: 'https://api.example.com', fetch },
              admin: { issuer: 'https://admin-issuer.example.com', audience: 'https://admin.example.com' },
            },
          },
        },
      },
    ]);

    const service = oidcConfigurationResolverServiceFactory('api')(container);

    await expectDiscoveryError(service(), discoveryUrl);

    expect(fetchMocks).toHaveLength(0);
    expect(containerMocks).toHaveLength(0);
  });

  test('the whole config gets passed through as options', () => {
    const [container, containerMocks] = useObjectMock<Container>([
      {
        name: 'get',
        parameters: ['config'],
        return: {
          chubbyts: { oidc: { issuer: 'https://issuer.example.com', audience: 'https://api.example.com', maxAge: -1 } },
        },
      },
    ]);

    expect(() => oidcConfigurationResolverServiceFactory()(container)).toThrow(
      'Invalid maxAge -1: must be a non-negative number of seconds',
    );

    expect(containerMocks).toHaveLength(0);
  });
});

describe('jwtTokenVerifierServiceFactory', () => {
  test('without registered oidcConfigurationResolver', async () => {
    const [fetch, fetchMocks] = createDiscoveryFetchMock(discoveryUrl);

    const oidcConfig: OidcConfig = { issuer: 'https://issuer.example.com', audience: 'https://api.example.com', fetch };
    const config = { chubbyts: { oidc: oidcConfig } };

    const [container, containerMocks] = useObjectMock<Container>([
      { name: 'get', parameters: ['config'], return: config },
      { name: 'has', parameters: ['oidcConfigurationResolver'], return: false },
      { name: 'get', parameters: ['config'], return: config },
    ]);

    const service = jwtTokenVerifierServiceFactory()(container);

    // the shipped resolver factory gets used: the configured issuer gets resolved through the configured fetch
    await expectDiscoveryError(service('token'), discoveryUrl);

    expect(fetchMocks).toHaveLength(0);
    expect(containerMocks).toHaveLength(0);
  });

  test('with registered oidcConfigurationResolver', async () => {
    const oidcConfig: OidcConfig = {
      issuer: 'https://issuer.example.com',
      audience: ['https://api.example.com', 'https://other-api.example.com'],
      algorithms: ['RS256'],
      jwksMaxStale: 3600,
    };

    const error = new Error('registered resolver');

    const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
      { parameters: [], error },
    ]);

    const [container, containerMocks] = useObjectMock<Container>([
      { name: 'get', parameters: ['config'], return: { chubbyts: { oidc: oidcConfig } } },
      { name: 'has', parameters: ['oidcConfigurationResolver'], return: true },
      { name: 'get', parameters: ['oidcConfigurationResolver'], return: oidcConfigurationResolver },
    ]);

    const service = jwtTokenVerifierServiceFactory()(container);

    // the registered resolver wins over the shipped factory
    await expect(service('token')).rejects.toThrow(error);

    expect(oidcConfigurationResolverMocks).toHaveLength(0);
    expect(containerMocks).toHaveLength(0);
  });

  test('with name, with registered named oidcConfigurationResolver', async () => {
    const oidcConfig: OidcConfig = { issuer: 'https://issuer.example.com', audience: 'https://api.example.com' };

    const error = new Error('registered named resolver');

    const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([
      { parameters: [], error },
    ]);

    const [container, containerMocks] = useObjectMock<Container>([
      { name: 'get', parameters: ['config'], return: { chubbyts: { oidc: { api: oidcConfig } } } },
      { name: 'has', parameters: ['oidcConfigurationResolverapi'], return: true },
      { name: 'get', parameters: ['oidcConfigurationResolverapi'], return: oidcConfigurationResolver },
    ]);

    const service = jwtTokenVerifierServiceFactory('api')(container);

    await expect(service('token')).rejects.toThrow(error);

    expect(oidcConfigurationResolverMocks).toHaveLength(0);
    expect(containerMocks).toHaveLength(0);
  });

  test('with name, without registered named oidcConfigurationResolver', async () => {
    const [fetch, fetchMocks] = createDiscoveryFetchMock(discoveryUrl);

    const oidcConfig: OidcConfig = { issuer: 'https://issuer.example.com', audience: 'https://api.example.com', fetch };
    const config = { chubbyts: { oidc: { api: oidcConfig } } };

    const [container, containerMocks] = useObjectMock<Container>([
      { name: 'get', parameters: ['config'], return: config },
      { name: 'has', parameters: ['oidcConfigurationResolverapi'], return: false },
      { name: 'get', parameters: ['config'], return: config },
    ]);

    const service = jwtTokenVerifierServiceFactory('api')(container);

    await expectDiscoveryError(service('token'), discoveryUrl);

    expect(fetchMocks).toHaveLength(0);
    expect(containerMocks).toHaveLength(0);
  });

  test('the whole config gets passed through as options', () => {
    const [oidcConfigurationResolver, oidcConfigurationResolverMocks] = useFunctionMock<OidcConfigurationResolver>([]);

    const [container, containerMocks] = useObjectMock<Container>([
      { name: 'get', parameters: ['config'], return: { chubbyts: { oidc: { issuer: 'https://issuer.example.com' } } } },
      { name: 'has', parameters: ['oidcConfigurationResolver'], return: true },
      { name: 'get', parameters: ['oidcConfigurationResolver'], return: oidcConfigurationResolver },
    ]);

    expect(() => jwtTokenVerifierServiceFactory()(container)).toThrow(
      'Invalid audience: must be a non-empty string or a non-empty array of non-empty strings',
    );

    expect(oidcConfigurationResolverMocks).toHaveLength(0);
    expect(containerMocks).toHaveLength(0);
  });
});

describe('oidcAuthenticationMiddlewareServiceFactory', () => {
  test('with defaults, without registered services', async () => {
    const [fetch, fetchMocks] = createDiscoveryFetchMock(discoveryUrl);

    const config = {
      chubbyts: { oidc: { issuer: 'https://issuer.example.com', audience: 'https://api.example.com', fetch } },
    };

    const [container, containerMocks] = useObjectMock<Container>([
      { name: 'get', parameters: ['config'], return: config },
      { name: 'get', parameters: ['responseFactory'], return: responseFactory },
      { name: 'get', parameters: ['responseHelpers'], return: responseHelpers },
      { name: 'get', parameters: ['serverRequestHelpers'], return: serverRequestHelpers },
      { name: 'has', parameters: ['oidcTokenExtractor'], return: false },
      { name: 'get', parameters: ['serverRequestHelpers'], return: serverRequestHelpers },
      { name: 'has', parameters: ['oidcTokenVerifier'], return: false },
      { name: 'get', parameters: ['config'], return: config },
      { name: 'has', parameters: ['oidcConfigurationResolver'], return: false },
      { name: 'get', parameters: ['config'], return: config },
      { name: 'has', parameters: ['logger'], return: false },
    ]);

    const service = oidcAuthenticationMiddlewareServiceFactory()(container);

    const [handler, handlerMocks] = useFunctionMock<Handler>([]);

    // without a token the challenge has no realm
    const response = await service(createRequest('https://api.example.com/resource'), handler);

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toEqual(['Bearer']);

    // the shipped bearer token extractor and jwt token verifier get used: the configured issuer gets resolved
    await expectDiscoveryError(
      service(createRequest('https://api.example.com/resource', { authorization: 'Bearer token' }), handler),
      discoveryUrl,
    );

    expect(handlerMocks).toHaveLength(0);
    expect(fetchMocks).toHaveLength(0);
    expect(containerMocks).toHaveLength(0);
  });

  test('with realm, with registered services', async () => {
    const request = createRequest('https://api.example.com/resource?key=secret');
    const claims = { sub: 'subject' };
    const response = responseFactory(200);

    const [tokenExtractor, tokenExtractorMocks] = useFunctionMock<TokenExtractor>([
      { parameters: [request], return: 'token', strict: true },
      { parameters: [request], return: 'token', strict: true },
    ]);

    const [tokenVerifier, tokenVerifierMocks] = useFunctionMock<TokenVerifier>([
      { parameters: ['token'], return: Promise.resolve(claims) },
      { parameters: ['token'], error: new InvalidTokenError('expired') },
    ]);

    const [logger, loggerMocks] = useObjectMock<Logger>([
      {
        name: 'info',
        parameters: [
          'Invalid token',
          {
            method: 'GET',
            pathname: '/resource',
            error: { name: 'InvalidTokenError', message: 'expired', cause: undefined },
          },
        ],
      },
    ]);

    const [handler, handlerMocks] = useFunctionMock<Handler>([
      {
        callback: async (handlerRequest: ServerRequest): Promise<Response> => {
          expect(handlerRequest.attributes).toEqual({ oidc: { token: 'token', claims } } satisfies OidcAttributes);

          return response;
        },
      },
    ]);

    const [container, containerMocks] = useObjectMock<Container>([
      { name: 'get', parameters: ['config'], return: { chubbyts: { oidc: { realm: 'api' } } } },
      { name: 'get', parameters: ['responseFactory'], return: responseFactory },
      { name: 'get', parameters: ['responseHelpers'], return: responseHelpers },
      { name: 'get', parameters: ['serverRequestHelpers'], return: serverRequestHelpers },
      { name: 'has', parameters: ['oidcTokenExtractor'], return: true },
      { name: 'get', parameters: ['oidcTokenExtractor'], return: tokenExtractor },
      { name: 'has', parameters: ['oidcTokenVerifier'], return: true },
      { name: 'get', parameters: ['oidcTokenVerifier'], return: tokenVerifier },
      { name: 'has', parameters: ['logger'], return: true },
      { name: 'get', parameters: ['logger'], return: logger },
    ]);

    const service = oidcAuthenticationMiddlewareServiceFactory()(container);

    // the registered extractor and verifier win over the shipped factories
    expect(await service(request, handler)).toBe(response);

    // an invalid token gets logged through the registered logger and challenged with the configured realm
    const unauthorizedResponse = await service(request, handler);

    expect(unauthorizedResponse.status).toBe(401);
    expect(unauthorizedResponse.headers['www-authenticate']).toEqual([
      'Bearer realm="api", error="invalid_token", error_description="The access token is invalid or expired"',
    ]);

    expect(tokenExtractorMocks).toHaveLength(0);
    expect(tokenVerifierMocks).toHaveLength(0);
    expect(loggerMocks).toHaveLength(0);
    expect(handlerMocks).toHaveLength(0);
    expect(containerMocks).toHaveLength(0);
  });

  test('with name, with realm, with registered named services', async () => {
    const request = createRequest('https://admin.example.com/resource');

    const [tokenExtractor, tokenExtractorMocks] = useFunctionMock<TokenExtractor>([
      { parameters: [request], return: undefined, strict: true },
    ]);
    const [tokenVerifier, tokenVerifierMocks] = useFunctionMock<TokenVerifier>([]);

    const [container, containerMocks] = useObjectMock<Container>([
      { name: 'get', parameters: ['config'], return: { chubbyts: { oidc: { admin: { realm: 'admin' } } } } },
      { name: 'get', parameters: ['responseFactory'], return: responseFactory },
      { name: 'get', parameters: ['responseHelpers'], return: responseHelpers },
      { name: 'get', parameters: ['serverRequestHelpers'], return: serverRequestHelpers },
      { name: 'has', parameters: ['oidcTokenExtractoradmin'], return: true },
      { name: 'get', parameters: ['oidcTokenExtractoradmin'], return: tokenExtractor },
      { name: 'has', parameters: ['oidcTokenVerifieradmin'], return: true },
      { name: 'get', parameters: ['oidcTokenVerifieradmin'], return: tokenVerifier },
      { name: 'has', parameters: ['logger'], return: false },
    ]);

    const service = oidcAuthenticationMiddlewareServiceFactory('admin')(container);

    const [handler, handlerMocks] = useFunctionMock<Handler>([]);

    const response = await service(request, handler);

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toEqual(['Bearer realm="admin"']);

    expect(tokenExtractorMocks).toHaveLength(0);
    expect(tokenVerifierMocks).toHaveLength(0);
    expect(handlerMocks).toHaveLength(0);
    expect(containerMocks).toHaveLength(0);
  });
});

describe('with container by config', () => {
  test('the services are wired together', async () => {
    const [fetch, fetchMocks] = createDiscoveryFetchMock(discoveryUrl);

    const container = createContainerByConfigFactory({
      chubbyts: {
        oidc: {
          issuer: 'https://issuer.example.com',
          audience: 'https://api.example.com',
          realm: 'api',
          fetch,
        } satisfies OidcConfig,
      },
      dependencies: {
        factories: new Map<string, ConfigFactory>([
          ['serverRequestHelpers', () => serverRequestHelpers],
          ['responseFactory', () => responseFactory],
          ['responseHelpers', () => responseHelpers],
          ['oidcAuthenticationMiddleware', oidcAuthenticationMiddlewareServiceFactory()],
          ['oidcConfigurationResolver', oidcConfigurationResolverServiceFactory()],
          ['oidcTokenExtractor', bearerTokenExtractorServiceFactory()],
          ['oidcTokenVerifier', jwtTokenVerifierServiceFactory()],
        ]),
      },
    })();

    const oidcAuthenticationMiddleware = container.get<Middleware>('oidcAuthenticationMiddleware');

    const [handler, handlerMocks] = useFunctionMock<Handler>([]);

    // without a token the configured realm gets challenged
    const response = await oidcAuthenticationMiddleware(createRequest('https://api.example.com/resource'), handler);

    expect(response.status).toBe(401);
    expect(response.headers['www-authenticate']).toEqual(['Bearer realm="api"']);

    // with a token the configured issuer gets resolved through the configured fetch
    await expectDiscoveryError(
      oidcAuthenticationMiddleware(
        createRequest('https://api.example.com/resource', { authorization: 'Bearer token' }),
        handler,
      ),
      discoveryUrl,
    );

    expect(fetchMocks).toHaveLength(0);
    expect(handlerMocks).toHaveLength(0);
  });

  test('the named services are wired together', async () => {
    const adminDiscoveryUrl = 'https://admin-issuer.example.com/.well-known/openid-configuration';

    const [apiFetch, apiFetchMocks] = createDiscoveryFetchMock(discoveryUrl);
    const [adminFetch, adminFetchMocks] = createDiscoveryFetchMock(adminDiscoveryUrl);

    const container = createContainerByConfigFactory({
      chubbyts: {
        oidc: {
          api: {
            issuer: 'https://issuer.example.com',
            audience: 'https://api.example.com',
            realm: 'api',
            fetch: apiFetch,
          },
          admin: {
            issuer: 'https://admin-issuer.example.com',
            audience: 'https://admin.example.com',
            realm: 'admin',
            fetch: adminFetch,
          },
        } satisfies Record<string, OidcConfig>,
      },
      dependencies: {
        factories: new Map<string, ConfigFactory>([
          ['serverRequestHelpers', () => serverRequestHelpers],
          ['responseFactory', () => responseFactory],
          ['responseHelpers', () => responseHelpers],
          ['oidcAuthenticationMiddlewareapi', oidcAuthenticationMiddlewareServiceFactory('api')],
          ['oidcAuthenticationMiddlewareadmin', oidcAuthenticationMiddlewareServiceFactory('admin')],
          ['oidcTokenVerifierapi', jwtTokenVerifierServiceFactory('api')],
          ['oidcTokenVerifieradmin', jwtTokenVerifierServiceFactory('admin')],
        ]),
      },
    })();

    const apiMiddleware = container.get<Middleware>('oidcAuthenticationMiddlewareapi');
    const adminMiddleware = container.get<Middleware>('oidcAuthenticationMiddlewareadmin');

    const [handler, handlerMocks] = useFunctionMock<Handler>([]);

    const apiResponse = await apiMiddleware(createRequest('https://api.example.com/resource'), handler);

    expect(apiResponse.headers['www-authenticate']).toEqual(['Bearer realm="api"']);

    const adminResponse = await adminMiddleware(createRequest('https://admin.example.com/resource'), handler);

    expect(adminResponse.headers['www-authenticate']).toEqual(['Bearer realm="admin"']);

    // each named middleware resolves its own issuer through its own fetch
    await expectDiscoveryError(
      apiMiddleware(createRequest('https://api.example.com/resource', { authorization: 'Bearer token' }), handler),
      discoveryUrl,
    );

    await expectDiscoveryError(
      adminMiddleware(createRequest('https://admin.example.com/resource', { authorization: 'Bearer token' }), handler),
      adminDiscoveryUrl,
    );

    expect(apiFetchMocks).toHaveLength(0);
    expect(adminFetchMocks).toHaveLength(0);
    expect(handlerMocks).toHaveLength(0);
  });
});
