# chubbyts-http-oidc

[![CI](https://github.com/chubbyts/chubbyts-http-oidc/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/chubbyts/chubbyts-http-oidc/actions/workflows/ci.yml)
[![Coverage Status](https://coveralls.io/repos/github/chubbyts/chubbyts-http-oidc/badge.svg?branch=master)](https://coveralls.io/github/chubbyts/chubbyts-http-oidc?branch=master)
[![Mutation testing badge](https://img.shields.io/endpoint?style=flat&url=https%3A%2F%2Fbadge-api.stryker-mutator.io%2Fgithub.com%2Fchubbyts%2Fchubbyts-http-oidc%2Fmaster)](https://dashboard.stryker-mutator.io/reports/github.com/chubbyts/chubbyts-http-oidc/master)
[![npm-version](https://img.shields.io/npm/v/@chubbyts/chubbyts-http-oidc.svg)](https://www.npmjs.com/package/@chubbyts/chubbyts-http-oidc)

[![bugs](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-oidc&metric=bugs)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-oidc)
[![code_smells](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-oidc&metric=code_smells)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-oidc)
[![coverage](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-oidc&metric=coverage)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-oidc)
[![duplicated_lines_density](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-oidc&metric=duplicated_lines_density)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-oidc)
[![ncloc](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-oidc&metric=ncloc)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-oidc)
[![sqale_rating](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-oidc&metric=sqale_rating)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-oidc)
[![alert_status](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-oidc&metric=alert_status)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-oidc)
[![reliability_rating](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-oidc&metric=reliability_rating)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-oidc)
[![security_rating](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-oidc&metric=security_rating)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-oidc)
[![sqale_index](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-oidc&metric=sqale_index)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-oidc)
[![vulnerabilities](https://sonarcloud.io/api/project_badges/measure?project=chubbyts_chubbyts-http-oidc&metric=vulnerabilities)](https://sonarcloud.io/dashboard?id=chubbyts_chubbyts-http-oidc)

## Description

A minimal OIDC (OpenID Connect) resource server integration for [@chubbyts/chubbyts-http-types][3]: resolves the issuer's [openid configuration][10], verifies JWT bearer tokens against its [JWKS][11] and passes the verified claims to the handler via request attributes.

It works with any implementation of the types (e.g. [@chubbyts/chubbyts-http][8]): the request headers get read, the
`oidc` attribute gets set and the `401` responses get created and changed through the injected factory and helpers
only.

### How it fits into OpenID Connect

The library is the resource server: it verifies the access token of a request, no matter how the client obtained it. The following flow diagrams show the common ways, the responsibilities of each party and the parts of this library involved:

 * [Frontend flow](doc/flow/frontend.md): a browser app (SPA) logs the user in with the Authorization Code Flow with PKCE and calls the backend with the access token.
 * [Backend flow](doc/flow/backend.md): a server-side web app (backend for frontend) logs the user in, keeps the tokens in a session behind a cookie and calls the backend with the access token.
 * [Machine-to-machine flow](doc/flow/machine-to-machine.md): a service gets an access token for itself with the Client Credentials Grant, no user involved, and calls the backend with it.

## Requirements

 * node: >=22
 * [@chubbyts/chubbyts-dic-config-factory][16]: ^1.1.0
 * [@chubbyts/chubbyts-dic-types][14]: ^2.4.0
 * [@chubbyts/chubbyts-log-types][2]: ^3.4.0
 * [@chubbyts/chubbyts-http-types][3]: ^4.0.0
 * [jose][4]: ^6.2.12

## Installation

Through [NPM](https://www.npmjs.com) as [@chubbyts/chubbyts-http-oidc][1].

```sh
npm i @chubbyts/chubbyts-http-oidc@^1.1.0
```

## Usage

```ts
import { createResponseFactory, createStreamFactory } from '@chubbyts/chubbyts-http/message-factory';
import { createResponseHelpers, createServerRequestHelpers } from '@chubbyts/chubbyts-http/message-helper';
import type { Handler } from '@chubbyts/chubbyts-http-types/handler';
import type { Response, ServerRequest } from '@chubbyts/chubbyts-http-types/message';
import { createOidcConfigurationResolver } from '@chubbyts/chubbyts-http-oidc/discovery';
import type { OidcAttributes } from '@chubbyts/chubbyts-http-oidc/middleware';
import { createOidcAuthenticationMiddleware } from '@chubbyts/chubbyts-http-oidc/middleware';
import { createBearerTokenExtractor, createJwtTokenVerifier } from '@chubbyts/chubbyts-http-oidc/token';

// any implementation of @chubbyts/chubbyts-http-types, here @chubbyts/chubbyts-http
const serverRequestHelpers = createServerRequestHelpers();
const responseFactory = createResponseFactory();
const responseHelpers = createResponseHelpers();
const streamFactory = createStreamFactory();

const oidcAuthenticationMiddleware = createOidcAuthenticationMiddleware(
  responseFactory,
  responseHelpers,
  serverRequestHelpers,
  createBearerTokenExtractor(serverRequestHelpers),
  createJwtTokenVerifier(createOidcConfigurationResolver('https://issuer.example.com'), {
    audience: 'https://api.example.com',
  }),
  'api',
);

// add the middleware to the routes you want to protect, e.g. within chubbyts-framework:
// createGroup({ path: '/api', ..., middlewares: [oidcAuthenticationMiddleware, ...] })

const handler: Handler<OidcAttributes> = async (serverRequest: ServerRequest<OidcAttributes>): Promise<Response> => {
  const { claims } = serverRequest.attributes.oidc; // { token: string, claims: JWTPayload }

  return responseHelpers.withHeader(
    responseHelpers.withBody(responseFactory(200), streamFactory(JSON.stringify({ sub: claims.sub }))),
    'content-type',
    'application/json',
  );
};
```

The middleware is typed as `Middleware<Attributes, OidcAttributes>`: the handler behind it gets a
`ServerRequest<OidcAttributes>`.

 * **Audience:** `audience` is required and must match the `aud` claim your authorization server puts into access tokens for your API, otherwise any token of the issuer (even for other APIs, or ID tokens) would be accepted. If your server issues [RFC 9068][12] access tokens (`typ: at+jwt` header), pass `typ: 'at+jwt'` too.
 * **Rejected requests:** Without a valid token the handler is not called and a `401` with a [RFC 6750][13] challenge is returned: `WWW-Authenticate: Bearer realm="api"` (missing token) or `Bearer realm="api", error="invalid_token", error_description="The access token is invalid or expired"` (invalid token). The actual reason (expired, wrong signature, ...) is only logged (level `info`) via the optional logger, never sent to the client. Errors not related to the token (unreachable issuer, ...) are rethrown, so your error handling responds with a `5xx`.
 * **Browser clients:** Allow the `Authorization` request header and expose the `WWW-Authenticate` response header within your cors configuration.
 * **Token in the request attribute:** The `oidc` attribute carries the raw bearer token (`token`) next to the verified `claims`, so that handlers can forward it to downstream apis. Treat the attribute as sensitive: do not dump the request attributes into logs, error reports or responses.

### Options

```ts
import { createOidcConfigurationResolver } from '@chubbyts/chubbyts-http-oidc/discovery';
import { createOidcAuthenticationMiddleware } from '@chubbyts/chubbyts-http-oidc/middleware';
import { createBearerTokenExtractor, createJwtTokenVerifier } from '@chubbyts/chubbyts-http-oidc/token';

// resolves and caches {issuer}/.well-known/openid-configuration, lazily on first token verification
const oidcConfigurationResolver = createOidcConfigurationResolver('https://issuer.example.com', {
  fetch, // custom fetch for the discovery request, default: globalThis.fetch
  maxAge: 3600, // seconds a resolved configuration is cached (non-negative), default: 3600
  timeout: 5, // seconds until the discovery request is aborted (non-negative), default: 5
  cooldown: 30, // seconds until a failed (re)fetch is retried (non-negative), default: 30
});

// verifies signature (via the issuer's JWKS), "iss", "aud", "exp", "nbf" and returns the claims
const tokenVerifier = createJwtTokenVerifier(oidcConfigurationResolver, {
  audience: 'https://api.example.com', // string | Array<string>, required (non-empty, enforced at runtime)
  algorithms: ['RS256'], // non-empty subset of SUPPORTED_ALGORITHMS, default: SUPPORTED_ALGORITHMS
  clockTolerance: 5, // seconds (0 to MAX_CLOCK_TOLERANCE: 300), default: 0
  typ: 'at+jwt', // expected "typ" header (non-empty), default: not checked
  requiredClaims: ['sub', 'iat', 'jti'], // additionally required claims (non-empty strings), "iss", "aud" and "exp" always are
  fetch, // custom fetch for the jwks requests, default: globalThis.fetch
  jwksMaxAge: 600, // seconds a fetched jwks is cached (positive, 0 would refetch it with every verification), default: 600
  jwksTimeout: 5, // seconds until a jwks request is aborted (non-negative), default: 5
  jwksCooldown: 30, // seconds until a failed jwks (re)fetch is retried, and between refetches for unknown key ids (non-negative), default: 30
  jwksMaxStale: 86400, // seconds an expired jwks keeps being used while its refetch fails (non-negative, 0: never, Infinity: for as long as the outage lasts), default: 3600
});

const oidcAuthenticationMiddleware = createOidcAuthenticationMiddleware(
  responseFactory, // creates the 401 response
  responseHelpers, // sets the www-authenticate header of the 401 response
  serverRequestHelpers, // sets the oidc attribute
  createBearerTokenExtractor(serverRequestHelpers), // reads the "Authorization: Bearer <token>" header (exactly one)
  tokenVerifier,
  'api', // realm within the challenge, optional
  logger, // @chubbyts/chubbyts-log-types compatible logger, optional, default: no-op
);
```

 * **Issuer:** Must be exactly the `issuer` from the openid configuration (`iss` claim), `https://issuer.example.com` and `https://issuer.example.com/` are not the same. Only absolute `http(s)` urls are accepted. Use `https` in production, whoever can tamper with an unprotected discovery or jwks response can forge tokens your api accepts, plain `http` is only meant for local development. A `https` issuer advertising a plain `http` `jwks_uri` is rejected in any case, and neither the discovery nor the jwks request follows redirects (a `https` → `http` redirect would silently bypass these checks).
 * **Algorithms:** Only asymmetric signature algorithms are supported (`SUPPORTED_ALGORITHMS` within `@chubbyts/chubbyts-http-oidc/token`: `EdDSA`, `Ed25519`, `ES256`, `ES384`, `ES512`, `ML-DSA-44`, `ML-DSA-65`, `ML-DSA-87`, `PS256`, `PS384`, `PS512`, `RS256`, `RS384`, `RS512`): a public (jwks) key must never be usable as a hmac secret (algorithm confusion). Anything else, including `HS*`, is rejected at construction time (`algorithms` option) or verification time (token header).
 * **Options:** Invalid options (empty or unsupported `algorithms`, negative or non-numeric durations, infinite timeouts, empty `audience`) throw at construction time instead of silently rejecting every token.
 * **JWKS:** Fetched from the `jwks_uri` of the openid configuration and cached in memory for `jwksMaxAge`, an unknown key id (key rotation) triggers a refetch, but at most once per `jwksCooldown`.
 * **Outages:** If the issuer is unreachable while the cached configuration or jwks is expired, the last known one keeps being used (a refetch is retried after `cooldown` / `jwksCooldown`), so a temporary issuer outage does not take your api down. Only if there never was a successful fetch the error is thrown (`5xx`), within the cooldown immediately without hitting the issuer again. Be aware that a stale jwks still contains keys the issuer removed in the meantime (e.g. a compromised one), so tokens signed with them stay valid while the stale jwks is used: `jwksMaxStale` bounds this window (default: one hour, after `jwksMaxAge + jwksMaxStale` since the last successful fetch, verification fails with the last jwks error until a refetch succeeds), `0` disables serving a stale jwks altogether, `Infinity` keeps using it for as long as the outage lasts. A failed or invalid discovery / jwks response is reported as `OidcConfigurationError` / `JwksError` (`@chubbyts/chubbyts-http-oidc/error`, with the original error as `cause`), errors of the fetch implementation itself (dns, connection refused, ...) are passed through as they are.
 * **Custom verifier:** A `TokenVerifier` is just `(token: string) => Promise<JWTPayload>`. Throw an `InvalidTokenError` (`@chubbyts/chubbyts-http-oidc/error`) to get the `401` response, any other error is rethrown.

### Service factories (chubbyts-dic-config)

The package ships service factories (abstract factories built on [chubbyts-dic-config-factory][16]) for a [chubbyts-dic-config][15] (or any [chubbyts-dic-types][14] compatible) container within `@chubbyts/chubbyts-http-oidc/service-factory`, configured through `config.chubbyts.oidc`. The implementation of the types gets read from the services `serverRequestHelpers`, `responseFactory` and `responseHelpers`, which have to be registered:

```ts
import type { ConfigFactory } from '@chubbyts/chubbyts-dic-config/dic-config';
import { createContainerByConfigFactory } from '@chubbyts/chubbyts-dic-config/dic-config';
import type { OidcConfig } from '@chubbyts/chubbyts-http-oidc/service-factory';
import { oidcAuthenticationMiddlewareServiceFactory } from '@chubbyts/chubbyts-http-oidc/service-factory';
import { createResponseFactory } from '@chubbyts/chubbyts-http/message-factory';
import { createResponseHelpers, createServerRequestHelpers } from '@chubbyts/chubbyts-http/message-helper';
import type { Middleware } from '@chubbyts/chubbyts-http-types/middleware';

const container = createContainerByConfigFactory({
  chubbyts: {
    oidc: {
      issuer: 'https://issuer.example.com', // required
      audience: 'https://api.example.com', // required
      realm: 'api',
      // fetch,
      // maxAge: 3600,
      // timeout: 5,
      // cooldown: 30,
      // algorithms: ['RS256'],
      // clockTolerance: 5,
      // typ: 'at+jwt',
      // requiredClaims: ['sub', 'iat', 'jti'],
      // jwksMaxAge: 600,
      // jwksTimeout: 5,
      // jwksCooldown: 30,
      // jwksMaxStale: 86400,
    } satisfies OidcConfig,
  },
  dependencies: {
    factories: new Map<string, ConfigFactory>([
      ['serverRequestHelpers', () => createServerRequestHelpers()],
      ['responseFactory', () => createResponseFactory()],
      ['responseHelpers', () => createResponseHelpers()],
      ['oidcAuthenticationMiddleware', oidcAuthenticationMiddlewareServiceFactory()],
    ]),
  },
})();

const oidcAuthenticationMiddleware = container.get<Middleware>('oidcAuthenticationMiddleware');
```

The `oidcAuthenticationMiddlewareServiceFactory` uses the services `oidcTokenExtractor`, `oidcTokenVerifier` and (the `jwtTokenVerifierServiceFactory` behind it) `oidcConfigurationResolver` of the container if registered, and creates them through the shipped `bearerTokenExtractorServiceFactory`, `jwtTokenVerifierServiceFactory` and `oidcConfigurationResolverServiceFactory` otherwise. Register any of them under its name to replace it (e.g. a custom `TokenVerifier`) or to share it with other services. A `logger` service is used if registered.

#### With names

To protect different parts of an api through different issuers / audiences, the same factories can be registered multiple times with a name: the config is then read from `config.chubbyts.oidc.<name>` and the name gets appended to each service id (`oidcAuthenticationMiddlewareapi`, `oidcTokenVerifierapi`, ...).

```ts
const container = createContainerByConfigFactory({
  chubbyts: {
    oidc: {
      api: { issuer: 'https://issuer.example.com', audience: 'https://api.example.com', realm: 'api' },
      admin: { issuer: 'https://admin-issuer.example.com', audience: 'https://admin.example.com', realm: 'admin' },
    } satisfies Record<string, OidcConfig>,
  },
  dependencies: {
    factories: new Map<string, ConfigFactory>([
      // serverRequestHelpers, responseFactory and responseHelpers like above
      ['oidcAuthenticationMiddlewareapi', oidcAuthenticationMiddlewareServiceFactory('api')],
      ['oidcAuthenticationMiddlewareadmin', oidcAuthenticationMiddlewareServiceFactory('admin')],
    ]),
  },
})();

const apiOidcAuthenticationMiddleware = container.get<Middleware>('oidcAuthenticationMiddlewareapi');
const adminOidcAuthenticationMiddleware = container.get<Middleware>('oidcAuthenticationMiddlewareadmin');
```

## Testing against a local OIDC provider

[Keycloak][5] as a docker container is the easiest way to test manually:

```sh
docker run --rm -p 8080:8080 \
  -e KC_BOOTSTRAP_ADMIN_USERNAME=admin \
  -e KC_BOOTSTRAP_ADMIN_PASSWORD=admin \
  quay.io/keycloak/keycloak:26.7 start-dev
```

Within the admin console at http://localhost:8080 (admin/admin) create a realm `test` and a client `api` with *Client authentication* and *Service accounts roles* enabled, then:

```sh
curl -X POST http://localhost:8080/realms/test/protocol/openid-connect/token \
  -d grant_type=client_credentials -d client_id=api -d client_secret=<client-secret>
```

```ts
const oidcConfigurationResolver = createOidcConfigurationResolver('http://localhost:8080/realms/test');
```

Keycloak specifics: access tokens contain `aud: "account"` until you add an *audience mapper*, have the header `typ: "JWT"` (not `at+jwt`) and the `iss` claim matches the URL the token was requested through, so use the same host for the resolver and the token request (or pin it, e.g. `KC_HOSTNAME=http://keycloak:8080` in docker compose). See [chubbyts-petstore][9] for a complete docker compose setup with an imported realm.

For automated tests [mock-oauth2-server][6] is a lightweight alternative which issues tokens without any setup. This repository's integration tests start it via [testcontainers][7] (docker compatible daemon required, set `MOCK_OAUTH2_SERVER_URL` to reuse a running one):

```sh
pnpm test:integration --run
```

## Copyright

2026 Dominik Zogg

[1]: https://www.npmjs.com/package/@chubbyts/chubbyts-http-oidc
[2]: https://www.npmjs.com/package/@chubbyts/chubbyts-log-types
[3]: https://www.npmjs.com/package/@chubbyts/chubbyts-http-types
[4]: https://www.npmjs.com/package/jose
[5]: https://www.keycloak.org
[6]: https://github.com/navikt/mock-oauth2-server
[7]: https://www.npmjs.com/package/testcontainers
[8]: https://www.npmjs.com/package/@chubbyts/chubbyts-http
[9]: https://github.com/chubbyts/chubbyts-petstore
[10]: https://openid.net/specs/openid-connect-discovery-1_0.html
[11]: https://www.rfc-editor.org/rfc/rfc7517
[12]: https://www.rfc-editor.org/rfc/rfc9068
[13]: https://www.rfc-editor.org/rfc/rfc6750
[14]: https://www.npmjs.com/package/@chubbyts/chubbyts-dic-types
[15]: https://www.npmjs.com/package/@chubbyts/chubbyts-dic-config
[16]: https://www.npmjs.com/package/@chubbyts/chubbyts-dic-config-factory
