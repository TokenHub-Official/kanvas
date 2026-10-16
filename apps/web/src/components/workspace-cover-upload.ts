import {
  allocateUserImport,
  uploadUserImport,
  commitUserImport,
} from "../api/transport.js";

/** Keep the upload identity across retry; committing a user import is idempotent. */
export function createWorkspaceCoverUploader(context: {
  csrfToken: string;
  workspaceId: string;
}) {
  const attempts = new WeakMap<
    File,
    { key: string; session?: string; transferred?: boolean }
  >();
  return async (file: File, signal: AbortSignal): Promise<string> => {
    const mediaType = file.type;
    if (
      mediaType !== "image/png" &&
      mediaType !== "image/jpeg" &&
      mediaType !== "image/webp"
    )
      throw new Error("Choose a PNG, JPEG or WebP image.");
    const attempt = attempts.get(file) ?? {
      key: `cover:${crypto.randomUUID()}`,
    };
    attempts.set(file, attempt);
    if (!attempt.session) {
      const allocation = await allocateUserImport(
        context,
        {
          expectedMediaType: mediaType,
          expectedSize: String(file.size),
        },
        attempt.key,
        { signal },
      );
      attempt.session = allocation.uploadSessionId;
    }
    if (!attempt.transferred) {
      await uploadUserImport(context, attempt.session, file, { signal });
      attempt.transferred = true;
    }
    const committed = await commitUserImport(
      context,
      attempt.session,
      {
        artifactType: "image.cover",
        dataClassification: "internal",
        displayFilename: file.name,
        metadata: { importedFrom: "cover-picker" },
        asset: { name: file.name, assetType: "image.cover" },
      },
      fetch,
      signal,
    );
    if (!committed.assetId) throw new Error("Cover asset was not created.");
    return committed.assetId;
  };
}
