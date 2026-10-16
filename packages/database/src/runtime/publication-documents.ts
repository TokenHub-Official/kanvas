import type { WorkflowPresentation } from "@kanvas/contracts/api";

import { digestProviderValue } from "./provider-value-digest.js";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;
const keyPattern = /^[a-z0-9][a-z0-9._-]{0,159}$/u;
const mediaTypePattern =
  /^[a-z0-9][a-z0-9!#$&^_.+-]{0,79}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,79}$/u;

export type SkillPublicationResourceKind =
  "instructions" | "reference" | "template" | "asset" | "eval";

export interface WorkflowPublicationDocumentV1 {
  readonly schemaVersion: 1;
  readonly topology: Readonly<Record<string, unknown>>;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  readonly outputSchema: Readonly<Record<string, unknown>>;
  readonly presentation?: WorkflowPresentation;
}

export interface SkillPublicationResourceV1 {
  readonly path: string;
  readonly resourceKind: SkillPublicationResourceKind;
  readonly storedObjectId: string;
  readonly contentDigest: string;
  readonly mediaType: string;
  readonly byteSize: number;
}

export interface SkillPublicationWorkflowEntrypointV1 {
  readonly entrypointKey: string;
  readonly workflowRevisionId: string;
}

export interface SkillPublicationDocumentV1 {
  readonly schemaVersion: 1;
  readonly manifest: Readonly<Record<string, unknown>>;
  readonly resources: readonly SkillPublicationResourceV1[];
  readonly workflowEntrypoints: readonly SkillPublicationWorkflowEntrypointV1[];
}

export class PublicationDocumentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "PublicationDocumentError";
  }
}

function fail(message: string): never {
  throw new PublicationDocumentError(message);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireRecord(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) {
    fail(`${label} must be a JSON object.`);
  }
  return value;
}

function requireExactKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
  label: string,
): void {
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (
    actual.length !== expected.size ||
    actual.some((key) => !expected.has(key))
  ) {
    fail(`${label} contains missing or unknown fields.`);
  }
}

function requireAllowedKeys(
  value: Readonly<Record<string, unknown>>,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
  label: string,
): void {
  const allowed = new Set([...requiredKeys, ...optionalKeys]);
  const actual = Object.keys(value);
  if (
    requiredKeys.some((key) => !Object.hasOwn(value, key)) ||
    actual.some((key) => !allowed.has(key))
  ) {
    fail(`${label} contains missing or unknown fields.`);
  }
}

function requireBoundedString(
  value: unknown,
  label: string,
  maximumLength: number,
): string {
  const containsControlCharacter =
    typeof value === "string" &&
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
    });
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    containsControlCharacter
  ) {
    fail(`${label} must be a bounded string without control characters.`);
  }
  return value;
}

function requireId(value: unknown, label: string): string {
  if (typeof value !== "string" || !idPattern.test(value)) {
    fail(`${label} must be a canonical uppercase ULID.`);
  }
  return value;
}

function requireDigest(value: unknown, label: string): string {
  if (typeof value !== "string" || !digestPattern.test(value)) {
    fail(`${label} must be a canonical SHA-256 digest.`);
  }
  return value;
}

function requireKey(value: unknown, label: string): string {
  if (typeof value !== "string" || !keyPattern.test(value)) {
    fail(`${label} must use the stable lowercase key profile.`);
  }
  return value;
}

