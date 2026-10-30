// content of machine-to-machine.svg, rendered by ../generate.ts
import { apiCall, backend, discoveryBullets, keycloak, spec, specs } from '../api.ts';
import type { Diagram } from '../diagram.ts';
import { b, m, muted, r } from '../diagram.ts';

export const diagram: Diagram = {
  title: 'OAuth 2.0 for a machine-to-machine flow',
  intro:
    'Client Credentials Grant: a service gets an access token for itself from the Auth Provider, no user involved, and calls the Backend with it as Bearer token, the Backend verifying it with this library.',
  label:
    'OAuth 2.0 for a machine-to-machine flow: a service authenticates itself at the auth provider with the client credentials grant, calls the backend with the access token as bearer token, and the backend (this library) verifies the token via the auth provider discovery document and JWKS.',
  participants: [
    {
      id: 'svc',
      color: 'blue',
      title: 'Service',
      subtitle: 'other backend, job, pipeline · confidential client',
      bullets: [
        'no user, no browser, no ID token',
        ['authenticates itself at the token endpoint (', m('client_secret'), ' or private key)'],
        ['caches the access token until ', m('expires_in'), ' runs out'],
        'calls the API with the access token as Bearer token',
        'keeps the secret out of the code (env, secret store), rotates it',
      ],
    },
    {
      id: 'op',
      color: 'purple',
      title: 'Auth Provider (OP)',
      subtitle: ['OpenID Provider / Auth Server · e.g. ', keycloak],
      bullets: [
        [
          'authenticates the client (',
          m('client_secret_basic'),
          ', ',
          m('client_secret_post'),
          ', ',
          m('private_key_jwt'),
          ')',
        ],
        'issues an access token for the client itself (its service account)',
        ...discoveryBullets,
      ],
    },
    backend,
  ],
  items: [
    // ---------------------------------------------------------------- phase 1: get a token
    {
      kind: 'band',
      title: 'Phase 1 · Get a token',
      subtitle: [
        'Client Credentials Grant · ',
        spec('RFC 6749 §4.4'),
        ' · only Service and Auth Provider, no user is involved',
      ],
    },
    {
      kind: 'note',
      lane: 'svc',
      lines: [
        [b('prepare')],
        ['discovery: read the ', m('token_endpoint'), ' from ', m('{issuer}/.well-known/openid-configuration')],
        ['load ', m('client_id'), ' and ', m('client_secret'), ' (or the private key) from the environment'],
      ],
    },
    {
      kind: 'arrow',
      from: 'svc',
      to: 'op',
      lines: [
        ['POST ', m('token_endpoint')],
        [m('grant_type=client_credentials scope=…')],
        ['client authentication: ', m('Authorization: Basic base64(client_id:client_secret)')],
        [
          muted('(client_secret_basic) or a signed client_assertion (private_key_jwt, '),
          spec('RFC 7523', { color: muted('').color }),
          muted(')'),
        ],
      ],
    },
    {
      kind: 'note',
      lane: 'op',
      lines: [
        [b('authenticate the client')],
        [
          'check ',
          m('client_secret'),
          ' / ',
          m('client_assertion'),
          ', the requested ',
          m('scope'),
          ' must be allowed for the client',
        ],
        ['mint and sign the access token: ', m('sub'), ' = the service account of the client,'],
        [m('aud = API'), ' (', keycloak, ': audience mapper, otherwise ', m('aud: "account"'), ')'],
        ['no ', m('id_token'), ' (no user), usually no ', m('refresh_token')],
      ],
    },
    {
      kind: 'arrow',
      from: 'op',
      to: 'svc',
      lines: [['200 ', m('{ access_token, expires_in, token_type: "Bearer" }')]],
      response: true,
    },
    {
      kind: 'note',
      lane: 'svc',
      lines: [
        [b('cache the token')],
        ['reuse it until ', m('expires_in'), ' runs out (minus a safety margin), then request a new one'],
        [r('one token request per token lifetime, not per API call')],
      ],
    },
    // ---------------------------------------------------------------- phase 2: api call
    {
      kind: 'band',
      title: 'Phase 2 · API call',
      subtitle: [
        'the access token as Bearer token · ',
        spec('RFC 6750'),
        ' · the Backend verifies it against the Auth Provider, no difference to a user token',
      ],
    },
    ...apiCall('svc', 'op', [['GET ', m('/api/pets')], [m('Authorization: Bearer <access_token>')]]),
    {
      kind: 'note',
      lane: 'svc',
      lines: [['401 ', m('invalid_token'), ' → drop the cached token, request a new one and retry once']],
    },
    // ---------------------------------------------------------------- phase 3: token lifetime
    {
      kind: 'band',
      title: 'Phase 3 · Token lifetime',
      subtitle: 'no refresh token, just a new token request · the Backend authorizes by the claims of the client',
    },
    {
      kind: 'arrow',
      from: 'svc',
      to: 'op',
      lines: [
        ['POST ', m('token_endpoint'), ' (before ', m('expires_in'), ' runs out)'],
        [m('grant_type=client_credentials')],
      ],
    },
    {
      kind: 'arrow',
      from: 'op',
      to: 'svc',
      lines: [['200 ', m('{ access_token, expires_in, token_type: "Bearer" }')]],
      response: true,
    },
    {
      kind: 'note',
      lane: 'be',
      lines: [
        [b('authorization of a client token')],
        [
          m('sub'),
          ' / ',
          m('azp'),
          ' / ',
          m('client_id'),
          ' identify the calling service, ',
          m('scope'),
          ' and roles what it may do',
        ],
        ['the handler decides, the middleware only verifies the token'],
      ],
    },
    {
      kind: 'note',
      lane: 'svc',
      lines: [
        [b('secrets')],
        [
          'rotate the ',
          m('client_secret'),
          ' regularly, prefer ',
          m('private_key_jwt'),
          ' or mTLS (',
          spec('RFC 8705'),
          ')',
        ],
      ],
    },
  ],
  specs: specs(
    ['RFC 7523', 'JWT client authentication'],
    ['RFC 8705', 'mTLS'],
    ['RFC 9700', 'OAuth 2.0 Security Best Current Practice'],
  ),
};
