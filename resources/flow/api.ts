// the api call as seen by this library, shared by all flows: the client sends the access token as bearer token, the
// backend verifies it against the auth provider and either calls the handler or rejects the request
import type { Item, Line, Segment } from './diagram.ts';
import { b, link, m, muted, r, rm } from './diagram.ts';

const OIDC_CORE = 'https://openid.net/specs/openid-connect-core-1_0.html';
const RFC = (number: number): string => `https://www.rfc-editor.org/rfc/rfc${number}`;

export const SPEC = {
  'OpenID Connect Core 1.0': OIDC_CORE,
  'OIDC Core 1.0 §3.1': `${OIDC_CORE}#CodeFlowAuth`,
  'OIDC Core 1.0 §3.1.3.7': `${OIDC_CORE}#IDTokenValidation`,
  'OpenID Connect Discovery 1.0': 'https://openid.net/specs/openid-connect-discovery-1_0.html',
  'OpenID Connect RP-Initiated Logout 1.0': 'https://openid.net/specs/openid-connect-rpinitiated-1_0.html',
  'RFC 6749': RFC(6749),
  'RFC 6749 §4.4': `${RFC(6749)}#section-4.4`,
  'RFC 6750': RFC(6750),
  'RFC 7517': RFC(7517),
  'RFC 7519': RFC(7519),
  'RFC 7523': RFC(7523),
  'RFC 7636': RFC(7636),
  'RFC 8705': RFC(8705),
  'RFC 9068': RFC(9068),
  'RFC 9700': RFC(9700),
  'OAuth 2.0 for Browser-Based Apps': 'https://datatracker.ietf.org/doc/draft-ietf-oauth-browser-based-apps/',
} as const;

export type Spec = keyof typeof SPEC;

export const spec = (name: Spec, style: Omit<Segment, 't' | 'href'> = {}): Segment => link(name, SPEC[name], style);

const SOURCE = 'https://github.com/chubbyts/chubbyts-http-oidc/blob/master/src';

// a module of this library, linked to its source
export const src = (name: 'middleware' | 'token' | 'discovery' | 'service-factory', prefix = ''): Segment => {
  return link(`${prefix}${name}`, `${SOURCE}/${name}.ts`, { color: muted('').color });
};

export const jose = link('jose', 'https://github.com/panva/jose');

export const keycloak = link('Keycloak', 'https://www.keycloak.org');

export const backend = {
  id: 'be',
  color: 'green',
  title: 'Backend (BE)',
  subtitle: 'API · OAuth 2.0 Resource Server · this library',
  bullets: [
    ['extracts the Bearer token from the ', m('Authorization'), ' header'],
    'resolves the discovery document, fetches and caches the JWKS',
    [
      'verifies signature, ',
      m('iss'),
      ', ',
      m('aud'),
      ', ',
      m('exp'),
      ', ',
      m('nbf'),
      ' (+ ',
      m('typ'),
      ', required claims)',
    ],
    ['responds 401 + ', m('WWW-Authenticate'), ', or passes the claims on'],
    'stateless: no session, no client secret, never sees a password',
  ],
} as const;

export const discoveryBullets: ReadonlyArray<Line> = [
  'signs the tokens with its private key (RS256, ES256, ...)',
  ['publishes ', m('/.well-known/openid-configuration'), ' (discovery)'],
  ['publishes its public keys at the ', m('jwks_uri'), ' (JWKS)'],
];

