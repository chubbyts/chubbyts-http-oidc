import { expect, test } from 'vitest';
import { errors } from 'jose';
import { useFunctionMock } from '@chubbyts/chubbyts-function-mock/dist/function-mock';
import { useObjectMock } from '@chubbyts/chubbyts-function-mock/dist/object-mock';
import type { Logger } from '@chubbyts/chubbyts-log-types/dist/log';
import type { Handler } from '@chubbyts/chubbyts-http-types/handler';
import type { Response, ServerRequest } from '@chubbyts/chubbyts-http-types/message';
import type { ResponseFactory } from '@chubbyts/chubbyts-http-types/message-factory';
import type { ResponseHelpers, ServerRequestHelpers } from '@chubbyts/chubbyts-http-types/message-helper';
import type { TokenExtractor, TokenVerifier } from '../../src/token.js';
import { InvalidTokenError } from '../../src/error.js';
import type { OidcAttributes } from '../../src/middleware.js';
import { createOidcAuthenticationMiddleware } from '../../src/middleware.js';

const serverRequest = {
  method: 'GET',
  uri: {
    scheme: 'https',
    userInfo: '',
    host: 'api.example.com',
    port: undefined,
    path: '/resource',
    query: 'key=value',
    fragment: '',
  },
  attributes: { key: 'value' },
} as unknown as ServerRequest;

const createResponse = (label: string): Response => ({
  status: 401,
  reasonPhrase: label,
  protocolVersion: '1.1',
  headers: {},
  body: (async function* () {})(),
});

// the implementation (factories and helpers) gets injected: mocked to verify the middleware uses nothing else
const useImplementationMocks = (challenge: string | undefined = undefined) => {
  const response = createResponse('created');
  const unauthorizedResponse = createResponse('unauthorized');

  const [responseFactory, responseFactoryMocks] = useFunctionMock<ResponseFactory>(
    challenge !== undefined ? [{ parameters: [401, 'Unauthorized'], return: response }] : [],
  );

  const [responseHelpers, responseHelpersMocks] = useObjectMock<ResponseHelpers>(
    challenge !== undefined
      ? [{ name: 'withHeader', parameters: [response, 'www-authenticate', challenge], return: unauthorizedResponse }]
      : [],
  );

  return { responseFactory, responseFactoryMocks, responseHelpers, responseHelpersMocks, unauthorizedResponse };
};

test('without token, without realm', async () => {
  const { responseFactory, responseFactoryMocks, responseHelpers, responseHelpersMocks, unauthorizedResponse } =
    useImplementationMocks('Bearer');

  const [serverRequestHelpers, serverRequestHelpersMocks] = useObjectMock<ServerRequestHelpers>([]);

  const [tokenExtractor, tokenExtractorMocks] = useFunctionMock<TokenExtractor>([
    { parameters: [serverRequest], return: undefined },
  ]);

  const [tokenVerifier, tokenVerifierMocks] = useFunctionMock<TokenVerifier>([]);

  const [handler, handlerMocks] = useFunctionMock<Handler<OidcAttributes>>([]);

  const middleware = createOidcAuthenticationMiddleware(
    responseFactory,
    responseHelpers,
    serverRequestHelpers,
    tokenExtractor,
    tokenVerifier,
  );

  expect(await middleware(serverRequest, handler)).toBe(unauthorizedResponse);

  expect(responseFactoryMocks).toHaveLength(0);
  expect(responseHelpersMocks).toHaveLength(0);
  expect(serverRequestHelpersMocks).toHaveLength(0);
  expect(tokenExtractorMocks).toHaveLength(0);
  expect(tokenVerifierMocks).toHaveLength(0);
  expect(handlerMocks).toHaveLength(0);
});

