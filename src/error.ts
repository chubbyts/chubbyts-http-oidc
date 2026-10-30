/**
 * Thrown by a token verifier if the given token itself is invalid (malformed, wrong signature, expired, wrong
 * issuer / audience, ...). Any other error thrown by a token verifier is treated as an internal failure
 * (unreachable discovery / jwks endpoint, ...) and gets rethrown by the middleware.
 */
export class InvalidTokenError extends Error {
  public constructor(message: string, cause?: unknown) {
    super(message, { cause });
    // oxlint-disable-next-line functional/immutable-data
    this.name = 'InvalidTokenError';
  }
}

/**
 * Thrown by the oidc configuration resolver if the openid configuration cannot be fetched from the issuer
 * (non 2xx status, timeout, invalid json) or is invalid (issuer mismatch, missing / insecure jwks_uri, ...).
 * Treated as an internal failure by the middleware.
 */
export class OidcConfigurationError extends Error {
  public constructor(message: string, cause?: unknown) {
    super(message, { cause });
    // oxlint-disable-next-line functional/immutable-data
    this.name = 'OidcConfigurationError';
  }
}

/**
 * Thrown by the jwt token verifier if the JSON Web Key Set cannot be fetched from the jwks_uri (non 200 status,
 * timeout, invalid json) or is malformed. Treated as an internal failure by the middleware.
 */
export class JwksError extends Error {
  public constructor(message: string, cause?: unknown) {
    super(message, { cause });
    // oxlint-disable-next-line functional/immutable-data
    this.name = 'JwksError';
  }
}
