import type {
  ArtifactDataClassification,
  ArtifactDownloadAuthorizationAllow,
  ArtifactDownloadAuthorizationDecision,
  ArtifactDownloadAuthorizationPort,
  StorageByteRange,
  StorageProfileRegistry,
  StorageReadHandle,
} from "@kanvas/application";
import type {
  AuthorizedCommittedObject,
  StorageUploadStore,
} from "@kanvas/database";

export type ArtifactDownloadErrorCode =
  | "artifact_download.invalid_configuration"
  | "artifact_download.invalid_request"
  | "artifact_download.denied"
  | "artifact_download.revoked"
  | "artifact_download.unavailable"
  | "artifact_download.object_mismatch"
  | "artifact_download.range_invalid"
  | "artifact_download.range_unsatisfiable";

export class ArtifactDownloadError extends Error {
  constructor(
    readonly code: ArtifactDownloadErrorCode,
    message: string,
    readonly disclosure: "not_found" | "forbidden" = "not_found",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ArtifactDownloadError";
  }
}

export interface ArtifactDownloadStore {
  readonly readAuthorizedCommittedObject: StorageUploadStore["readAuthorizedCommittedObject"];
}

export interface CreateArtifactDownloadCoordinatorOptions {
  readonly store: ArtifactDownloadStore;
  readonly authorization: ArtifactDownloadAuthorizationPort;
  readonly profiles: StorageProfileRegistry;
  readonly now?: () => Date;
}

export interface PrepareArtifactDownloadRequest {
  readonly principalId: string;
  readonly workspaceId: string;
  readonly artifactId: string;
  readonly purpose: string;
  readonly rangeHeader?: string;
}

export interface PreparedArtifactDownload {
  readonly delivery: "proxy";
  readonly status: 200 | 206;
  readonly dataClassification: ArtifactDataClassification;
  readonly headers: Readonly<{
    "accept-ranges": "bytes";
    "cache-control": "private, no-store";
    "content-disposition": string;
    "content-length": string;
    "content-type": string;
    "content-range"?: string;
    "x-content-type-options": "nosniff";
  }>;
  readonly body: StorageReadHandle["body"];
}

export interface ArtifactDownloadCoordinator {
  prepare(
    request: PrepareArtifactDownloadRequest,
  ): Promise<PreparedArtifactDownload>;
}

const uint64Pattern = /^(?:0|[1-9][0-9]{0,19})$/u;
const maximumUint64 = 18_446_744_073_709_551_615n;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const identityHashPattern = /^sha256:[0-9a-f]{64}$/u;
const mediaTypePattern =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}$/u;

function fail(
  code: ArtifactDownloadErrorCode,
  message: string,
  disclosure: "not_found" | "forbidden" = "not_found",
  cause?: unknown,
): never {
  throw new ArtifactDownloadError(
    code,
    message,
    disclosure,
    cause === undefined ? undefined : { cause },
  );
}

function validDate(value: Date): boolean {
  return !Number.isNaN(value.getTime());
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 0x1f || code === 0x7f;
  });
}

function parseUint64(value: string, label: string): bigint {
  if (!uint64Pattern.test(value)) {
    return fail(
      "artifact_download.object_mismatch",
      `${label} is not a canonical uint64 string.`,
    );
  }
  const parsed = BigInt(value);
  if (parsed > maximumUint64) {
    return fail(
      "artifact_download.object_mismatch",
      `${label} exceeds the uint64 boundary.`,
    );
  }
  return parsed;
}

function assertRequest(request: PrepareArtifactDownloadRequest): void {
  for (const value of [
    request.principalId,
    request.workspaceId,
    request.artifactId,
    request.purpose,
  ]) {
    if (value.length < 1 || value.length > 240 || hasControlCharacter(value)) {
      fail(
        "artifact_download.invalid_request",
        "Artifact download request identity is invalid.",
      );
    }
  }
  if (
    request.rangeHeader !== undefined &&
    (request.rangeHeader.length > 200 ||
      hasControlCharacter(request.rangeHeader))
  ) {
    fail("artifact_download.range_invalid", "Artifact byte range is invalid.");
  }
}

function assertAllowBinding(
  allow: ArtifactDownloadAuthorizationAllow,
  request: PrepareArtifactDownloadRequest,
  now: Date,
): void {
  if (
    allow.principalId !== request.principalId ||
    allow.workspaceId !== request.workspaceId ||
    allow.artifactId !== request.artifactId ||
    allow.purpose !== request.purpose ||
    allow.decisionId.length < 1 ||
    !Number.isSafeInteger(allow.authorizationVersion) ||
    allow.authorizationVersion < 0 ||
    !["internal", "confidential", "restricted"].includes(
      allow.dataClassification,
    ) ||
    !validDate(allow.validUntil) ||
    allow.validUntil <= now
  ) {
    fail(
      "artifact_download.denied",
      "Artifact authorization is not bound to this request.",
    );
  }
}

