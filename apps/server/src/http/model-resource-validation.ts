import type { ModelResourceManifest } from "@kanvas/contracts/api";
import type { StorageProfileRegistry } from "@kanvas/application";
import { digestProviderValue } from "@kanvas/database/runtime";

export class ModelResourceValidationError extends TypeError {
  public constructor(message: string) {
    super(message);
    this.name = "ModelResourceValidationError";
  }
}

const temporarySignatureKeys = new Set([
  "x-amz-signature",
  "x-amz-credential",
  "x-amz-security-token",
  "signature",
  "token",
]);

function validateSource(manifest: ModelResourceManifest): void {
  const source = manifest.source;
  if (source.kind === "https") {
    let url: URL;
    try {
      url = new URL(source.url);
    } catch {
      throw new ModelResourceValidationError("Model resource URL is invalid.");
    }
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      [...url.searchParams.keys()].some((key) =>
        temporarySignatureKeys.has(key.toLocaleLowerCase()),
      )
    ) {
      throw new ModelResourceValidationError(
        "Model resource URL must be a stable HTTPS URL without credentials or temporary signatures.",
      );
    }
  }
  if (source.kind === "hugging_face" && source.filePath.includes("\0")) {
    throw new ModelResourceValidationError(
      "Model resource source path is invalid.",
    );
  }
}

export interface ValidatedModelResourcePublication {
  readonly key: string;
  readonly displayName: string;
  readonly description?: string;
  readonly manifest: ModelResourceManifest;
  readonly revisionDigest: string;
  readonly publicationDigest: string;
}

export interface ModelResourcePublicationBody {
  readonly key: string;
  readonly displayName: string;
  readonly description?: string;
  readonly manifest: ModelResourceManifest;
}

export function validateModelResourcePublication(
  body: ModelResourcePublicationBody,
): ValidatedModelResourcePublication {
  validateSource(body.manifest);
  if (
    body.manifest.byteSize !== undefined &&
    BigInt(body.manifest.byteSize) <= 0n
  ) {
    throw new ModelResourceValidationError(
      "Model resource byte size must be greater than zero.",
    );
  }
  const key = body.key.trim();
  const displayName = body.displayName.replace(/\s+/gu, " ").trim();
  const description = body.description?.replace(/\s+/gu, " ").trim();
  const manifest = Object.freeze({
    ...body.manifest,
    executionTargets: [...body.manifest.executionTargets].toSorted(),
    runtime: Object.fromEntries(
      Object.entries(body.manifest.runtime).toSorted(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  }) as ModelResourceManifest;
  const revisionDigest = digestProviderValue({
    schemaVersion: 1,
    key,
    manifest,
  });
  return Object.freeze({
    key,
    displayName,
    ...(description ? { description } : {}),
    manifest,
    revisionDigest,
    publicationDigest: digestProviderValue({
      operation: "model_resource.publish",
      key,
      displayName,
      ...(description ? { description } : {}),
      revisionDigest,
    }),
  });
}

export async function verifyModelResourceStorage<
  TBody extends ModelResourcePublicationBody,
>(
  body: TBody,
  storedFile: Readonly<{
    storageProfileId: string;
    container: string;
    objectKey: string;
    storageVersionId?: string;
    immutableIdentityHash: string;
    byteSize: string;
    sha256: string;
  }>,
  profiles: StorageProfileRegistry | undefined,
): Promise<TBody> {
  const profile = profiles?.resolve(storedFile.storageProfileId);
  if (!profile) {
    throw new ModelResourceValidationError(
      "The selected Storage Profile is not available on this deployment.",
    );
  }
  const inspection = await profile.adapter.inspectObject({
    storageProfileId: storedFile.storageProfileId,
    container: storedFile.container,
    objectKey: storedFile.objectKey,
    ...(storedFile.storageVersionId
      ? { storageVersionId: storedFile.storageVersionId }
      : {}),
  });
  if (!inspection) {
    throw new ModelResourceValidationError(
      "The model object was not found or has not been sealed by Kanvas.",
    );
  }
  const expectedSha256 = body.manifest.sha256.slice("sha256:".length);
  if (
    inspection.sha256 !== expectedSha256 ||
    inspection.sha256 !== storedFile.sha256 ||
    inspection.byteSize !== storedFile.byteSize ||
    inspection.immutableIdentityHash !== storedFile.immutableIdentityHash ||
    (body.manifest.byteSize !== undefined &&
      inspection.byteSize !== body.manifest.byteSize)
  ) {
    throw new ModelResourceValidationError(
      "The model object size or SHA-256 does not match this release.",
    );
  }
  return {
    ...body,
    manifest: {
      ...body.manifest,
      byteSize: inspection.byteSize,
    },
  };
}
