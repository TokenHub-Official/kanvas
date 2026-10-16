# ADR-0036: Account-only registration with explicit Workspace access

- Status: Accepted; automatic membership prohibition superseded by [ADR-0038](0038-default-workspace-access-for-self-registration.md)
- Date: 2026-09-15

Kanvas may allow an Instance Administrator to open verified account registration,
but registration creates only the Authentication Account and stable Human Principal.
It never creates a personal Workspace, auto-joins a default Workspace, or grants a
Membership. An authenticated Principal with no active Workspace Membership is shown
as awaiting access until a Workspace administrator or Instance Administrator explicitly grants Workspace
roles, or the user accepts a valid invitation. This preserves the separation established by ADR-0019 while supporting
company-internal self-enrollment without turning identity proof into resource
authority.

The Registration Policy is Instance-scoped, defaults to closed, is enforced by the
Server on every first-account creation path, and is changed only through audited
Instance Administrator authority. Email/password registration additionally requires
a configured verification delivery path; verified OIDC may be enabled independently.
Email signup stores an unverified Authentication Account before requesting delivery,
but creates no session or HumanPrincipal until the link proves address control. A
delivery failure therefore remains a bounded, non-authenticated state recoverable by
resending verification; it is not an Unassigned Principal and cannot appear in access
assignment.

The minimal collaboration flow does not include join requests or an account approval
queue. The registration switch governs autonomous signup, not valid invitation-based
enrollment. Invitations still require independent verified email or trusted OIDC
identity proof. Site member administration uses explicit instance authority and the
same role/Owner protections as Workspace member administration.