function assertRevalidatedBinding(
  initial: ArtifactDownloadAuthorizationAllow,
  revalidated: ArtifactDownloadAuthorizationAllow,
  request: PrepareArtifactDownloadRequest,
  now: Date,
): void {
  assertAllowBinding(revalidated, request, now);
  if (
    revalidated.decisionId !== initial.decisionId ||
    revalidated.authorizationVersion !== initial.authorizationVersion ||
    revalidated.dataClassification !== initial.dataClassification
  ) {
    fail(
      "artifact_download.revoked",
      "Artifact authorization changed before object access.",
    );
  }
}

function parseDecimalRangeValue(value: string): bigint {
  if (!/^[0-9]+$/u.test(value)) {
    return fail(
      "artifact_download.range_invalid",
      "Artifact byte range is malformed.",
    );
  }
  const parsed = BigInt(value);
  if (parsed > maximumUint64) {
    return fail(
      "artifact_download.range_invalid",
      "Artifact byte range exceeds uint64.",
    );
  }
  return parsed;
}

function parseRange(
  header: string | undefined,
  totalSize: bigint,
): StorageByteRange | undefined {
  if (header === undefined) {
    return undefined;
  }
  const match = /^bytes=([0-9]*)-([0-9]*)$/u.exec(header);
  if (!match || (match[1] === "" && match[2] === "")) {
    return fail(
      "artifact_download.range_invalid",
      "Only one strict bytes range is supported.",
    );
  }
  if (totalSize === 0n) {
    return fail(
      "artifact_download.range_unsatisfiable",
      "Byte range cannot be satisfied for an empty object.",
    );
  }
  const first = match[1] ?? "";
  const second = match[2] ?? "";
  let start: bigint;
  let end: bigint;
  if (first === "") {
    const suffix = parseDecimalRangeValue(second);
    if (suffix === 0n) {
      return fail(
        "artifact_download.range_unsatisfiable",
        "Zero-length suffix range is unsatisfiable.",
      );
    }
    start = suffix >= totalSize ? 0n : totalSize - suffix;
    end = totalSize - 1n;
  } else {
    start = parseDecimalRangeValue(first);
    if (start >= totalSize) {
      return fail(
        "artifact_download.range_unsatisfiable",
        "Byte range starts beyond the complete object.",
      );
    }
    if (second === "") {
      end = totalSize - 1n;
    } else {
      const requestedEnd = parseDecimalRangeValue(second);
      if (requestedEnd < start) {
        return fail(
          "artifact_download.range_unsatisfiable",
          "Byte range end precedes its start.",
        );
      }
      end = requestedEnd >= totalSize ? totalSize - 1n : requestedEnd;
    }
  }
  return Object.freeze({
    start: start.toString(),
    endInclusive: end.toString(),
  });
}

function extensionForMediaType(mediaType: string): string {
  if (mediaType === "image/png") {
    return ".png";
  }
  if (mediaType === "image/jpeg") {
    return ".jpg";
  }
  if (mediaType === "image/webp") {
    return ".webp";
  }
  return "";
}