export function parseWorkflowPresentation(
  value: unknown,
): WorkflowPresentation {
  const presentation = requireRecord(value, "Workflow presentation");
  requireAllowedKeys(
    presentation,
    ["schemaVersion", "tags", "availability"],
    // inputUi is accepted only to read drafts created by the short-lived
    // outer-field presentation prototype. It is deliberately not projected.
    ["title", "description", "category", "cover", "inputUi"],
    "Workflow presentation",
  );
  if (presentation.schemaVersion !== 1) {
    fail("Workflow presentation schemaVersion is not supported.");
  }
  const title =
    presentation.title === undefined
      ? undefined
      : requireBoundedString(
          presentation.title,
          "Workflow presentation.title",
          240,
        );
  const description =
    presentation.description === undefined
      ? undefined
      : requireBoundedString(
          presentation.description,
          "Workflow presentation.description",
          1000,
        );
  const category =
    presentation.category === undefined
      ? undefined
      : requireBoundedString(
          presentation.category,
          "Workflow presentation.category",
          120,
        );
  if (!Array.isArray(presentation.tags) || presentation.tags.length > 20) {
    fail("Workflow presentation.tags must be a bounded array.");
  }
  const tags = presentation.tags.map((tag) =>
    requireBoundedString(tag, "Workflow presentation.tags[]", 80),
  );
  if (new Set(tags).size !== tags.length) {
    fail("Workflow presentation.tags must be unique.");
  }
  let cover: WorkflowPresentation["cover"];
  if (presentation.cover !== undefined) {
    const value = requireRecord(
      presentation.cover,
      "Workflow presentation.cover",
    );
    requireExactKeys(
      value,
      ["artifactId", "alt"],
      "Workflow presentation.cover",
    );
    cover = {
      artifactId: requireId(
        value.artifactId,
        "Workflow presentation.cover.artifactId",
      ),
      alt: requireBoundedString(
        value.alt,
        "Workflow presentation.cover.alt",
        500,
      ),
    };
  }
  const availability = requireRecord(
    presentation.availability,
    "Workflow presentation.availability",
  );
  requireExactKeys(
    availability,
    ["standalone", "canvas", "directLink"],
    "Workflow presentation.availability",
  );
  for (const key of ["standalone", "canvas", "directLink"] as const) {
    if (typeof availability[key] !== "boolean") {
      fail(`Workflow presentation.availability.${key} must be boolean.`);
    }
  }
  return Object.freeze({
    schemaVersion: 1,
    ...(title ? { title } : {}),
    ...(description ? { description } : {}),
    ...(category ? { category } : {}),
    tags: [...tags],
    ...(cover ? { cover: Object.freeze(cover) } : {}),
    availability: Object.freeze({
      standalone: availability.standalone as boolean,
      canvas: availability.canvas as boolean,
      directLink: availability.directLink as boolean,
    }),
  });
}

function requireSafeResourcePath(value: unknown): string {
  const path = requireBoundedString(value, "resource.path", 500);
  if (
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    path !== path.normalize("NFC")
  ) {
    fail("resource.path is not a normalized relative package path.");
  }
  const segments = path.split("/");
  if (
    segments.length > 12 ||
    segments.some(
      (segment) =>
        segment.length < 1 ||
        segment.length > 120 ||
        segment === "." ||
        segment === "..",
    )
  ) {
    fail("resource.path exceeds the bounded package path profile.");
  }
  return path;
}

function parseResource(value: unknown): SkillPublicationResourceV1 {
  const record = requireRecord(value, "Skill resource");
  requireExactKeys(
    record,
    [
      "path",
      "resourceKind",
      "storedObjectId",
      "contentDigest",
      "mediaType",
      "byteSize",
    ],
    "Skill resource",
  );
  const resourceKind = record.resourceKind;
  if (
    resourceKind !== "instructions" &&
    resourceKind !== "reference" &&
    resourceKind !== "template" &&
    resourceKind !== "asset" &&
    resourceKind !== "eval"
  ) {
    fail("resource.resourceKind is not supported.");
  }
  const mediaType = requireBoundedString(
    record.mediaType,
    "resource.mediaType",
    160,
  ).toLowerCase();
  if (!mediaTypePattern.test(mediaType)) {
    fail("resource.mediaType is not a canonical media type.");
  }
  if (
    !Number.isSafeInteger(record.byteSize) ||
    (record.byteSize as number) < 1 ||
    (record.byteSize as number) > 4_294_967_295
  ) {
    fail("resource.byteSize must be a bounded positive integer.");
  }
  return Object.freeze({
    path: requireSafeResourcePath(record.path),
    resourceKind,
    storedObjectId: requireId(record.storedObjectId, "resource.storedObjectId"),
    contentDigest: requireDigest(
      record.contentDigest,
      "resource.contentDigest",
    ),
    mediaType,
    byteSize: record.byteSize as number,
  });
}

