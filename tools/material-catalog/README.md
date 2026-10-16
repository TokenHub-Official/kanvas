# Material catalog bootstrap

This tool builds a local, reviewable starter image catalog for Kanvas.
Generated media stays under `.tmp/material-catalog/` and is ignored by Git.

## Generate

```bash
node tools/material-catalog/fetch-open-media.mjs --limit=30
```

If image downloads completed but final manifest generation was interrupted:

```bash
node tools/material-catalog/fetch-open-media.mjs \
  --limit=30 \
  --resume
```

The output contains:

- a root `manifest.json` with category, source, creator, license, dimensions,
  byte size and SHA-256 metadata;
- one directory, manifest and contact sheet per category;
- `checksums.sha256` for local integrity checks;
- normalized JPEG previews with metadata stripped and a maximum edge of
  1600 pixels.

## License boundary

The bootstrap catalog only accepts Wikimedia Commons Featured Pictures and
museum records whose source metadata identifies them as CC0, public domain,
CC BY or CC BY-SA.

CC BY assets require attribution. Adaptations of CC BY-SA assets also require
share-alike handling. Copyright licenses do not grant trademark, privacy,
publicity, property or endorsement rights, so the manifest must remain attached
to imported catalog records.

Providers that require hotlinking, download tracking, or prohibit rebuilding a
stock library must be integrated as runtime API providers instead of being
mirrored into this catalog.

## S3 boundary

Do not upload this catalog to the bucket root. Kanvas currently defines
workspace-owned user-import and attempt-output object keys, but no shared
built-in catalog key contract. Keep this batch local until that contract,
ownership model, retention policy and public/private delivery boundary are
approved.
