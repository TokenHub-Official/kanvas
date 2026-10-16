import {
  extractLibraryDocument,
  loadLibraryDocumentText,
} from "@kanvas/storage";
import { createHash } from "node:crypto";
import {
  BadRequestException,
  Inject,
  Injectable,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  libraryTextMaximumBytes,
  libraryDocumentMaximumBytes,
  libraryPdfMediaType,
  libraryDocxMediaType,
  type LibraryTextExtraction,
  type TrustedWorkspaceScope,
} from "@kanvas/application";
import type { LibraryUploadQuery } from "@kanvas/contracts/api";
import { ContentTransferStoreError } from "@kanvas/database/runtime";
import { ulid } from "ulid";
import type { ServerDatabaseRuntime } from "../app.module.js";
import { DATABASE_RUNTIME, SERVER_STORAGE_RUNTIME } from "../tokens.js";
import type { ServerStorageRuntime } from "../storage/server-storage-runtime.js";
import { canonicalDigest } from "../application-adapters.js";
import {
  translateContentTransferError,
  translateUploadError,
} from "../storage/content-transfer.service.js";

export function libraryAudit(scope: TrustedWorkspaceScope, requestId?: string) {
  return {
    auditEventId: ulid(),
    authenticationRefHash: `sha256:${createHash("sha256").update(scope.authenticationRefId).digest("hex")}`,
    ...(requestId ? { requestId } : {}),
  };
}