test.each<{ name: string; realm: string; expectedChallenge: string }>([
  { name: 'a plain value', realm: 'api', expectedChallenge: 'Bearer realm="api"' },
  { name: 'double quotes', realm: 'my "api"', expectedChallenge: `Bearer realm="my 'api'"` },
  { name: 'backslashes', realm: 'my\\api\\', expectedChallenge: 'Bearer realm="myapi"' },
  { name: 'control characters', realm: 'my\r\napi\u0000\u007f', expectedChallenge: 'Bearer realm="myapi"' },
])('without token, with realm containing $name', async ({ realm, expectedChallenge }) => {
  const { responseFactory, responseFactoryMocks, responseHelpers, responseHelpersMocks, unauthorizedResponse } =
    useImplementationMocks(expectedChallenge);

  const [serverRequestHelpers, serverRequestHelpersMocks] = useObjectMock<ServerRequestHelpers>([]);

  const [tokenExtractor, tokenExtractorMocks] = useFunctionMock<TokenExtractor>([
    { parameters: [serverRequest], return: undefined },
  ]);

  const [tokenVerifier, tokenVerifierMocks] = useFunctionMock<TokenVerifier>([]);

  const [handler, handlerMocks] = useFunctionMock<Handler<OidcAttributes>>([]);

  const middleware = createOidcAuthenticationMiddleware(
    responseFactory,
    responseHelpers,
    serverRequestHelpers,
    tokenExtractor,
    tokenVerifier,
    realm,
  );

  expect(await middleware(serverRequest, handler)).toBe(unauthorizedResponse);

  expect(responseFactoryMocks).toHaveLength(0);
  expect(responseHelpersMocks).toHaveLength(0);
  expect(serverRequestHelpersMocks).toHaveLength(0);
  expect(tokenExtractorMocks).toHaveLength(0);
  expect(tokenVerifierMocks).toHaveLength(0);
  expect(handlerMocks).toHaveLength(0);
});

test.each<{ name: string; cause: unknown; loggedCause: unknown }>([
  {
    // the token payload (personal data) of a jose claim error must not end up in the logs
    name: 'jose claim error',
    cause: new errors.JWTExpired('"exp" claim timestamp check failed', { sub: 'user-1', email: 'user@example.com' }),
    loggedCause: { name: 'JWTExpired', message: '"exp" claim timestamp check failed', code: 'ERR_JWT_EXPIRED' },
  },
  {
    name: 'error without code',
    cause: new Error('"exp" claim timestamp check failed'),
    loggedCause: { name: 'Error', message: '"exp" claim timestamp check failed' },
  },
  {
    name: 'error with non string code',
    cause: new (class extends Error {
      public readonly code = 42;
    })('"exp" claim timestamp check failed'),
    loggedCause: { name: 'Error', message: '"exp" claim timestamp check failed' },
  },
])('with invalid token, $name', async ({ cause, loggedCause }) => {
  const { responseFactory, responseFactoryMocks, responseHelpers, responseHelpersMocks, unauthorizedResponse } =
    useImplementationMocks(
      'Bearer realm="api", error="invalid_token", error_description="The access token is invalid or expired"',
    );

  const [serverRequestHelpers, serverRequestHelpersMocks] = useObjectMock<ServerRequestHelpers>([]);

  const [tokenExtractor, tokenExtractorMocks] = useFunctionMock<TokenExtractor>([
    { parameters: [serverRequest], return: 'token-1' },
  ]);

  const [tokenVerifier, tokenVerifierMocks] = useFunctionMock<TokenVerifier>([
    { parameters: ['token-1'], error: new InvalidTokenError('"exp" claim timestamp check failed', cause) },
  ]);

  const [handler, handlerMocks] = useFunctionMock<Handler<OidcAttributes>>([]);

  const [logger, loggerMocks] = useObjectMock<Logger>([
    {
      name: 'info',
      parameters: [
        'Invalid token',
        {
          method: 'GET',
          pathname: '/resource',
          error: { name: 'InvalidTokenError', message: '"exp" claim timestamp check failed', cause: loggedCause },
        },
      ],
    },
  ]);

  const middleware = createOidcAuthenticationMiddleware(
    responseFactory,
    responseHelpers,
    serverRequestHelpers,
    tokenExtractor,
    tokenVerifier,
    'api',
    logger,
  );

  expect(await middleware(serverRequest, handler)).toBe(unauthorizedResponse);

  expect(responseFactoryMocks).toHaveLength(0);
  expect(responseHelpersMocks).toHaveLength(0);
  expect(serverRequestHelpersMocks).toHaveLength(0);
  expect(tokenExtractorMocks).toHaveLength(0);
  expect(tokenVerifierMocks).toHaveLength(0);
  expect(handlerMocks).toHaveLength(0);
  expect(loggerMocks).toHaveLength(0);
});

