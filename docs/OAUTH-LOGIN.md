# OAuth sign-in

OAuth is configured at instance deployment scope. Set `KANVAS_AUTH_OAUTH_CONFIG_JSON`
to a JSON provider array, or use the optional `KANVAS_AUTH_OAUTH_CONFIG_FILE`
file alternative, and restart Server. These sources are mutually exclusive.
Each provider accepts either a direct `clientSecret` or a `clientSecretFile`,
never both. Deployment JSON with credentials belongs in secret-backed environment
variables, not in source control. No database migration or new dependency is required.
The login page discovers enabled methods from `/api/auth/login-methods`, which exposes
only provider names, IDs, types, and whether password login is enabled.

## Configuration

Create a private file outside the repository, for example `/etc/kanvas/oauth.json`:

```json
[
  {
    "id": "github",
    "name": "GitHub",
    "type": "github",
    "clientId": "your-github-client-id",
    "clientSecretFile": "secrets/github"
  },
  {
    "id": "company",
    "name": "Company SSO",
    "type": "oidc",
    "clientId": "your-oidc-client-id",
    "clientSecretFile": "secrets/company",
    "discoveryUrl": "https://identity.example.com/.well-known/openid-configuration",
    "issuer": "https://identity.example.com",
    "tokenEndpointAuthMethod": "client_secret_basic"
  }
]
```

Each secret file contains the client secret as plain text, is readable only by
the Server process, and is resolved relative to the JSON file unless absolute.
Never commit these files. Built-in types are `github`, `google`, `microsoft`, and
`discord`; their IDs must equal their type. Add only the providers you use.
OIDC IDs must be unique and must not reuse a built-in ID. Its discovery document
must report the configured issuer and HTTPS authorization, token, UserInfo and
JWKS endpoints. `tokenEndpointAuthMethod` uses the standard registered values
`client_secret_basic` or `client_secret_post`; it defaults to
`client_secret_basic`, as required when discovery omits
`token_endpoint_auth_methods_supported`. The configured method must be advertised
by discovery when that metadata is present.

Kanvas accepts Authorization Code providers with a public or pairwise subject and
a supported asymmetric ID-token signing algorithm. It uses PKCE S256, verifies the
ID Token signature through the discovered JWKS, and validates `iss`, `aud`, `exp`,
`sub`, and `azp` when present while requiring `iat`. Authenticated UserInfo must
return the same `sub` as the ID Token, an email, and boolean
`email_verified: true`.

For Docker Compose, add the environment variable and read-only bind mounts for the
configuration and secret files to the `server` service in a local override file.
Paths in the JSON refer to paths inside the container. The default Compose service
does not automatically mount optional OAuth files.

Run the deployment check from the same network and filesystem context as Server
before rollout:

```sh
pnpm --filter @kanvas/server build
node --env-file-if-exists=.env.local \
  --env-file-if-exists=apps/server/.env.local \
  apps/server/dist/main.js --check-config
```

When OIDC is configured, this also performs a read-only Discovery preflight using
the configured issuer and token authentication method. It does not send the client
secret or start an authorization flow. A deployment with no OIDC provider performs
no authentication-center network request.

## Callback URLs

Set `KANVAS_AUTH_BASE_URL` to the browser-facing origin, including in development
when the web frontend uses a different port. Register these exact URLs with each
provider (shown with an example deployment origin):

| Type             | Callback URL                                                  |
| ---------------- | ------------------------------------------------------------- |
| GitHub           | `https://kanvas.example.com/api/auth/callback/github`         |
| Google           | `https://kanvas.example.com/api/auth/callback/google`         |
| Microsoft        | `https://kanvas.example.com/api/auth/callback/microsoft`      |
| Discord          | `https://kanvas.example.com/api/auth/callback/discord`        |
| OIDC (`company`) | `https://kanvas.example.com/api/auth/oauth2/callback/company` |

The OIDC path corresponds to the installed Better Auth **1.6.25** generic OAuth
plugin, with Kanvas-owned standards validation around discovery, token exchange,
ID Token verification, and UserInfo. OIDC requests `openid profile email` with
PKCE. Keep the issuer and client bound to one identity system; replacing an issuer
must use a new provider ID.

## KubeMatrix internal authentication

The KubeMatrix authentication center is used as an ordinary OIDC Provider. Do not
add its EnvoyFilter, cookie-to-Bearer conversion, OPA, Sidecar, or AuthConfig CRD to
Kanvas; those are an alternative mesh integration rather than part of the OIDC
client protocol.

The pre-production authentication center currently passes Kanvas discovery
preflight with:

```json
{
  "issuer": "https://auth.example.com",
  "authorization_endpoint": "https://auth.example.com/auth",
  "token_endpoint": "https://auth.example.com/token",
  "userinfo_endpoint": "https://auth.example.com/userinfo",
  "jwks_uri": "https://auth.example.com/keys",
  "response_types_supported": ["code"],
  "subject_types_supported": ["public"],
  "id_token_signing_alg_values_supported": ["RS256"],
  "token_endpoint_auth_methods_supported": ["client_secret_basic"]
}
```