function safeDisplayFilename(object: AuthorizedCommittedObject): string {
  const raw =
    object.displayFilename ??
    `artifact-${object.artifactId}${extensionForMediaType(object.mediaType)}`;
  const withoutControls = [...raw]
    .map((character) => (hasControlCharacter(character) ? "_" : character))
    .join("");
  const normalized = [...withoutControls.normalize("NFKC")]
    .slice(0, 180)
    .join("")
    .replace(/[/\\]/gu, "_")
    .replace(/^[.\s]+|[.\s]+$/gu, "");
  return normalized === "" || normalized === "." || normalized === ".."
    ? `artifact-${object.artifactId}`
    : normalized;
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/gu,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function contentDisposition(object: AuthorizedCommittedObject): string {
  const filename = safeDisplayFilename(object);
  const ascii =
    filename
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]/gu, "_")
      .replace(/["\\;%]/gu, "_")
      .replace(/\s+/gu, " ")
      .trim()
      .slice(0, 180) || `artifact-${object.artifactId}`;
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc5987(
    filename,
  )}`;
}

function assertCommittedObject(
  object: AuthorizedCommittedObject,
  request: PrepareArtifactDownloadRequest,
  allow: ArtifactDownloadAuthorizationAllow,
): bigint {
  if (
    object.artifactId !== request.artifactId ||
    object.dataClassification !== allow.dataClassification ||
    !sha256Pattern.test(object.sha256) ||
    !identityHashPattern.test(object.immutableIdentityHash) ||
    !mediaTypePattern.test(object.mediaType)
  ) {
    return fail(
      "artifact_download.object_mismatch",
      "Committed artifact facts do not match authorization.",
    );
  }
  return parseUint64(object.byteSize, "Artifact byte size");
}

export function createArtifactDownloadCoordinator(
  options: CreateArtifactDownloadCoordinatorOptions,
): ArtifactDownloadCoordinator {
  const clock = options.now ?? (() => new Date());
  return Object.freeze({
    async prepare(
      request: PrepareArtifactDownloadRequest,
    ): Promise<PreparedArtifactDownload> {
      assertRequest(request);
      const authorizeNow = clock();
      if (!validDate(authorizeNow)) {
        return fail(
          "artifact_download.invalid_configuration",
          "Artifact download clock returned an invalid date.",
        );
      }
      let decision: ArtifactDownloadAuthorizationDecision;
      try {
        decision = await options.authorization.authorize({
          principalId: request.principalId,
          workspaceId: request.workspaceId,
          artifactId: request.artifactId,
          purpose: request.purpose,
          now: authorizeNow,
        });
      } catch (error) {
        return fail(
          "artifact_download.denied",
          "Artifact authorization could not be established.",
          "not_found",
          error,
        );
      }
      if (decision.decision === "deny") {
        return fail(
          "artifact_download.denied",
          "Artifact download was not authorized.",
          decision.disclosure,
        );
      }
      assertAllowBinding(decision, request, authorizeNow);

      let object: AuthorizedCommittedObject;
      try {
        object = await options.store.readAuthorizedCommittedObject({
          workspaceId: request.workspaceId,
          artifactId: request.artifactId,
          allowedDataClassifications: [decision.dataClassification],
        });
      } catch (error) {
        return fail(
          "artifact_download.unavailable",
          "Authorized artifact is unavailable.",
          "not_found",
          error,
        );
      }
      const totalSize = assertCommittedObject(object, request, decision);
      const range = parseRange(request.rangeHeader, totalSize);
      const profile = options.profiles.resolve(object.storageProfileId);
      if (
        !profile ||
        profile.kind !== profile.adapter.kind ||
        profile.adapter.storageProfileId !== object.storageProfileId ||
        !profile.adapter.capabilities.rangeRead ||
        object.storageVersionId !== undefined
      ) {
        return fail(
          "artifact_download.unavailable",
          "Committed artifact storage profile is unavailable.",
        );
      }

      const revalidateNow = clock();
      if (!validDate(revalidateNow)) {
        return fail(
          "artifact_download.invalid_configuration",
          "Artifact download clock returned an invalid revalidation date.",
        );
      }
      let revalidated: ArtifactDownloadAuthorizationDecision;
      try {
        revalidated = await options.authorization.revalidate(
          decision,
          revalidateNow,
        );
      } catch (error) {
        return fail(
          "artifact_download.revoked",
          "Artifact authorization could not be revalidated.",
          "not_found",
          error,
        );
      }
      if (revalidated.decision === "deny") {
        return fail(
          "artifact_download.revoked",
          "Artifact authorization was revoked before object access.",
          revalidated.disclosure,
        );
      }
      assertRevalidatedBinding(decision, revalidated, request, revalidateNow);

      /*
       * No direct path or URL exists in this API. Restricted objects and
       * all server-owned profiles are opened through the trusted adapter only
       * after the second authorization check.
       */
      let read: StorageReadHandle;
      try {
        read = await profile.adapter.openRead({
          identity: Object.freeze({
            storageProfileId: object.storageProfileId,
            container: object.container,
            objectKey: object.objectKey,
          }),
          expectedByteSize: object.byteSize,
          expectedSha256: object.sha256,
          expectedImmutableIdentityHash: object.immutableIdentityHash,
          ...(range ? { range } : {}),
        });
      } catch (error) {
        return fail(
          "artifact_download.unavailable",
          "Committed artifact could not be opened safely.",
          "not_found",
          error,
        );
      }
      const partial = read.range !== undefined;
      const headers = Object.freeze({
        "accept-ranges": "bytes" as const,
        "cache-control": "private, no-store" as const,
        "content-disposition": contentDisposition(object),
        "content-length": read.contentByteSize,
        "content-type": object.mediaType,
        ...(read.range
          ? {
              "content-range": `bytes ${read.range.start}-${read.range.endInclusive}/${read.totalByteSize}`,
            }
          : {}),
        "x-content-type-options": "nosniff" as const,
      });
      return Object.freeze({
        delivery: "proxy" as const,
        status: partial ? (206 as const) : (200 as const),
        dataClassification: object.dataClassification,
        headers,
        body: read.body,
      });
    },
  });
}
