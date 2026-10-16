# Public development and private deployments

GitHub hosts reviewed snapshots and contributions for reusable Kanvas product code. Private deployments
consume reviewed commits or release tags and keep credentials, environment
configuration, customer assets and organization-specific integrations outside the
public repository. Public contributions never receive private deployment secrets.

## Public baseline

Use `pnpm release:export -- /absolute/path/to/new-directory` to copy the reviewed
working tree into a new directory. The export excludes Git objects, local state,
private deployment overlays and historical evidence. It does not initialize Git,
commit, configure a remote or push anything. Review new files before exporting.
Initialize the result as a new repository and stage its files before running
`pnpm release:check`. Never merge old private ancestry into this repository.
Keep a private mapping from the public baseline to the reviewed internal revision.
Do not rewrite migrations already applied to a shared database.

Before publication, review the outgoing diff and metadata, run the public boundary
check and scan candidate files and all reachable outgoing commits for secrets.
Inspect binary assets separately; text scans do not establish provenance or
privacy. Reuse engineering verification for the same code revision; run relevant
checks for resolutions or changes not covered by that result. Synchronization does
not require repeating business tests, database suites or container builds.
Regenerate `third-party/` when release dependencies or the platform change. Assess
audit findings without silently suppressing advisories; high and critical findings
block release.

## Contributions and releases

- Publish selected changes through focused public pull requests when maintainers
  choose to synchronize. Each development commit need not trigger publication.
- Keep private extensions small and use public contracts instead of duplicating
  core modules. Deploy exact commits or immutable tags, not floating branches.
- Public CI runs lightweight checks without production credentials. A separate trusted
  deployment job consumes reviewed artifacts and injects private configuration.
- Use forward migrations, backups and a tested recovery plan for upgrades.
- Handle vulnerabilities through SECURITY.md before coordinated disclosure.

Before making a repository public, require review and CI on the default branch,
restrict force pushes and deletions, enable dependency alerts and push protection
where available, enable private vulnerability reporting, and verify the listed
security and conduct contact. Repository settings are administered separately;
these documents do not imply that a setting has already been enabled.