export const apiCall = (client: string, op: string, request: ReadonlyArray<Line>): ReadonlyArray<Item> => [
  { kind: 'arrow', from: client, to: backend.id, lines: request },
  {
    kind: 'note',
    lane: backend.id,
    lines: [
      [b('createOidcAuthenticationMiddleware'), '(extractor, verifier, realm, logger)'],
      [src('middleware'), ' · or via the service factories in ', src('service-factory')],
      [m('createBearerTokenExtractor()'), src('token', '   ')],
      ['reads the ', m('Authorization'), ' header: ', m('/^Bearer +(\\S+)$/i'), ' → token'],
    ],
  },
  {
    kind: 'note',
    lane: backend.id,
    lines: [[b('no token')], ['401 ', m('WWW-Authenticate: Bearer realm="api"'), ' · the handler is not called']],
    error: true,
  },
  {
    kind: 'note',
    lane: backend.id,
    lines: [
      [b('createJwtTokenVerifier'), '(resolver, { audience, ... })', src('token', '   ')],
      ['asks the ', m('OidcConfigurationResolver'), ' first, lazily on the first token'],
    ],
  },
  {
    kind: 'arrow',
    from: backend.id,
    to: op,
    lines: [
      ['GET ', m('{issuer}/.well-known/openid-configuration')],
      [muted('cached for maxAge (1h), timeout 5s, no redirects · mostly served from the cache')],
    ],
  },
  {
    kind: 'arrow',
    from: op,
    to: backend.id,
    lines: [['200 ', m('{ issuer, jwks_uri, authorization_endpoint, token_endpoint, ... }')]],
    response: true,
  },
  {
    kind: 'note',
    lane: backend.id,
    lines: [
      [b('createOidcConfigurationResolver'), '(issuer)', src('discovery', '   ')],
      [m('issuer'), ' must be exactly the configured one (trailing slash!)'],
      [m('jwks_uri'), ' must be http(s), and https if the issuer is https'],
      ['outage: last known configuration, retry after ', m('cooldown'), ' (30s)'],
      [rm('OidcConfigurationError'), r(' (never fetched) → rethrown → 5xx')],
    ],
  },
  {
    kind: 'arrow',
    from: backend.id,
    to: op,
    lines: [
      ['GET ', m('jwks_uri')],
      [muted('cached for jwksMaxAge (10min), timeout 5s')],
      [muted('unknown kid (key rotation) → refetch, max. once per jwksCooldown (30s)')],
    ],
  },
  {
    kind: 'arrow',
    from: op,
    to: backend.id,
    lines: [['200 ', m('{ keys: [ { kid, kty, alg, use, n, e }, ... ] }'), '  public keys only']],
    response: true,
  },
  {
    kind: 'note',
    lane: backend.id,
    lines: [
      [b('verify the JWT'), ' with ', jose, ' ', m('jwtVerify(token, keys, options)')],
      ['signature with the key named by the ', m('kid'), ' header'],
      ['asymmetric algorithms only, never ', m('HS*'), ' (', m('SUPPORTED_ALGORITHMS'), ')'],
      [m('iss'), ' == configuration.issuer · ', m('aud'), ' contains ', m('audience')],
      [
        m('exp'),
        ' and ',
        m('nbf'),
        ' (± ',
        m('clockTolerance'),
        ') · ',
        m('typ'),
        ' (e.g. ',
        m('at+jwt'),
        ') · ',
        m('requiredClaims'),
      ],
      ['JWKS outage: last known keys for ', m('jwksMaxStale'), ' (1h),'],
      ['then ', rm('JwksError'), r(' → rethrown → 5xx')],
    ],
  },
  {
    kind: 'note',
    lane: backend.id,
    lines: [
      [b('invalid token')],
      ['expired, wrong signature / ', m('iss'), ' / ', m('aud'), ', unknown ', m('kid'), ', ...'],
      ['→ ', m('InvalidTokenError'), ' (a custom ', m('TokenVerifier'), ' throws it too)'],
      [
        '401 ',
        m(
          'WWW-Authenticate: Bearer realm="api", error="invalid_token", error_description="The access token is invalid or expired"',
        ),
      ],
      ['the real reason is only logged (level ', m('info'), '), never sent to the client'],
    ],
    error: true,
  },
  {
    kind: 'note',
    lane: backend.id,
    lines: [
      [b('valid token → handler')],
      [m('attributes.oidc = { token, claims }'), ' (type ', m('OidcAttributes'), ')'],
      ['authorization (roles, ', m('scope'), ', ownership) is up to the handler'],
      [m('token'), ' can be forwarded to downstream APIs, treat it as sensitive'],
    ],
  },
  {
    kind: 'arrow',
    from: backend.id,
    to: client,
    lines: [
      ['200 ', m('{ ... }'), '  ·  or 401 with the challenge above (expose ', m('WWW-Authenticate'), ' via CORS)'],
    ],
    response: true,
  },
];

const COMMON_SPECS: ReadonlyArray<[Spec, string]> = [
  ['OpenID Connect Core 1.0', ''],
  ['OpenID Connect Discovery 1.0', ''],
  ['RFC 6749', 'OAuth 2.0'],
  ['RFC 6750', 'Bearer'],
  ['RFC 7517', 'JWK'],
  ['RFC 7519', 'JWT'],
  ['RFC 9068', 'JWT access tokens'],
];

// the specs line of the legend: the common ones plus the flow specific ones, each name linked
export const specs = (...additional: ReadonlyArray<[Spec, string]>): Line => {
  return [
    'Specs: ',
    ...[...COMMON_SPECS, ...additional].flatMap(([name, topic], i) => [
      ...(i > 0 ? [', '] : []),
      spec(name),
      ...(topic ? [` (${topic})`] : []),
    ]),
  ];
};