Register a confidential web client with this exact redirect URI, substituting the
deployed Kanvas origin and chosen provider ID:

```text
https://kanvas.example.com/api/auth/oauth2/callback/matrix
```

KubeMatrix does not advertise an OIDC dynamic-registration endpoint, and its
published application-management documentation says registration is performed
through the platform, CI/CD, or operations rather than its open REST API. Obtain
the Client ID and Client Secret through that controlled path; Kanvas must not try
to invent or automate a private registration protocol.

Send operations the following registration contract:

- client kind: confidential web OIDC client;
- grant and response: Authorization Code (`authorization_code` / `code`);
- token endpoint authentication: `client_secret_basic`;
- scopes: `openid profile email`;
- PKCE: accept `S256` and the subsequent `code_verifier`;
- production redirect URI:
  `https://<browser-facing-kanvas-origin>/api/auth/oauth2/callback/matrix`;
- local redirect URI, when the provider permits loopback HTTP:
  `http://127.0.0.1:5173/api/auth/oauth2/callback/matrix`;
- ID Token: RS256 with `iss`, `sub`, `aud`, `exp`, and `iat`;
- UserInfo: the same stable `sub`, an email, and boolean
  `email_verified: true`.

The local redirect uses the Vite browser origin, whose `/api` proxy forwards the
callback to Server. Set `KANVAS_AUTH_BASE_URL=http://127.0.0.1:5173` for that
journey; registering the Server port instead would send the post-login browser to
an origin that does not serve the Web application.

Then configure:

```json
[
  {
    "id": "matrix",
    "name": "Internal SSO",
    "type": "oidc",
    "clientId": "assigned-client-id",
    "clientSecretFile": "secrets/matrix",
    "discoveryUrl": "https://auth.example.com/.well-known/openid-configuration",
    "issuer": "https://auth.example.com",
    "tokenEndpointAuthMethod": "client_secret_basic"
  }
]
```

The upstream documentation writes the production authentication-center origin as
`${HOST}`. Use the actual production issuer and its own discovery document in
production; pre-production-issued tokens are not valid there. Before rollout,
complete one real consent and callback with a test user and confirm that UserInfo
returns the same `sub` as the ID Token plus boolean `email_verified: true`. The
current provider metadata does not advertise `code_challenge_methods_supported`,
so the same callback also serves as the required PKCE S256 compatibility check.

## Account journey

The Instance Registration Policy defaults to `closed`, which closes autonomous
signup. A valid email-bound Workspace invitation can still enroll a new account
under the email verification policy or through a trusted OIDC provider. Invitation
resolution issues a short-lived, signed HttpOnly admission cookie; first OIDC account
creation revalidates the invitation and matches the verified provider email. The
return URL alone is never enrollment authority. After authentication, the recipient
confirms the invitation to create membership atomically.

An Instance Administrator may enable autonomous signup for selected methods. This
creates an account with no Workspace membership. Workspace administrators can add the
verified account directly; Site Administrators can do so across Workspaces. There is
no mandatory second approval for invitation recipients.
Authorization state expires after ten minutes. An expired or mismatched callback stays
on the login page with a recoverable error even if the browser still has an older
Kanvas session; the user must start the enterprise sign-in flow again.

If a configured internal OIDC provider returns a verified email matching an existing
verified Kanvas account, the callback links that identity and signs into the same
account directly, even when new registration is closed. The override is scoped to
that OIDC callback; ordinary social providers still require explicit linking from
an authenticated session. An unverified local account must first prove mailbox
ownership or use its existing sign-in method to link explicitly. Linking never
creates a second account or grants Workspace access. `/account` and the awaiting-access
page both work without a Workspace. Direct email/password registration is
available when the Instance Administrator selects that method; delivery is additionally
required when `emailVerificationRequired` is enabled (the default). In verification mode, email signup creates an unverified Better Auth
User/credential Account, requests a one-hour verification link, and issues no session.
If delivery fails, the account remains unverified and can recover through the resend
action or a later sign-in attempt; it still cannot create a HumanPrincipal. Verification
marks the address verified and creates the first session; the HumanPrincipal is then
resolved into the same awaiting-access journey. Invitation enrollment is independent of autonomous signup, but the invitation link
does not prove mailbox ownership. By default, email verification or trusted OIDC must establish
that proof before membership is granted. A Site Administrator can explicitly disable
email verification in Site administration, accepting the displayed impersonation risk.
Then email/password registration and invitation enrollment proceed to sign-in without
sending mail, and matching invitations may be accepted without mailbox proof. This
works without SMTP and does not mark the email as verified. OIDC checks remain intact. Setup remains a separate privileged bootstrap
flow.

## Verification boundary

Local tests cover configuration validation, discovery and endpoint trust, standard
token authentication, PKCE, ID Token verification, UserInfo subject binding, and
authentication policy. Real-provider consent, callback and session issuance
require a registered OAuth application, its credentials, and a test account.
