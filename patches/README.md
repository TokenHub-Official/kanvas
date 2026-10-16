# Dependency patches

## mysql2 3.23.1

The driver suppresses SNI for IP literals (correct), but also gates its explicit
certificate identity verification on SNI being present. With `verifyIdentity: true`,
a trusted certificate for a different IP could consequently be accepted.

The patch preserves the SNI behavior and verifies the configured host instead of
the SNI variable. It changes only that identity-check condition and argument.
Kanvas sets both `rejectUnauthorized: true` and `verifyIdentity: true` for MySQL TLS.

The local real-TLS validation covers trusted DNS/IP connections and rejects an
untrusted CA, a wrong DNS name and a wrong IP. Remove the patch only after an
upstream version passes the same cases. The pinned patch is applied through pnpm's
patchedDependencies and the frozen lockfile, including Docker builds.
