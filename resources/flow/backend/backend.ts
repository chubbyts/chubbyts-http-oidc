// content of backend.svg, rendered by ../generate.ts
import { apiCall, backend, discoveryBullets, spec, specs } from '../api.ts';
import type { Diagram } from '../diagram.ts';
import { b, m, muted, r } from '../diagram.ts';

export const diagram: Diagram = {
  title: 'OpenID Connect for a backend flow',
  intro:
    'Authorization Code Flow with PKCE run by a server-side web app (backend for frontend), the browser only holds a session cookie, the web app calls the Backend with the access token as Bearer token, the Backend verifying it with this library.',
  label:
    'OpenID Connect for a backend flow: a server-side web app logs the user in at the auth provider with the authorization code flow, keeps the tokens in a server-side session behind a cookie, calls the backend with the access token as bearer token, and the backend (this library) verifies the token via the auth provider discovery document and JWKS.',
  // four lanes within the same width as the three lanes of the other flows
  layout: { laneGap: 220, participantWidth: 220, noteWidth: 220 },
  participants: [
    {
      id: 'ua',
      color: 'orange',
      title: 'Browser',
      subtitle: 'user agent · HTML pages, no tokens',
      bullets: [
        'renders the pages of the Web App',
        'follows the redirects to and from the Auth Provider',
        ['holds a ', m('HttpOnly'), ' session cookie, never a token'],
        'talks to the Web App only, not to the API',
      ],
    },
    {
      id: 'app',
      color: 'blue',
      title: 'Web App (BFF)',
      subtitle: 'server-side · Relying Party · confidential client',
      bullets: [
        'runs the login (state, nonce, PKCE) server-side',
        ['authenticates itself at the token endpoint with its ', m('client_secret')],
        'validates the ID token, keeps the tokens in the server-side session',
        'calls the API with the access token as Bearer token',
        'refreshes the tokens, logs the user out',
      ],
    },
    {
      id: 'op',
      color: 'purple',
      title: 'Auth Provider (OP)',
      subtitle: 'OpenID Provider / Auth Server',
      bullets: [
        'authenticates the user (login page, MFA, consent)',
        ['authenticates the client (', m('client_secret'), ' or ', m('private_key_jwt'), ')'],
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
        'Authorization Code Flow with PKCE, confidential client · ',
        spec('OIDC Core 1.0 §3.1'),
        ' + ',
        spec('RFC 7636'),
        ' · the Backend is not involved',
      ],
    },
    { kind: 'arrow', from: 'ua', to: 'app', lines: [['GET ', m('/login')]] },
    {
      kind: 'note',
      lane: 'app',
      lines: [
        [b('prepare the login')],
        ['discovery: read the endpoints from ', m('{issuer}/.well-known/openid-configuration')],
        [
          m('state'),
          ', ',
          m('nonce'),
          ', ',
          m('code_verifier'),
          ' random, ',
          m('code_challenge = BASE64URL(SHA256(code_verifier))'),
        ],
        ['PKCE is recommended for confidential clients too (', spec('RFC 9700'), ')'],
        'remember them in the server-side session, start it with a cookie',
      ],
    },
    {
      kind: 'arrow',
      from: 'app',
      to: 'ua',
      lines: [
        ['302 ', m('authorization_endpoint'), ' + ', m('Set-Cookie: session=…')],
        [m('response_type=code client_id redirect_uri scope=openid profile email')],
        [m('state nonce code_challenge code_challenge_method=S256')],
      ],
      response: true,
    },
    { kind: 'arrow', from: 'ua', to: 'op', lines: [['GET ', m('authorization_endpoint'), ' (follows the redirect)']] },
    {
      kind: 'note',
      lane: 'op',
      lines: [
        [b('authenticate the user')],
        'login page (password, MFA), consent for the requested scopes',
        ['keep ', m('code_challenge'), ' and ', m('nonce'), ' next to the one-time, short-lived code'],
      ],
    },
    { kind: 'arrow', from: 'op', to: 'ua', lines: [['302 ', m('redirect_uri?code=…&state=…')]], response: true },
    {
      kind: 'arrow',
      from: 'ua',
      to: 'app',
      lines: [['GET ', m('/callback?code=…&state=…'), ' + ', m('Cookie: session=…')]],
    },
    {
      kind: 'note',
      lane: 'app',
      lines: [[b('check '), m('state'), ' equals the one in the session, otherwise abort']],
    },
    {
      kind: 'arrow',
      from: 'app',
      to: 'op',
      lines: [
        ['POST ', m('token_endpoint'), ' (back channel)'],
        [m('grant_type=authorization_code code redirect_uri code_verifier')],
        ['client authentication: ', m('Authorization: Basic base64(client_id:client_secret)')],
        [muted('(client_secret_basic) or a signed client_assertion (private_key_jwt)')],
      ],
    },
    {
      kind: 'note',
      lane: 'op',
      lines: [
        [b('exchange the code')],
        ['authenticate the client: ', m('client_secret'), ' / ', m('client_assertion')],
        ['PKCE check: ', m('code_verifier'), ' must hash to the stored ', m('code_challenge')],
        ['sign the tokens with the private key, the ', m('kid'), ' header names the key'],
        [m('id_token'), ' (', m('aud = client_id'), '): for the Web App, who the user is'],
        [m('access_token'), ' (', m('aud = API'), '): for the BE, what may be called'],
      ],
    },
    {
      kind: 'arrow',
      from: 'op',
      to: 'app',
      lines: [['200 ', m('{ id_token, access_token, refresh_token, expires_in }')]],
      response: true,
    },
    {
      kind: 'note',
      lane: 'app',
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
          ', ',
          m('aud'),
          ' == ',
          m('client_id'),
          ', ',
          m('nonce'),
          ', ',
          m('exp'),
        ],
        ['identity claims: ', m('sub'), ', ', m('name'), ', ', m('email'), ', ...'],
        'store the tokens in the server-side session (memory, redis, database)',
        [r('the browser never sees a token, only the session cookie')],
      ],
    },
    {
      kind: 'arrow',
      from: 'app',
      to: 'ua',
      lines: [['302 ', m('/'), ' · ', m('Set-Cookie: session=…; HttpOnly; Secure; SameSite=Lax')]],
      response: true,
    },
    // ---------------------------------------------------------------- phase 2: api call
    {
      kind: 'band',
      title: 'Phase 2 · API call',
      subtitle: [
        'the Browser calls the Web App with the cookie, the Web App calls the Backend with the access token as Bearer token · ',
        spec('RFC 6750'),
      ],
    },
    { kind: 'arrow', from: 'ua', to: 'app', lines: [['GET ', m('/pets'), ' + ', m('Cookie: session=…')]] },
    {
      kind: 'note',
      lane: 'app',
      lines: [
        [b('load the tokens from the session')],
        'CSRF protection for state-changing requests (SameSite cookie, CSRF token)',
        ['expired access token → refresh first (phase 3)'],
      ],
    },
    ...apiCall('app', 'op', [['GET ', m('/api/pets')], [m('Authorization: Bearer <access_token>')]]),
    {
      kind: 'note',
      lane: 'app',
      lines: [
        ['401 ', m('invalid_token'), ' from the API → refresh the tokens and retry once, otherwise log in again'],
      ],
    },
    { kind: 'arrow', from: 'app', to: 'ua', lines: [['200 HTML / JSON for the page']], response: true },
    // ---------------------------------------------------------------- phase 3: token lifetime
    {
      kind: 'band',
      title: 'Phase 3 · Token lifetime',
      subtitle:
        'refresh and logout · Web App and Auth Provider · the Backend just checks exp, an issued access token stays valid until then',
    },
    {
      kind: 'arrow',
      from: 'app',
      to: 'op',
      lines: [
        ['POST ', m('token_endpoint'), ' (before ', m('expires_in'), ' runs out, or after a 401)'],
        [m('grant_type=refresh_token refresh_token'), ' + client authentication'],
      ],
    },
    {
      kind: 'arrow',
      from: 'op',
      to: 'app',
      lines: [['200 ', m('{ access_token, id_token, refresh_token, expires_in }'), '  refresh token rotated']],
      response: true,
    },
    { kind: 'note', lane: 'app', lines: ['replace the tokens in the session'] },
    { kind: 'arrow', from: 'ua', to: 'app', lines: [['GET ', m('/logout'), ' + ', m('Cookie: session=…')]] },
    { kind: 'note', lane: 'app', lines: [[b('logout')], 'destroy the session, then RP-Initiated Logout:'] },
    {
      kind: 'arrow',
      from: 'app',
      to: 'ua',
      lines: [
        ['302 ', m('end_session_endpoint'), ' · ', m('Set-Cookie: session=; Max-Age=0')],
        [m('id_token_hint=… post_logout_redirect_uri=…')],
      ],
      response: true,
    },
    { kind: 'arrow', from: 'ua', to: 'op', lines: [['GET ', m('end_session_endpoint'), ' (follows the redirect)']] },
    { kind: 'note', lane: 'op', lines: ['ends the user session (SSO cookie) and redirects back'] },
  ],
  specs: specs(
    ['RFC 7636', 'PKCE'],
    ['RFC 9700', 'OAuth 2.0 Security Best Current Practice'],
    ['OpenID Connect RP-Initiated Logout 1.0', ''],
  ),
};
