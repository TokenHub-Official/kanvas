# Public development and private deployments

GitHub is the upstream for reusable Kanvas product code. Private deployments
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

Before publication, require frozen installation, `pnpm verify`, `pnpm audit:prod`,
the disposable MySQL suite, a standalone image build and packaging checks, and a
secret scan of all commits reachable from the intended public refs. Inspect
binary assets separately; text scans do not establish image provenance or privacy.
Regenerate `third-party/` for the release platform. Audit findings must be assessed
without silently suppressing advisories; high and critical findings block release.

## Contributions and releases

- Submit common fixes through focused public pull requests. A private emergency
  fix should be generalized and proposed upstream promptly; target one week.
- Keep private extensions small and use public contracts instead of duplicating
  core modules. Deploy exact commits or immutable tags, not floating branches.
- Public CI verifies code without production credentials. A separate trusted
  deployment job consumes reviewed artifacts and injects private configuration.
- Use forward migrations, backups and a tested recovery plan for upgrades.
- Handle vulnerabilities through SECURITY.md before coordinated disclosure.

Before making a repository public, require review and CI on the default branch,
restrict force pushes and deletions, enable dependency alerts and push protection
where available, enable private vulnerability reporting, and verify the listed
security and conduct contact. Repository settings are administered separately;
these documents do not imply that a setting has already been enabled.