@Injectable()
export class ResourceLibraryService {
  constructor(
    @Inject(DATABASE_RUNTIME) private readonly database: ServerDatabaseRuntime,
    @Inject(SERVER_STORAGE_RUNTIME)
    private readonly storage: ServerStorageRuntime | undefined,
  ) {}
  async text(
    scope: TrustedWorkspaceScope,
    libraryId: string,
    artifactId: string,
  ) {
    const source = await this.database.resourceLibraries.getTextSource({
      authority: scope,
      libraryId,
      artifactId,
      now: new Date(),
    });
    if (source.extraction)
      return { ...source.extraction, contentDigest: source.contentDigest };
    if (!this.storage)
      throw new ServiceUnavailableException("Storage is not configured.");
    const loaded = await loadLibraryDocumentText(source, this.storage.profiles);
    await this.database.resourceLibraries.indexText({
      authority: scope,
      libraryId,
      artifactId,
      contentDigest: source.contentDigest,
      text: loaded.extraction.text,
      extraction: loaded.extraction,
      sourceBytes: loaded.sourceBytes,
      now: new Date(),
    });
    // Revalidate after extraction/storage I/O, and return the immutable first extraction.
    const verified = await this.database.resourceLibraries.getTextSource({
      authority: scope,
      libraryId,
      artifactId,
      now: new Date(),
    });
    if (!verified.extraction)
      throw new ServiceUnavailableException("Document index is unavailable.");
    return { ...verified.extraction, contentDigest: verified.contentDigest };
  }
  async upload(
    scope: TrustedWorkspaceScope,
    libraryId: string,
    key: string,
    query: LibraryUploadQuery,
    body: unknown,
    requestId?: string,
  ) {
    const storage = this.storage;
    if (!storage)
      throw new ServiceUnavailableException("Storage is not configured.");
    if (!/^[\x21-\x7e]{1,160}$/u.test(key))
      throw new BadRequestException("A bounded idempotency key is required.");
    const text = query.mediaType.startsWith("text/");
    const document = [libraryPdfMediaType, libraryDocxMediaType].includes(
      query.mediaType,
    );
    let fileMaximum = 134217728;
    if (text) fileMaximum = libraryTextMaximumBytes;
    else if (document) fileMaximum = libraryDocumentMaximumBytes;
    const maximum = Math.min(storage.maximumInputBytes, fileMaximum);
    if (BigInt(query.byteSize) > BigInt(maximum))
      throw new PayloadTooLargeException("File exceeds the upload limit.");
    if (!body || typeof body !== "object" || !(Symbol.asyncIterator in body))
      throw new BadRequestException("A binary file stream is required.");
    await this.database.resourceLibraries.authorizeUpload({
      authority: scope,
      libraryId,
      now: new Date(),
    });
    let textBytes: Buffer | undefined;
    let extraction: LibraryTextExtraction | undefined;
    if (text || document) {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of body as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > maximum)
          throw new PayloadTooLargeException("File exceeds the upload limit.");
        chunks.push(Buffer.from(chunk));
      }
      textBytes = Buffer.concat(chunks, size);
      extraction = await extractLibraryDocument(textBytes, query.mediaType);
      if (
        String(size) !== query.byteSize ||
        createHash("sha256").update(textBytes).digest("hex") !== query.sha256
      )
        throw new BadRequestException(
          "Text does not match the declared upload identity.",
        );
      const buffered = textBytes;
      body = {
        async *[Symbol.asyncIterator]() {
          yield await Promise.resolve(buffered);
        },
      };
    }
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + storage.userImportSessionTtlMilliseconds,
    );
    const uploadId = ulid();
    try {
      const probe = await storage.ensureCompatibilityProbe(
        scope.workspaceId,
        ulid(),
        now,
      );
      const session = await this.database.storageUploads.allocateUploadSession({
        id: uploadId,
        workspaceId: scope.workspaceId,
        actorId: scope.principalId,
        authority: scope,
        allocationRequestKey: `library:${createHash("sha256")
          .update(
            JSON.stringify([
              scope.workspaceId,
              scope.principalId,
              libraryId,
              key,
            ]),
          )
          .digest("hex")}`,
        allocationRequestHash: canonicalDigest.of({ libraryId, ...query }),
        purpose: "user_import",
        expectedSize: query.byteSize,
        expectedMediaType: query.mediaType,
        expectedSha256: query.sha256,
        storageProfileId: storage.profileId,
        compatibilityProbeId: probe.id,
        profileConfigurationHash: storage.profileConfigurationHash,
        container: storage.container,
        objectKey: `workspaces/${scope.workspaceId}/libraries/${libraryId}/${uploadId}`,
        uploadMode: "server_stream",
        writeProtectionMode: "server_owned",
        verificationProfileVersion: storage.verificationProfileVersion,
        now,
        expiresAt,
        cleanupEligibleAt: new Date(
          expiresAt.getTime() + storage.cleanupGraceMilliseconds,
        ),
      });
      const documentUploads = document
        ? storage.libraryDocumentUploads
        : storage.uploads;
      if (session.state !== "committed" && session.state !== "verified") {
        await (text ? storage.libraryTextUploads : documentUploads).ingest({
          session,
          body: body as AsyncIterable<Uint8Array>,
        });
      }
      const result = await this.database.contentTransfers.commitUserImport({
        authority: scope,
        libraryId,
        uploadSessionId: session.id,
        storedObjectId: ulid(),
        artifactId: ulid(),
        outboxEventId: ulid(),
        artifactType:
          text || document
            ? "document.text"
            : `image.${query.mediaType.slice(6)}`,
        dataClassification: "internal",
        displayFilename: query.filename,
        metadata: { importedFrom: "resource-library", libraryId },
        audit: libraryAudit(scope, requestId),
        now: new Date(),
      });
      if (textBytes && extraction) {
        await this.database.resourceLibraries.indexText({
          authority: scope,
          libraryId,
          artifactId: result.artifactId,
          contentDigest: `sha256:${query.sha256}`,
          text: extraction.text,
          sourceBytes: textBytes,
          extraction,
          now: new Date(),
        });
      }
      return {
        artifactId: result.artifactId,
        mediaType: result.mediaType,
        byteSize: result.byteSize,
        replayed: result.status === "replayed",
      };
    } catch (error) {
      if (error instanceof ContentTransferStoreError)
        translateContentTransferError(error);
      return translateUploadError(error);
    }
  }
}
