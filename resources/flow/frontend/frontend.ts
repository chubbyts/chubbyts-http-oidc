// content of frontend.svg, rendered by ../generate.ts
import { apiCall, backend, discoveryBullets, keycloak, spec, specs } from '../api.ts';
import type { Diagram } from '../diagram.ts';
import { b, m, muted, r } from '../diagram.ts';

export const diagram: Diagram = {
  title: 'OpenID Connect for a frontend flow',
  intro:
    'Authorization Code Flow with PKCE between a browser app and the Auth Provider, the access token as Bearer token towards the Backend, the Backend verifying it with this library.',
  label:
    'OpenID Connect for a frontend flow: the frontend logs the user in at the auth provider with the authorization code flow and PKCE, calls the backend with the access token as bearer token, and the backend (this library) verifies the token via the auth provider discovery document and JWKS.',
  participants: [
    {
      id: 'fe',
      color: 'blue',
      title: 'Frontend (FE)',
      subtitle: 'SPA in the browser · Relying Party · public client',
      bullets: [
        'starts the login, generates state, nonce and the PKCE code_verifier',
        'exchanges the code for tokens, validates the ID token',
        'knows who the user is (ID token), keeps the tokens in memory',
        'calls the API with the access token as Bearer token',
        'refreshes the tokens, handles 401, logs the user out',
      ],
    },
    {
      id: 'op',
      color: 'purple',
      title: 'Auth Provider (OP)',
      subtitle: ['OpenID Provider / Auth Server · e.g. ', keycloak],
      bullets: [
        'authenticates the user (login page, MFA, consent)',
        'issues code, ID token, access token and refresh token',
        ...discoveryBullets,
      ],
    },
    backend,
  ],
  items: [
    // ---------------------------------------------------------------- phase 1: login
    {
      kind: 'band',
      title: 'Phase 1 · Login',
      subtitle: [
        'Authorization Code Flow with PKCE · ',
        spec('OIDC Core 1.0 §3.1'),
        ' + ',
        spec('RFC 7636'),
        ' · only FE and Auth Provider, the Backend is not involved',
      ],
    },
    {
      kind: 'note',
      lane: 'fe',
      lines: [
        [b('prepare the login '), muted('(per attempt)')],
        ['discovery: read the endpoints from ', m('{issuer}/.well-known/openid-configuration')],
        [m('state'), ' random, protects against CSRF on the redirect back'],
        [m('nonce'), ' random, binds the ID token to this login'],
        [m('code_verifier'), ' random (PKCE), ', m('code_challenge = BASE64URL(SHA256(code_verifier))')],
        ['remember ', m('state'), ', ', m('nonce'), ', ', m('code_verifier'), ' (sessionStorage)'],
      ],
    },
    {
      kind: 'arrow',
      from: 'fe',
      to: 'op',
      lines: [
        ['redirect the browser to the ', m('authorization_endpoint')],
        [m('response_type=code client_id redirect_uri scope=openid profile email')],
        [m('state nonce code_challenge code_challenge_method=S256')],
      ],
    },
    {
      kind: 'note',
      lane: 'op',
      lines: [
        [b('authenticate the user')],
        'login page (password, MFA), consent for the requested scopes',
        ['keep ', m('code_challenge'), ' and ', m('nonce'), ' next to the one-time, short-lived code'],
      ],
    },
    { kind: 'arrow', from: 'op', to: 'fe', lines: [['302 ', m('redirect_uri?code=…&state=…')]], response: true },
    { kind: 'note', lane: 'fe', lines: [[b('check '), m('state'), ' equals the remembered one, otherwise abort']] },
    {
      kind: 'arrow',
      from: 'fe',
      to: 'op',
      lines: [
        ['POST ', m('token_endpoint'), ' (back channel, no browser redirect)'],
        [m('grant_type=authorization_code code redirect_uri client_id code_verifier')],
      ],
    },
    {
      kind: 'note',
      lane: 'op',
      lines: [
        [b('exchange the code')],
        ['PKCE check: ', m('code_verifier'), ' must hash to the stored ', m('code_challenge')],
        ['sign the tokens with the private key, the ', m('kid'), ' header names the key'],
        [m('id_token'), ' (', m('aud = client_id'), '): for the FE, who the user is'],
        [m('access_token'), ' (', m('aud = API'), '): for the BE, what may be called'],
      ],
    },
    {
      kind: 'arrow',
      from: 'op',
      to: 'fe',
      lines: [['200 ', m('{ id_token, access_token, refresh_token, expires_in }')]],
      response: true,
    },
    {
      kind: 'note',
      lane: 'fe',
      lines: [
        [
          b('validate the ID token '),
          muted('('),
          spec('OIDC Core 1.0 §3.1.3.7', { color: muted('').color }),
          muted(')'),
        ],
        [
          'signature (key from the ',
          m('jwks_uri'),
          '), ',
          m('iss'),
          ' == issuer, ',
          m('aud'),
          ' == ',
          m('client_id'),
          ',',
        ],
        [m('nonce'), ' == the remembered one, ', m('exp'), ' in the future'],
        [
          'identity claims: ',
          m('sub'),
          ', ',
          m('name'),
          ', ',
          m('email'),
          ', ... (or the ',
          m('userinfo_endpoint'),
          ')',
        ],
        'keep the tokens in memory, forget state / nonce / code_verifier',
        [r('the ID token is for the FE only, the access token is for the API')],
      ],
    },
    // ---------------------------------------------------------------- phase 2: api call
    {
      kind: 'band',
      title: 'Phase 2 · API call',
      subtitle: [
        'the access token as Bearer token · ',
        spec('RFC 6750'),
        ' · the Backend verifies it against the Auth Provider, the user is not involved',
      ],
    },
    ...apiCall('fe', 'op', [['GET ', m('/api/pets')], [m('Authorization: Bearer <access_token>')]]),
    // ---------------------------------------------------------------- phase 3: token lifetime
    {
      kind: 'band',
      title: 'Phase 3 · Token lifetime',
      subtitle:
        'refresh and logout · only FE and Auth Provider · the Backend just checks exp, an issued access token stays valid until then',
    },
    {
      kind: 'arrow',
      from: 'fe',
      to: 'op',
      lines: [
        ['POST ', m('token_endpoint'), ' (before ', m('expires_in'), ' runs out, or after a 401)'],
        [m('grant_type=refresh_token refresh_token client_id')],
      ],
    },
    {
      kind: 'arrow',
      from: 'op',
      to: 'fe',
      lines: [['200 ', m('{ access_token, id_token, refresh_token, expires_in }'), '  refresh token rotated']],
      response: true,
    },
    { kind: 'note', lane: 'fe', lines: [[b('logout')], 'drop the tokens from memory, then RP-Initiated Logout:'] },
    {
      kind: 'arrow',
      from: 'fe',
      to: 'op',
      lines: [
        ['redirect the browser to the ', m('end_session_endpoint')],
        [m('id_token_hint=… post_logout_redirect_uri=…')],
      ],
    },
    { kind: 'note', lane: 'op', lines: ['ends the user session (SSO cookie) and redirects back'] },
  ],
  specs: specs(['RFC 7636', 'PKCE'], ['OAuth 2.0 for Browser-Based Apps', '']),
};
