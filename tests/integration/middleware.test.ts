import { Buffer } from 'node:buffer';
import { text } from 'node:stream/consumers';
import { expect, test } from 'vitest';
import {
  createResponseFactory,
  createServerRequestFactory,
  createStreamFactory,
} from '@chubbyts/chubbyts-http/message-factory';
import { createResponseHelpers, createServerRequestHelpers } from '@chubbyts/chubbyts-http/message-helper';
import type { Handler } from '@chubbyts/chubbyts-http-types/handler';
import type { Attributes, Response, ServerRequest } from '@chubbyts/chubbyts-http-types/message';
import type { Middleware } from '@chubbyts/chubbyts-http-types/middleware';
import type { JwtTokenVerifierOptions } from '../../src/token.js';
import { createBearerTokenExtractor, createJwtTokenVerifier } from '../../src/token.js';
import { createOidcConfigurationResolver } from '../../src/discovery.js';
import type { OidcAttributes } from '../../src/middleware.js';
import { createOidcAuthenticationMiddleware } from '../../src/middleware.js';

// @chubbyts/chubbyts-http is used as implementation of @chubbyts/chubbyts-http-types
const serverRequestFactory = createServerRequestFactory();
const serverRequestHelpers = createServerRequestHelpers();
const responseFactory = createResponseFactory();
const responseHelpers = createResponseHelpers();
const streamFactory = createStreamFactory();

const createRequest = (uri: string, headers: Record<string, string> = {}): ServerRequest =>
  Object.entries(headers).reduce(
    (request, [name, value]) => serverRequestHelpers.withHeader(request, name, value),
    serverRequestFactory('GET', uri),
  );

const issuer = `${process.env.MOCK_OAUTH2_SERVER_URL ?? 'http://localhost:8080'}/default`;

const fetchAccessToken = async (): Promise<string> => {
  const response = await fetch(`${issuer}/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: 'api',
      client_secret: 'api-secret',
    }),
  });

  expect(response.status).toBe(200);

  const { access_token: accessToken } = (await response.json()) as { access_token: string };

  return accessToken;
};

const decodePart = <T>(token: string, index: number): T => {
  return JSON.parse(Buffer.from(token.split('.')[index], 'base64url').toString()) as T;
};

const decodeHeader = (token: string): { typ: string } => decodePart(token, 0);

const decodeClaims = (token: string): { aud: string | Array<string> } => decodePart(token, 1);

const handler: Handler<OidcAttributes> = async (serverRequest: ServerRequest<OidcAttributes>): Promise<Response> => {
  return responseHelpers.withHeader(
    responseHelpers.withBody(responseFactory(200), streamFactory(JSON.stringify(serverRequest.attributes.oidc))),
    'content-type',
    'application/json',
  );
};

const createMiddleware = (options: JwtTokenVerifierOptions): Middleware<Attributes, OidcAttributes> => {
  return createOidcAuthenticationMiddleware(
    responseFactory,
    responseHelpers,
    serverRequestHelpers,
    createBearerTokenExtractor(serverRequestHelpers),
    createJwtTokenVerifier(createOidcConfigurationResolver(issuer), options),
    'api',
  );
};

test('without token', async () => {
  const serverRequest = createRequest('https://api.example.com/resource');

  const response = await createMiddleware({ audience: 'https://api.example.com' })(serverRequest, handler);

  expect(response.status).toBe(401);
  expect(response.headers['www-authenticate']).toEqual(['Bearer realm="api"']);
});

test('with invalid token', async () => {
  const serverRequest = createRequest('https://api.example.com/resource', { authorization: 'Bearer invalid-token' });

  const response = await createMiddleware({ audience: 'https://api.example.com' })(serverRequest, handler);

  expect(response.status).toBe(401);
  expect(response.headers['www-authenticate']).toEqual([
    'Bearer realm="api", error="invalid_token", error_description="The access token is invalid or expired"',
  ]);
});

test('with valid token', async () => {
  const accessToken = await fetchAccessToken();

  const { aud } = decodeClaims(accessToken);

  const serverRequest = createRequest('https://api.example.com/resource', { authorization: `Bearer ${accessToken}` });

  const response = await createMiddleware({ audience: aud })(serverRequest, handler);

  expect(response.status).toBe(200);

  const oidc = JSON.parse(await text(response.body)) as { token: string; claims: { iss: string; sub: string } };

  expect(oidc.token).toBe(accessToken);
  expect(oidc.claims.iss).toBe(issuer);
  expect(oidc.claims.sub).toBe('api');
});

test('with valid token and matching typ', async () => {
  const accessToken = await fetchAccessToken();

  const { typ } = decodeHeader(accessToken);
  const { aud } = decodeClaims(accessToken);

  const serverRequest = createRequest('https://api.example.com/resource', { authorization: `Bearer ${accessToken}` });

  const response = await createMiddleware({ audience: aud, typ })(serverRequest, handler);

  expect(response.status).toBe(200);
});

test('with valid token and wrong typ', async () => {
  const accessToken = await fetchAccessToken();

  const { aud } = decodeClaims(accessToken);

  const serverRequest = createRequest('https://api.example.com/resource', { authorization: `Bearer ${accessToken}` });

  const response = await createMiddleware({ audience: aud, typ: 'other+jwt' })(serverRequest, handler);

  expect(response.status).toBe(401);
  expect(response.headers['www-authenticate']).toEqual([
    'Bearer realm="api", error="invalid_token", error_description="The access token is invalid or expired"',
  ]);
});

test('with valid token and wrong audience', async () => {
  const accessToken = await fetchAccessToken();

  const serverRequest = createRequest('https://api.example.com/resource', { authorization: `Bearer ${accessToken}` });

  const response = await createMiddleware({ audience: 'https://other-api.example.com' })(serverRequest, handler);

  expect(response.status).toBe(401);
  expect(response.headers['www-authenticate']).toEqual([
    'Bearer realm="api", error="invalid_token", error_description="The access token is invalid or expired"',
  ]);
});