test('with invalid token, without realm and default logger', async () => {
  const { responseFactory, responseFactoryMocks, responseHelpers, responseHelpersMocks, unauthorizedResponse } =
    useImplementationMocks('Bearer error="invalid_token", error_description="The access token is invalid or expired"');

  const [serverRequestHelpers, serverRequestHelpersMocks] = useObjectMock<ServerRequestHelpers>([]);

  const [tokenExtractor, tokenExtractorMocks] = useFunctionMock<TokenExtractor>([
    { parameters: [serverRequest], return: 'token-1' },
  ]);

  const [tokenVerifier, tokenVerifierMocks] = useFunctionMock<TokenVerifier>([
    { parameters: ['token-1'], error: new InvalidTokenError('Invalid Compact JWS') },
  ]);

  const [handler, handlerMocks] = useFunctionMock<Handler<OidcAttributes>>([]);

  const middleware = createOidcAuthenticationMiddleware(
    responseFactory,
    responseHelpers,
    serverRequestHelpers,
    tokenExtractor,
    tokenVerifier,
  );

  expect(await middleware(serverRequest, handler)).toBe(unauthorizedResponse);

  expect(responseFactoryMocks).toHaveLength(0);
  expect(responseHelpersMocks).toHaveLength(0);
  expect(serverRequestHelpersMocks).toHaveLength(0);
  expect(tokenExtractorMocks).toHaveLength(0);
  expect(tokenVerifierMocks).toHaveLength(0);
  expect(handlerMocks).toHaveLength(0);
});

test('with failing token verifier', async () => {
  const { responseFactory, responseFactoryMocks, responseHelpers, responseHelpersMocks } = useImplementationMocks();

  const [serverRequestHelpers, serverRequestHelpersMocks] = useObjectMock<ServerRequestHelpers>([]);

  const error = new Error('Cannot fetch oidc configuration from "https://issuer.example.com": status 500');

  const [tokenExtractor, tokenExtractorMocks] = useFunctionMock<TokenExtractor>([
    { parameters: [serverRequest], return: 'token-1' },
  ]);

  const [tokenVerifier, tokenVerifierMocks] = useFunctionMock<TokenVerifier>([{ parameters: ['token-1'], error }]);

  const [handler, handlerMocks] = useFunctionMock<Handler<OidcAttributes>>([]);

  const [logger, loggerMocks] = useObjectMock<Logger>([]);

  const middleware = createOidcAuthenticationMiddleware(
    responseFactory,
    responseHelpers,
    serverRequestHelpers,
    tokenExtractor,
    tokenVerifier,
    'api',
    logger,
  );

  await expect(middleware(serverRequest, handler)).rejects.toBe(error);

  expect(responseFactoryMocks).toHaveLength(0);
  expect(responseHelpersMocks).toHaveLength(0);
  expect(serverRequestHelpersMocks).toHaveLength(0);
  expect(tokenExtractorMocks).toHaveLength(0);
  expect(tokenVerifierMocks).toHaveLength(0);
  expect(handlerMocks).toHaveLength(0);
  expect(loggerMocks).toHaveLength(0);
});

test('with failing token verifier and none error rejection', async () => {
  const { responseFactory, responseFactoryMocks, responseHelpers, responseHelpersMocks } = useImplementationMocks();

  const [serverRequestHelpers, serverRequestHelpersMocks] = useObjectMock<ServerRequestHelpers>([]);

  const [tokenExtractor, tokenExtractorMocks] = useFunctionMock<TokenExtractor>([
    { parameters: [serverRequest], return: 'token-1' },
  ]);

  const [tokenVerifier, tokenVerifierMocks] = useFunctionMock<TokenVerifier>([
    {
      callback: async (): ReturnType<TokenVerifier> => {
        return Promise.reject('some none error rejection');
      },
    },
  ]);

  const [handler, handlerMocks] = useFunctionMock<Handler<OidcAttributes>>([]);

  const middleware = createOidcAuthenticationMiddleware(
    responseFactory,
    responseHelpers,
    serverRequestHelpers,
    tokenExtractor,
    tokenVerifier,
  );

  await expect(middleware(serverRequest, handler)).rejects.toBe('some none error rejection');

  expect(responseFactoryMocks).toHaveLength(0);
  expect(responseHelpersMocks).toHaveLength(0);
  expect(serverRequestHelpersMocks).toHaveLength(0);
  expect(tokenExtractorMocks).toHaveLength(0);
  expect(tokenVerifierMocks).toHaveLength(0);
  expect(handlerMocks).toHaveLength(0);
});

