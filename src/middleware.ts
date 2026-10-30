import type { JWTPayload } from 'jose';
import type { Logger } from '@chubbyts/chubbyts-log-types/dist/log';
import { createLogger } from '@chubbyts/chubbyts-log-types/dist/log';
import type { Handler } from '@chubbyts/chubbyts-http-types/handler';
import type { Attributes, Response, ServerRequest } from '@chubbyts/chubbyts-http-types/message';
import type { ResponseFactory } from '@chubbyts/chubbyts-http-types/message-factory';
import type { ResponseHelpers, ServerRequestHelpers } from '@chubbyts/chubbyts-http-types/message-helper';
import type { Middleware } from '@chubbyts/chubbyts-http-types/middleware';
import { InvalidTokenError } from './error.js';
import type { TokenExtractor, TokenVerifier } from './token.js';

export type OidcAttributes = {
  readonly oidc: {
    readonly token: string;
    readonly claims: JWTPayload;
  };
};

// quoted-string (rfc 7230): a backslash escapes the next char and control chars are not allowed at all (crlf would
// even make the header construction throw), so drop them and downgrade double quotes to single quotes
const sanitizeChallengeValue = (value: string): string => {
  // oxlint-disable-next-line no-control-regex
  return value.replaceAll(/[\\\u0000-\u001f\u007f]/g, '').replaceAll('"', "'");
};

// jose claim errors carry the whole (unverified) token payload (sub, email, ...): log only what describes the failure
const formatCause = (cause: unknown): unknown => {
  if (!(cause instanceof Error)) {
    return cause;
  }

  const { code } = cause as { code?: unknown };

  return { name: cause.name, message: cause.message, ...(typeof code === 'string' ? { code } : {}) };
};

const formatChallengeParameter = ([key, value]: [string, string]): string => {
  return ` ${key}="${sanitizeChallengeValue(value)}"`;
};

const createChallenge = (realm: string | undefined, parameters: Record<string, string>): string => {
  const allParameters = Object.entries({ ...(realm ? { realm } : {}), ...parameters });

  return `Bearer${allParameters.map(formatChallengeParameter).join(',')}`;
};

const createUnauthorizedResponse = (
  responseFactory: ResponseFactory,
  responseHelpers: ResponseHelpers,
  challenge: string,
): Response => {
  return responseHelpers.withHeader(responseFactory(401, 'Unauthorized'), 'www-authenticate', challenge);
};

export const createOidcAuthenticationMiddleware = (
  responseFactory: ResponseFactory,
  responseHelpers: ResponseHelpers,
  serverRequestHelpers: ServerRequestHelpers,
  tokenExtractor: TokenExtractor,
  tokenVerifier: TokenVerifier,
  realm?: string,
  logger: Logger = createLogger(),
): Middleware<Attributes, OidcAttributes> => {
  // created and changed through the injected implementation only: the middleware works with any of them
  return async (request: ServerRequest, handler: Handler<OidcAttributes>): Promise<Response> => {
    const token = tokenExtractor(request);

    if (!token) {
      return createUnauthorizedResponse(responseFactory, responseHelpers, createChallenge(realm, {}));
    }

    // oxlint-disable-next-line functional/no-let
    let claims: JWTPayload;

    // only the verification is guarded: an InvalidTokenError thrown by the handler (or a middleware behind it) is not
    // this middleware's business and gets rethrown like any other handler error
    try {
      claims = await tokenVerifier(token);
    } catch (error) {
      if (!(error instanceof InvalidTokenError)) {
        throw error;
      }

      logger.info('Invalid token', {
        method: request.method,
        // the query string is left out on purpose: it may carry sensitive data (api keys, session ids, ...)
        pathname: request.uri.path,
        error: { name: error.name, message: error.message, cause: formatCause(error.cause) },
      });

      // do not reflect the verification error to the client: it may leak internal details (issuer, jwks uri, ...)
      return createUnauthorizedResponse(
        responseFactory,
        responseHelpers,
        createChallenge(realm, {
          error: 'invalid_token',
          error_description: 'The access token is invalid or expired',
        }),
      );
    }

    return handler(serverRequestHelpers.withAttribute(request, 'oidc', { token, claims }));
  };
};
