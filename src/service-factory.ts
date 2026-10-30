import type { Container } from '@chubbyts/chubbyts-dic-types/dist/container';
import { createAbstractFactory } from '@chubbyts/chubbyts-dic-config-factory/dist/dic-config-factory';
import type { Logger } from '@chubbyts/chubbyts-log-types/dist/log';
import type { Attributes } from '@chubbyts/chubbyts-http-types/message';
import type { ResponseFactory } from '@chubbyts/chubbyts-http-types/message-factory';
import type { ResponseHelpers, ServerRequestHelpers } from '@chubbyts/chubbyts-http-types/message-helper';
import type { Middleware } from '@chubbyts/chubbyts-http-types/middleware';
import type { OidcConfigurationResolver, OidcConfigurationResolverOptions } from './discovery.js';
import { createOidcConfigurationResolver } from './discovery.js';
import type { OidcAttributes } from './middleware.js';
import { createOidcAuthenticationMiddleware } from './middleware.js';
import type { JwtTokenVerifierOptions, TokenExtractor, TokenVerifier } from './token.js';
import { createBearerTokenExtractor, createJwtTokenVerifier } from './token.js';

/**
 * The configuration read by the service factories from `config.chubbyts.oidc` (or `config.chubbyts.oidc.<name>` for
 * named factories), see the options of `createOidcConfigurationResolver`, `createJwtTokenVerifier` and
 * `createOidcAuthenticationMiddleware`.
 */
export type OidcConfig = {
  issuer: string;
  realm?: string;
} & OidcConfigurationResolverOptions &
  JwtTokenVerifierOptions;

// the http-types implementation (e.g. @chubbyts/chubbyts-http) gets shared by all services of the container
const serverRequestHelpersId = 'serverRequestHelpers';
const responseFactoryId = 'responseFactory';
const responseHelpersId = 'responseHelpers';

type Config = {
  chubbyts: {
    oidc: OidcConfig | Record<string, OidcConfig>;
  };
};

export const bearerTokenExtractorServiceFactory = createAbstractFactory((container: Container): TokenExtractor => {
  return createBearerTokenExtractor(container.get<ServerRequestHelpers>(serverRequestHelpersId));
});

export const oidcConfigurationResolverServiceFactory = createAbstractFactory(
  (container: Container, { resolveConfig }): OidcConfigurationResolver => {
    const oidcConfig = resolveConfig(container.get<Config>('config').chubbyts.oidc);

    return createOidcConfigurationResolver(oidcConfig.issuer, oidcConfig);
  },
);

export const jwtTokenVerifierServiceFactory = createAbstractFactory(
  (container: Container, { resolveConfig, resolveDependency }): TokenVerifier => {
    const oidcConfig = resolveConfig(container.get<Config>('config').chubbyts.oidc);

    // a registered service wins over the shipped factory, so that any part can be replaced or shared between services
    const oidcConfigurationResolver = resolveDependency(
      container,
      'oidcConfigurationResolver',
      oidcConfigurationResolverServiceFactory,
    );

    return createJwtTokenVerifier(oidcConfigurationResolver, oidcConfig);
  },
);

export const oidcAuthenticationMiddlewareServiceFactory = createAbstractFactory(
  (container: Container, { resolveConfig, resolveDependency }): Middleware<Attributes, OidcAttributes> => {
    const { realm } = resolveConfig(container.get<Config>('config').chubbyts.oidc);

    return createOidcAuthenticationMiddleware(
      container.get<ResponseFactory>(responseFactoryId),
      container.get<ResponseHelpers>(responseHelpersId),
      container.get<ServerRequestHelpers>(serverRequestHelpersId),
      resolveDependency(container, 'oidcTokenExtractor', bearerTokenExtractorServiceFactory),
      resolveDependency(container, 'oidcTokenVerifier', jwtTokenVerifierServiceFactory),
      realm,
      container.has('logger') ? container.get<Logger>('logger') : undefined,
    );
  },
);
