# ADR-0038: Administrator-configured default Workspace access

- Status: Accepted
- Date: 2026-10-07
- Supersedes: the unconditional prohibition on automatic Workspace membership in [ADR-0036](0036-account-only-registration-and-explicit-workspace-access.md).

Internal members should be able to start work without waiting for the same manual
Workspace assignment each time. An Instance Administrator may explicitly enable a
single default Workspace and a fixed `viewer`, `operator`, or `editor` role. The
policy defaults to disabled, with `operator` preselected. A trusted configured OIDC
registration source or an exact, independently verified company email domain
qualifies; either enabled condition is sufficient. Unverified email text never
proves company membership, even when account registration permits unverified email.

Authentication and authorization remain separate. The policy creates ordinary
Organization member and Workspace membership facts through the Kanvas authorization
store, with an audit record. It does not confer instance administration, Workspace
management, ownership, or new budget exemptions. The selected public Workspace must
contain content and execution resources appropriate for all qualifying members.

Registration records its origin and the policy snapshot independently of the
first session. Invitation and setup enrollment are excluded. Autonomous registration
is evaluated after the required identity proof becomes available. Terminal grants
are never replayed: subsequent role changes, suspension, and revocation remain
operator decisions. Policy edits and disabling do not rewrite existing registrations
or memberships. Previously registered accounts without enrollment records are never
automatically assigned merely because they log in.

A separate administrator preview and explicit batch action handles existing
unassigned members under the current policy version. It excludes previous Workspace
membership, prior principal suspension, inactive Organization membership, and
invitation-related accounts. The batch rechecks eligibility and policy version
transactionally and never overwrites memberships. Legacy identity evidence is read
from persisted verified account facts rather than client-supplied claims.

Registration and authentication remain usable when allocation fails. The durable
allocation record retains a recoverable state, and a session-bound mutation retries
only that user's original allocation. An unavailable original Workspace requires
restoration or explicit manual assignment; changing the default policy does not
silently redirect existing registrations. Administrators can inspect incomplete
allocations. Successful grants, policy edits, and allocation outcomes are audited;
permission, budget, and approval checks continue to apply on each use.
