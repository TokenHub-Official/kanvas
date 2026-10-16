# Third-party materials

Kanvas source code is licensed under Apache-2.0. Third-party packages, artwork,
fonts, model weights and trademarks retain their own licenses and ownership.
The project license does not relicense those materials or grant trademark rights.

## Included artwork

- Ant Design scene icons: `apps/web/src/assets/icons/ant-design`, from
  `@ant-design/icons-svg` 4.5.0, MIT. The complete license accompanies the SVGs.
- Fluent emoji: generated during Web builds from `@lobehub/fluent-emoji-3d`.
  Both LobeHub and Microsoft MIT notices are copied into the distributed
  `fluent-emoji/NOTICE.txt`; source: `apps/web/scripts/fluent-emoji-NOTICE.txt`.
- Provider marks identify their respective services. Sources are listed in
  `apps/web/public/provider-logos/README.md`. They are not Kanvas-owned artwork.
- Deterministic regression images in `eval-data/image-atomic-batch-b/regression-v1`
  and `eval-data/image-atomic-batch-c/regression-v1` are produced by
  `tools/image-atomic-eval/scripts/generate-regression-corpus.ts`.

## Dependencies and binary distributions

Generate the dependency inventory and notices with `pnpm licenses:generate` after
installing the frozen lockfile. Output is in `third-party/`. The inventory contains
package names, versions, declared licenses and upstream references, never local
paths. Re-run it for the target platform when building a binary distribution.
Production container images include this directory; package license files remain
inside their installed packages.

Sharp uses libvips binaries under LGPL-3.0-or-later, independently of the Apache
license on Sharp and Kanvas. Preserve the binary package's license, copyright
notices and source references. The shared library must remain replaceable; do not
prohibit reverse engineering for debugging modifications. Corresponding libvips
source and build recipes are maintained at <https://github.com/lovell/sharp-libvips>.
Before distributing a modified binary, provide its corresponding source under the
applicable license. MPL-licensed files retain their file-level obligations.

Model weights and evaluation datasets are not licensed by the repository's Apache
license. Do not bundle downloaded models, external datasets or customer material
without a separate redistribution review. The default catalog describes optional
resources; installing one is a separate action with its own license requirements.