function parseEntrypoint(value: unknown): SkillPublicationWorkflowEntrypointV1 {
  const record = requireRecord(value, "Skill Workflow entrypoint");
  requireExactKeys(
    record,
    ["entrypointKey", "workflowRevisionId"],
    "Skill Workflow entrypoint",
  );
  return Object.freeze({
    entrypointKey: requireKey(record.entrypointKey, "entrypoint.entrypointKey"),
    workflowRevisionId: requireId(
      record.workflowRevisionId,
      "entrypoint.workflowRevisionId",
    ),
  });
}

function assertUniqueSkillIdentities(
  resources: readonly SkillPublicationResourceV1[],
  entrypoints: readonly SkillPublicationWorkflowEntrypointV1[],
): void {
  const normalizedPaths = new Set<string>();
  for (const resource of resources) {
    const collisionKey = resource.path
      .normalize("NFC")
      .toLocaleLowerCase("en-US");
    if (normalizedPaths.has(collisionKey)) {
      fail(
        "Skill resources contain a Unicode or case-insensitive path collision.",
      );
    }
    normalizedPaths.add(collisionKey);
  }
  const entrypointKeys = new Set<string>();
  for (const entrypoint of entrypoints) {
    if (entrypointKeys.has(entrypoint.entrypointKey)) {
      fail("Skill Workflow entrypoint keys must be unique.");
    }
    entrypointKeys.add(entrypoint.entrypointKey);
  }
}

export function parseWorkflowPublicationDocument(
  value: unknown,
): WorkflowPublicationDocumentV1 {
  const record = requireRecord(value, "Workflow publication document");
  requireAllowedKeys(
    record,
    ["schemaVersion", "topology", "inputSchema", "outputSchema"],
    ["presentation"],
    "Workflow publication document",
  );
  if (record.schemaVersion !== 1) {
    fail("Workflow publication schemaVersion is not supported.");
  }
  return Object.freeze({
    schemaVersion: 1,
    topology: requireRecord(record.topology, "Workflow topology"),
    inputSchema: requireRecord(record.inputSchema, "Workflow inputSchema"),
    outputSchema: requireRecord(record.outputSchema, "Workflow outputSchema"),
    ...(record.presentation !== undefined
      ? { presentation: parseWorkflowPresentation(record.presentation) }
      : {}),
  });
}

export function parseSkillPublicationDocument(
  value: unknown,
): SkillPublicationDocumentV1 {
  const record = requireRecord(value, "Skill publication document");
  requireExactKeys(
    record,
    ["schemaVersion", "manifest", "resources", "workflowEntrypoints"],
    "Skill publication document",
  );
  if (record.schemaVersion !== 1) {
    fail("Skill publication schemaVersion is not supported.");
  }
  if (!Array.isArray(record.resources)) {
    fail("Skill resources must be an array.");
  }
  if (record.resources.length < 1 || record.resources.length > 256) {
    fail("Skill resources must contain between 1 and 256 entries.");
  }
  if (!Array.isArray(record.workflowEntrypoints)) {
    fail("Skill workflowEntrypoints must be an array.");
  }
  if (record.workflowEntrypoints.length > 32) {
    fail("Skill workflowEntrypoints exceeds the V0 bound.");
  }
  const resources = Object.freeze(record.resources.map(parseResource));
  const workflowEntrypoints = Object.freeze(
    record.workflowEntrypoints.map(parseEntrypoint),
  );
  assertUniqueSkillIdentities(resources, workflowEntrypoints);
  return Object.freeze({
    schemaVersion: 1,
    manifest: requireRecord(record.manifest, "Skill manifest"),
    resources,
    workflowEntrypoints,
  });
}

export function skillPackageDigest(
  document: SkillPublicationDocumentV1,
): string {
  return digestProviderValue({
    schemaVersion: document.schemaVersion,
    manifest: document.manifest,
    resources: document.resources.map((resource) => ({
      path: resource.path,
      resourceKind: resource.resourceKind,
      contentDigest: resource.contentDigest,
      mediaType: resource.mediaType,
      byteSize: resource.byteSize,
    })),
    workflowEntrypoints: document.workflowEntrypoints,
  });
}
