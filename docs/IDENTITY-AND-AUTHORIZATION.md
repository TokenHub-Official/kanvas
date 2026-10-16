# Identity, sessions, and authorization

## Authority

Better Auth owns authentication sessions, passwords, and cookie protocols. Kanvas
owns:

- Principal and Human or Service identity;
- Organization, Workspace, and Membership;
- Permission, ServiceGrant, and business-resource boundaries;
- Invitation, instance bootstrap, and authorization audit.

An authentication subject is not a business actor. Workspace, Principal, or
Permission values supplied by a client are not trusted authority.

## Browser sessions

- Cookies use HttpOnly, Secure, and an appropriate SameSite policy.
- State-changing browser requests validate Session, Origin or Trusted Origin, and a
  CSRF token.
- Server derives `RequestAuthorizationContext` from Session and never reads the actor
  from a request body.
- Logout, Session revocation, and password-security events prevent later
  authorization.
- Web stores only a public projection of the current user and Workspace, never a
  Session secret.

## Principal

Principal is the stable business subject:

- HumanPrincipal binds an authentication subject;
- ServicePrincipal represents governed automation;
- Audit Actor records Principal, authority type, authority ID and version, and an
  authentication-reference digest.

Changes to email, display name, or authentication provider do not change an existing
Principal ID. An authentication subject binds to a business Principal only through an
explicit rule.

## Registration

Registration creates an Authentication Account and proves identity. Workspace
membership comes from an invitation, explicit administrator assignment, or an
explicitly enabled default access policy ([ADR-0038](decisions/0038-default-workspace-access-for-self-registration.md)).
Default access snapshots one Workspace and a viewer/operator/editor role at self-registration,
requires a trusted OIDC source or an independently verified matching domain, and
never replays grants after manual removal or role changes. Invitation and setup
enrollment are excluded. Policy edits only affect future registrations; existing
unassigned accounts require an administrator preview and explicit batch action. The Instance Registration Policy controls autonomous
signup. `closed` disables autonomous signup while valid invitations remain a scoped
enrollment path subject to the explicit email verification policy or trusted OIDC. `account_only`
allows the selected self-registration methods. There is no account approval queue.

By default, email enrollment creates an unverified account, requests a verification email, and
never treats possession of an invitation link as proof of mailbox ownership. A retry
for an existing unverified account resends verification without replacing its password.
Configured internal OIDC providers may sign into an existing account with the same
email when both the local account and provider email are verified. This preserves
the existing Authentication Account and HumanPrincipal. Ordinary social providers
still require explicit linking from an authenticated session.

The site administrator may explicitly disable `emailVerificationRequired` (default
`true`). In this mode email accounts can sign in and accept matching email-bound
invitations without mailbox proof; direct member assignment follows the same policy.
The UI warns that someone may claim another person's email and its invitation rights.
No SMTP configuration is needed in this mode. Missing SMTP never silently disables
verification. The account's `emailVerified` fact remains false until actual proof.
This policy does not relax OIDC validation or enable implicit account linking.

Before issuing a human session, the authentication boundary idempotently
materializes the stable HumanPrincipal and rejects inactive Principals. An account
without membership is simply not a member of any Workspace. It can accept an
invitation or be added by an authorized administrator; it does not need a second
site approval after accepting an invitation.

Site Administrators govern registration and site account status. Workspace
administrators add existing verified accounts, invite people and manage members only
within their Workspace. Site Administrators can perform member administration across
Workspaces under explicit instance authority, without creating an Owner membership
for themselves or obtaining implicit Agent execution authority. Both paths preserve
Owner and last-active-Owner protections and record their actual authority in audit.
Suspension is site-wide; removing a Workspace membership affects only that Workspace.

## Membership administration

- Existing verified account: exact account email -> choose role -> add membership.
- New account: invitation -> prove identity -> confirm invitation -> membership.
- Role/status changes require the current membership version. Existing membership
  records are changed or restored explicitly rather than overwritten by addition.
- Site administrators can inspect accounts and memberships, issue/revoke invitations,
  and suspend/reactivate ordinary accounts. Self-suspension, administrator suspension,
  and removal of the last effective Workspace Owner are protected.
- No join requests, Workspace discovery, or additional approval workflow is provided.

## Organization and Workspace

Organization is the top-level governance boundary. Workspace is the everyday
isolation boundary for content, membership, budgets, providers, and resources.

Every Workspace-resource query constrains both `workspace_id` and the resource ID. It
must not query by a global ID first and check the Workspace later in Application code.

Membership holds lifecycle, role, and permission facts. Authorization also considers:

- resource ownership and data classification;
- the Workspace of an Artifact, Asset, Canvas Draft, Workflow, or Brand;
- the current Policy Revision;
- provider data egress and budget;
- resource lifecycle and revocation state.

## ServicePrincipal

A service token is shown once at creation and stored only as an irreversible digest.
It pins:

- ServicePrincipal;
- Organization or Workspace scope;
- permission allowlist;
- expiry, generation, and lifecycle.

A ServicePrincipal cannot exchange its token for a browser Session, inherit a human
Membership, or bypass CSRF and business authorization to enter user pages.

## Invitation

An Invitation is a single-use, scoped business fact with an expiry:

1. An authorized member creates the invitation.
2. Server stores the token digest, target Workspace, expected identity, and role.
3. The recipient establishes an authentication Session through verified email or
   trusted OIDC. A short-lived signed invitation-admission cookie permits a matching
   new OIDC account when autonomous registration is closed; the callback revalidates
   the pending invitation and verified email. A return URL alone never grants admission.
4. Redemption revalidates Session identity, expiry, unused state, and Workspace.
5. One transaction creates or restores Membership, consumes the Invitation, and
   writes Audit.

The raw token never enters the database, logs, or list APIs. A replay returns a stable
result or explicit conflict and never creates a second Membership.

## Instance bootstrap

An empty instance uses a one-time bootstrap to create its first Organization,
Workspace, Principal, and owner Membership. Bootstrap state is stored in the database;
a transaction and unique constraints prevent concurrent creation of two owners.

An email-bound setup grant may create the first authentication account before that
transaction. Auth-subject-bound and unbound grants require an existing account and
never open account registration. The browser removes the raw grant from the address
bar, keeps it only for the current tab, and uses a clean `/setup` login return path.

Recovery does not rely on a hidden default account or hard-coded password. It requires
an explicit operations command, current database facts, and audit evidence.

## Authorization boundaries

| Boundary             | Responsibility                                                         |
| -------------------- | ---------------------------------------------------------------------- |
| HTTP Guard           | Authentication, Workspace header, CSRF, and base permission            |
| Application use case | Business object, state, data classification, and command authority     |
| Database store       | Workspace predicate, version, current authority, transaction invariant |
| Worker claim         | Run or Attempt authority, generation, deadline, and data egress        |
| Artifact download    | Fresh authorization, availability, and classification                  |

A background task does not inherit indefinite authority from Run creation. Before a
critical execution, download, publication, deletion, or provider call, revalidate
current authority or a pinned authorization snapshot that remains valid.

## Authorization drift

- Membership revocation prevents new claims and resource reads.
- An irreversible provider side effect retains its Audit and Usage facts; it is not
  presented as if no call occurred.
- A running operation whose authority is revoked enters cancellation, failure, or
  manual recovery according to its current state machine.
- Historical Runs and Audit may retain identity digests without restoring permission
  to read user content.

## API projection

Ordinary responses return only what users need to act:

- current Principal display identity;
- current Instance Administrator status when needed to discover Instance management;
- accessible Workspaces;
- effective permissions or actions;
- Membership or Invitation state;
- recoverable errors.

They do not return Session hashes, service-token digests, internal authority versions,
database ID relationships, or security-policy implementation details.

## Verification

- Session, CSRF, Trusted Origin, and logout behavior;
- cross-Workspace ID guessing and permission revocation;
- concurrent Invitation redemption, expiry, and identity mismatch;
- concurrent bootstrap and recovery;
- service-token scope, expiry, and rotation;
- authority revalidation before Worker claims, Artifact downloads, and provider calls.

## Settings entry points and scope

Settings share the Kanvas visual language, but retain three distinct scopes:

- **Personal settings** (`/account`): the signed-in person's sign-in methods. The
  avatar menu is the entry point; workspace membership is not required.
- **Team settings** (`/w/:workspaceId/settings`): the selected workspace's members,
  resources, and configuration. The workspace menu is the entry point and keeps
  the workspace identity visible.
- **Site management** (`/admin/access`): registration policy, site accounts, and
  cross-workspace membership administration. Only site administrators see this
  entry as a peer of Personal settings in the avatar menu. It does not imply workspace
  membership or replace team administration.

Personal and site pages use an authenticated settings layout with explicit scope
navigation and a nearby return-to-workspaces action. Public sign-in and invitation
pages retain their task-centered entry layout. Shared visual treatment never
merges these authorization boundaries. Destructive site account actions belong in
an account's overflow menu with confirmation, separate from routine workspace
permission management.
