export * from "./document-text.js";
import type {
  LibraryTextExtraction,
  LibraryTextSource,
} from "./document-text.js";
export {
  libraryTextPassages,
  readLibraryTextPassages,
  type LibraryTextPassage,
} from "./text-passages.js";
import { DomainError } from "../../foundation/domain-error.js";
import type { TrustedWorkspaceScope } from "../authorization/index.js";

export interface LibraryEntry {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly artifactId: string;
  readonly sourceAssetId?: string;
}

export interface ResourceLibraryDocument {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly description: string;
  readonly entries: readonly LibraryEntry[];
}

export interface ResourceLibraryRevision {
  readonly id: string;
  readonly libraryId: string;
  readonly revisionNumber: number;
  readonly document: ResourceLibraryDocument;
  readonly contentDigest: string;
  readonly createdAt: Date;
}

export interface ResourceLibrarySummary {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly lifecycleStatus: "active" | "archived";
  readonly version: number;
  readonly currentRevisionId: string;
  readonly entryCount: number;
  readonly updatedAt: Date;
}

export interface LibraryAuditContext {
  readonly auditEventId: string;
  readonly authenticationRefHash: string;
  readonly requestId?: string;
}

export interface SaveResourceLibrary {
  readonly authority: TrustedWorkspaceScope;
  readonly libraryId: string;
  // Zero creates a library; existing libraries require the observed version.
  readonly expectedVersion: number;
  readonly document: ResourceLibraryDocument;
  readonly requestKey: string;
  readonly revisionId: string;
  readonly audit: LibraryAuditContext;
  readonly now: Date;
}

export interface ResourceLibraryRepository {
  getTextSource(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly libraryId: string;
    readonly artifactId: string;
    readonly now: Date;
  }): Promise<LibraryTextSource>;

  indexText(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly libraryId: string;
    readonly artifactId: string;
    readonly contentDigest: string;
    readonly text: string;
    readonly sourceBytes?: Uint8Array;
    readonly extraction?: LibraryTextExtraction;
    readonly now: Date;
  }): Promise<void>;

  getSummary(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly libraryId: string;
    readonly now: Date;
  }): Promise<ResourceLibrarySummary>;
  authorizeUpload(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly libraryId: string;
    readonly now: Date;
  }): Promise<void>;
  list(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly lifecycleStatus: "active" | "archived";
    readonly query?: string;
    readonly afterId?: string;
    readonly limit: number;
    readonly now: Date;
  }): Promise<readonly ResourceLibrarySummary[]>;
  getRevision(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly libraryId: string;
    readonly revisionId?: string;
    readonly now: Date;
  }): Promise<ResourceLibraryRevision>;
  save(options: SaveResourceLibrary): Promise<{
    readonly revision: ResourceLibraryRevision;
    readonly replayed: boolean;
  }>;
  setLifecycle(options: {
    readonly authority: TrustedWorkspaceScope;
    readonly libraryId: string;
    readonly expectedVersion: number;
    readonly lifecycleStatus: "active" | "archived";
    readonly audit: LibraryAuditContext;
    readonly now: Date;
  }): Promise<void>;
}

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
export function assertLibraryId(value: unknown): asserts value is string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    throw new DomainError(
      "resource_library.invalid_argument",
      "Invalid resource identity.",
    );
  }
}

function boundedText(
  value: unknown,
  maximum: number,
  required = false,
): string {
  if (typeof value !== "string")
    throw new DomainError(
      "resource_library.invalid_argument",
      "Expected text.",
    );
  const text = value.trim();
  if (text.length > maximum || (required && !text) || text.includes("\0")) {
    throw new DomainError(
      "resource_library.invalid_argument",
      "Invalid resource text length or content.",
    );
  }
  return text;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DomainError(
      "resource_library.invalid_argument",
      "Expected a resource document.",
    );
  return value as Readonly<Record<string, unknown>>;
}

export function normalizeResourceLibraryDocument(
  value: unknown,
): ResourceLibraryDocument {
  const input = record(value);
  if (
    input.schemaVersion !== 1 ||
    !Array.isArray(input.entries) ||
    input.entries.length > 200
  ) {
    throw new DomainError(
      "resource_library.invalid_argument",
      "Unsupported library schema or entry count.",
    );
  }
  const ids = new Set<string>();
  const entries = input.entries.map((value: unknown) => {
    const entry = record(value);
    assertLibraryId(entry.id);
    assertLibraryId(entry.artifactId);
    if (entry.sourceAssetId !== undefined) assertLibraryId(entry.sourceAssetId);
    if (ids.has(entry.id)) {
      throw new DomainError(
        "resource_library.invalid_argument",
        "Library entry identities must be unique.",
      );
    }
    ids.add(entry.id);
    return Object.freeze({
      id: entry.id,
      name: boundedText(entry.name, 240, true),
      purpose: boundedText(entry.purpose, 1000),
      artifactId: entry.artifactId,
      ...(entry.sourceAssetId !== undefined
        ? { sourceAssetId: entry.sourceAssetId }
        : {}),
    });
  });
  return Object.freeze({
    schemaVersion: 1,
    name: boundedText(input.name, 160, true),
    description: boundedText(input.description, 2000),
    entries: Object.freeze(entries),
  });
}

export const libraryTextMaximumBytes = 128 * 1024;
export const libraryMediaTypes = Object.freeze([
  "image/png",
  "image/jpeg",
  "image/webp",
  "text/plain",
  "text/markdown",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const);