test('with valid token', async () => {
  const { responseFactory, responseFactoryMocks, responseHelpers, responseHelpersMocks } = useImplementationMocks();

  const claims = { iss: 'https://issuer.example.com', sub: 'subject-1' };

  const serverRequestWithOidc = {
    ...serverRequest,
    attributes: { key: 'value', oidc: { token: 'token-1', claims } },
  } as unknown as ServerRequest<OidcAttributes>;

  const [serverRequestHelpers, serverRequestHelpersMocks] = useObjectMock<ServerRequestHelpers>([
    {
      name: 'withAttribute',
      parameters: [serverRequest, 'oidc', { token: 'token-1', claims }],
      return: serverRequestWithOidc,
    },
  ]);

  const handlerResponse = createResponse('handled');

  const [tokenExtractor, tokenExtractorMocks] = useFunctionMock<TokenExtractor>([
    { parameters: [serverRequest], return: 'token-1' },
  ]);

  const [tokenVerifier, tokenVerifierMocks] = useFunctionMock<TokenVerifier>([
    { parameters: ['token-1'], return: Promise.resolve(claims) },
  ]);

  const [handler, handlerMocks] = useFunctionMock<Handler<OidcAttributes>>([
    { parameters: [serverRequestWithOidc], return: Promise.resolve(handlerResponse) },
  ]);

  const middleware = createOidcAuthenticationMiddleware(
    responseFactory,
    responseHelpers,
    serverRequestHelpers,
    tokenExtractor,
    tokenVerifier,
  );

  expect(await middleware(serverRequest, handler)).toBe(handlerResponse);

  expect(responseFactoryMocks).toHaveLength(0);
  expect(responseHelpersMocks).toHaveLength(0);
  expect(serverRequestHelpersMocks).toHaveLength(0);
  expect(tokenExtractorMocks).toHaveLength(0);
  expect(tokenVerifierMocks).toHaveLength(0);
  expect(handlerMocks).toHaveLength(0);
});

test('with valid token and handler throwing invalid token error', async () => {
  const { responseFactory, responseFactoryMocks, responseHelpers, responseHelpersMocks } = useImplementationMocks();

  const claims = { iss: 'https://issuer.example.com', sub: 'subject-1' };

  const serverRequestWithOidc = {
    ...serverRequest,
    attributes: { key: 'value', oidc: { token: 'token-1', claims } },
  } as unknown as ServerRequest<OidcAttributes>;

  const [serverRequestHelpers, serverRequestHelpersMocks] = useObjectMock<ServerRequestHelpers>([
    {
      name: 'withAttribute',
      parameters: [serverRequest, 'oidc', { token: 'token-1', claims }],
      return: serverRequestWithOidc,
    },
  ]);

  // an InvalidTokenError thrown behind the middleware is not a verification failure and must not become a 401
  const error = new InvalidTokenError('thrown by the handler');

  const [tokenExtractor, tokenExtractorMocks] = useFunctionMock<TokenExtractor>([
    { parameters: [serverRequest], return: 'token-1' },
  ]);

  const [tokenVerifier, tokenVerifierMocks] = useFunctionMock<TokenVerifier>([
    { parameters: ['token-1'], return: Promise.resolve(claims) },
  ]);

  const [handler, handlerMocks] = useFunctionMock<Handler<OidcAttributes>>([
    { parameters: [serverRequestWithOidc], error },
  ]);

  const [logger, loggerMocks] = useObjectMock<Logger>([]);

  const middleware = createOidcAuthenticationMiddleware(
    responseFactory,
    responseHelpers,
    serverRequestHelpers,
    tokenExtractor,
    tokenVerifier,
    'api',
    logger,
  );

  await expect(middleware(serverRequest, handler)).rejects.toBe(error);

  expect(responseFactoryMocks).toHaveLength(0);
  expect(responseHelpersMocks).toHaveLength(0);
  expect(serverRequestHelpersMocks).toHaveLength(0);
  expect(tokenExtractorMocks).toHaveLength(0);
  expect(tokenVerifierMocks).toHaveLength(0);
  expect(handlerMocks).toHaveLength(0);
  expect(loggerMocks).toHaveLength(0);
});
