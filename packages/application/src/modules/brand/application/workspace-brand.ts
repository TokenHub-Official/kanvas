import type {
  BrandKitColor,
  BrandKitLogo,
  BrandKitReferenceImage,
  BrandKitTextStyle,
} from "@kanvas/contracts/api";

import { DomainError } from "../../../foundation/domain-error.js";
import type { TrustedWorkspaceScope } from "../../authorization/index.js";

export interface BrandKitDocument {
  readonly schemaVersion: 1;
  readonly name: string;
  readonly description?: string;
  readonly colors: readonly BrandKitColor[];
  readonly logos: readonly BrandKitLogo[];
  readonly referenceImages: readonly BrandKitReferenceImage[];
  readonly textStyles: readonly BrandKitTextStyle[];
  readonly guidelines: {
    readonly voice?: string;
    readonly principles: readonly string[];
    readonly avoid: readonly string[];
  };
}

export interface PublishedBrandRevisionSummary {
  readonly id: string;
  readonly revisionNumber: number;
  readonly publishedAt: Date;
}

export interface BrandKitSummaryRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly description?: string;
  readonly lifecycleStatus: "active" | "archived";
  readonly isDefault: boolean;
  readonly version: number;
  readonly draftVersion: number;
  readonly latestPublishedRevision?: PublishedBrandRevisionSummary;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface BrandKitDraftRecord {
  readonly brandKitId: string;
  readonly workspaceId: string;
  readonly lifecycleStatus: "active" | "archived";
  readonly isDefault: boolean;
  readonly brandKitVersion: number;
  readonly draftVersion: number;
  readonly document: BrandKitDocument;
  readonly contentDigest: string;
  readonly latestPublishedRevision?: PublishedBrandRevisionSummary;
  readonly createdByPrincipalId: string;
  readonly updatedByPrincipalId: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface BrandKitRevisionRecord {
  readonly id: string;
  readonly brandKitId: string;
  readonly workspaceId: string;
  readonly revisionNumber: number;
  readonly document: BrandKitDocument;
  readonly contentDigest: string;
  readonly publishedByPrincipalId: string;
  readonly publishedAt: Date;
}

export interface BrandAuditContext {
  readonly auditEventId: string;
  readonly authenticationRefHash: string;
  readonly requestId?: string;
  readonly traceId?: string;
}

export interface CreateBrandKitPersistenceOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly brandKitId: string;
  readonly document: BrandKitDocument;
  readonly idempotencyKey: string;
  readonly actorPrincipalId: string;
  readonly now: Date;
  readonly audit: BrandAuditContext;
}

export interface UpdateBrandKitDraftPersistenceOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly brandKitId: string;
  readonly expectedDraftVersion: number;
  readonly document: BrandKitDocument;
  readonly actorPrincipalId: string;
  readonly now: Date;
  readonly audit: BrandAuditContext;
}

export interface PublishBrandKitPersistenceOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly brandKitId: string;
  readonly brandKitRevisionId: string;
  readonly expectedDraftVersion: number;
  readonly idempotencyKey: string;
  readonly actorPrincipalId: string;
  readonly now: Date;
  readonly audit: BrandAuditContext;
}

export interface SetDefaultBrandKitPersistenceOptions {
  readonly authority: TrustedWorkspaceScope;
  readonly brandKitId: string;
  readonly expectedBrandKitVersion: number;
  readonly actorPrincipalId: string;
  readonly now: Date;
  readonly audit: BrandAuditContext;
}

export interface BrandKitMutationResult<TValue> {
  readonly value: TValue;
  readonly replayed: boolean;
}

export interface WorkspaceBrandRepository {
  list(
    authority: TrustedWorkspaceScope,
    options: {
      readonly lifecycleStatus: "active" | "archived";
      readonly now: Date;
    },
  ): Promise<readonly BrandKitSummaryRecord[]>;
  getDraft(
    authority: TrustedWorkspaceScope,
    brandKitId: string,
    now: Date,
  ): Promise<BrandKitDraftRecord | undefined>;
  getRevision(
    authority: TrustedWorkspaceScope,
    brandKitId: string | undefined,
    brandKitRevisionId: string,
    now: Date,
  ): Promise<BrandKitRevisionRecord | undefined>;
  listRevisions(
    authority: TrustedWorkspaceScope,
    brandKitId: string,
    now: Date,
  ): Promise<readonly PublishedBrandRevisionSummary[]>;
  getDefaultRevision(
    authority: TrustedWorkspaceScope,
    now: Date,
  ): Promise<BrandKitRevisionRecord | undefined>;
  create(
    options: CreateBrandKitPersistenceOptions,
  ): Promise<BrandKitMutationResult<BrandKitDraftRecord>>;
  updateDraft(
    options: UpdateBrandKitDraftPersistenceOptions,
  ): Promise<BrandKitDraftRecord>;
  publish(
    options: PublishBrandKitPersistenceOptions,
  ): Promise<BrandKitMutationResult<BrandKitRevisionRecord>>;
  setDefault(
    options: SetDefaultBrandKitPersistenceOptions,
  ): Promise<BrandKitSummaryRecord>;
}

export interface CreateBrandKitCommand {
  readonly authority: TrustedWorkspaceScope;
  readonly name: string;
  readonly description?: string;
  readonly idempotencyKey: string;
  readonly audit: BrandAuditContext;
}

export interface UpdateBrandKitDraftCommand {
  readonly authority: TrustedWorkspaceScope;
  readonly brandKitId: string;
  readonly expectedDraftVersion: number;
  readonly name: string;
  readonly description?: string;
  readonly colors: readonly BrandKitColor[];
  readonly logos: readonly BrandKitLogo[];
  readonly referenceImages: readonly BrandKitReferenceImage[];
  readonly textStyles: readonly BrandKitTextStyle[];
  readonly guidelines: BrandKitDocument["guidelines"];
  readonly audit: BrandAuditContext;
}

export interface PublishBrandKitCommand {
  readonly authority: TrustedWorkspaceScope;
  readonly brandKitId: string;
  readonly expectedDraftVersion: number;
  readonly idempotencyKey: string;
  readonly audit: BrandAuditContext;
}

export interface SetDefaultBrandKitCommand {
  readonly authority: TrustedWorkspaceScope;
  readonly brandKitId: string;
  readonly expectedBrandKitVersion: number;
  readonly audit: BrandAuditContext;
}

export interface WorkspaceBrand {
  list(
    authority: TrustedWorkspaceScope,
    options?: { readonly lifecycleStatus?: "active" | "archived" },
  ): Promise<readonly BrandKitSummaryRecord[]>;
  getDraft(
    authority: TrustedWorkspaceScope,
    brandKitId: string,
  ): Promise<BrandKitDraftRecord>;
  getRevision(
    authority: TrustedWorkspaceScope,
    brandKitId: string,
    brandKitRevisionId: string,
  ): Promise<BrandKitRevisionRecord>;
  listRevisions(
    authority: TrustedWorkspaceScope,
    brandKitId: string,
  ): Promise<readonly PublishedBrandRevisionSummary[]>;
  getDefaultRevision(
    authority: TrustedWorkspaceScope,
  ): Promise<BrandKitRevisionRecord>;
  create(
    command: CreateBrandKitCommand,
  ): Promise<BrandKitMutationResult<BrandKitDraftRecord>>;
  updateDraft(
    command: UpdateBrandKitDraftCommand,
  ): Promise<BrandKitDraftRecord>;
  publish(
    command: PublishBrandKitCommand,
  ): Promise<BrandKitMutationResult<BrandKitRevisionRecord>>;
  setDefault(
    command: SetDefaultBrandKitCommand,
  ): Promise<BrandKitSummaryRecord>;
}

const colorRoles = new Set<BrandKitColor["role"]>([
  "primary",
  "secondary",
  "accent",
  "background",
  "surface",
  "text_primary",
  "text_secondary",
]);
const colorKeyPattern = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/u;
const colorValuePattern = /^#[0-9A-Fa-f]{6}(?:[0-9A-Fa-f]{2})?$/u;
const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const logoRoles = new Set<BrandKitLogo["role"]>(["primary", "inverse", "icon"]);
const textStyleRoles = new Set<BrandKitTextStyle["role"]>([
  "display",
  "title",
  "subtitle",
  "body",
  "caption",
]);

function invalid(message: string): never {
  throw new DomainError("brand.invalid_argument", message);
}

function normalizedText(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (normalized.length < 1 || value.length > maximum) {
    return invalid(
      `${label} must contain between 1 and ${String(maximum)} characters.`,
    );
  }
  return normalized;
}

function normalizedDescription(value: string): string {
  return normalizedText(value, "description", 500);
}

export function normalizeBrandKitDocument(input: {
  readonly name: string;
  readonly description?: string;
  readonly colors: readonly BrandKitColor[];
  readonly logos: readonly BrandKitLogo[];
  readonly referenceImages: readonly BrandKitReferenceImage[];
  readonly textStyles: readonly BrandKitTextStyle[];
  readonly guidelines: BrandKitDocument["guidelines"];
}): BrandKitDocument {
  if (input.colors.length > 64) {
    return invalid("colors cannot contain more than 64 entries.");
  }
  const keys = new Set<string>();
  const positions = new Set<number>();
  const colors = input.colors.map((color) => {
    if (
      !colorKeyPattern.test(color.key) ||
      keys.has(color.key) ||
      color.key.length > 80
    ) {
      return invalid("Each brand color must use one unique stable key.");
    }
    if (
      !Number.isInteger(color.position) ||
      color.position < 0 ||
      color.position > 999 ||
      positions.has(color.position)
    ) {
      return invalid("Each brand color must use one unique bounded position.");
    }
    if (!colorRoles.has(color.role) || !colorValuePattern.test(color.value)) {
      return invalid("Brand color role or value is not supported.");
    }
    keys.add(color.key);
    positions.add(color.position);
    return Object.freeze({
      key: color.key,
      name: normalizedText(color.name, "color.name", 120),
      role: color.role,
      value: color.value.toUpperCase(),
      position: color.position,
    });
  });
  if (input.logos.length > 12) {
    return invalid("logos cannot contain more than 12 entries.");
  }
  const logoKeys = new Set<string>();
  const logoPositions = new Set<number>();
  const logos = input.logos.map((logo) => {
    if (
      !colorKeyPattern.test(logo.key) ||
      logoKeys.has(logo.key) ||
      logo.key.length > 80 ||
      !idPattern.test(logo.assetId) ||
      !idPattern.test(logo.artifactId) ||
      !logoRoles.has(logo.role)
    ) {
      return invalid("Each brand logo must use one valid unique reference.");
    }
    if (
      !Number.isInteger(logo.position) ||
      logo.position < 0 ||
      logo.position > 99 ||
      logoPositions.has(logo.position)
    ) {
      return invalid("Each brand logo must use one unique bounded position.");
    }
    logoKeys.add(logo.key);
    logoPositions.add(logo.position);
    return Object.freeze({
      key: logo.key,
      name: normalizedText(logo.name, "logo.name", 120),
      role: logo.role,
      assetId: logo.assetId,
      artifactId: logo.artifactId,
      position: logo.position,
    });
  });
  if (input.referenceImages.length > 24) {
    return invalid("referenceImages cannot contain more than 24 entries.");
  }
  const referenceImageKeys = new Set<string>();
  const referenceImagePositions = new Set<number>();
  const referenceImages = input.referenceImages.map((reference) => {
    if (
      !colorKeyPattern.test(reference.key) ||
      referenceImageKeys.has(reference.key) ||
      reference.key.length > 80 ||
      !idPattern.test(reference.assetId) ||
      !idPattern.test(reference.artifactId)
    ) {
      return invalid(
        "Each brand reference image must use one valid unique reference.",
      );
    }
    if (
      !Number.isInteger(reference.position) ||
      reference.position < 0 ||
      reference.position > 99 ||
      referenceImagePositions.has(reference.position)
    ) {
      return invalid(
        "Each brand reference image must use one unique bounded position.",
      );
    }
    referenceImageKeys.add(reference.key);
    referenceImagePositions.add(reference.position);
    return Object.freeze({
      key: reference.key,
      name: normalizedText(reference.name, "referenceImage.name", 120),
      ...(reference.description !== undefined
        ? {
            description: normalizedText(
              reference.description,
              "referenceImage.description",
              500,
            ),
          }
        : {}),
      assetId: reference.assetId,
      artifactId: reference.artifactId,
      position: reference.position,
    });
  });
  if (input.textStyles.length > 16) {
    return invalid("textStyles cannot contain more than 16 entries.");
  }
  const colorKeys = new Set(colors.map((color) => color.key));
  const textStyleKeys = new Set<string>();
  const textStylePositions = new Set<number>();
  const textStyles = input.textStyles.map((style) => {
    if (
      !colorKeyPattern.test(style.key) ||
      textStyleKeys.has(style.key) ||
      style.key.length > 80 ||
      !textStyleRoles.has(style.role) ||
      (style.colorKey !== undefined && !colorKeys.has(style.colorKey))
    ) {
      return invalid(
        "Each brand text style must use valid unique keys and brand colors.",
      );
    }
    if (
      !Number.isInteger(style.position) ||
      style.position < 0 ||
      style.position > 99 ||
      textStylePositions.has(style.position) ||
      !Number.isFinite(style.fontSize) ||
      style.fontSize < 6 ||
      style.fontSize > 512 ||
      !Number.isInteger(style.fontWeight) ||
      style.fontWeight < 100 ||
      style.fontWeight > 900 ||
      !Number.isFinite(style.lineHeight) ||
      style.lineHeight < 0.5 ||
      style.lineHeight > 3 ||
      !Number.isFinite(style.letterSpacing) ||
      style.letterSpacing < -10 ||
      style.letterSpacing > 50
    ) {
      return invalid("Brand text style numeric values are outside bounds.");
    }
    textStyleKeys.add(style.key);
    textStylePositions.add(style.position);
    return Object.freeze({
      key: style.key,
      name: normalizedText(style.name, "textStyle.name", 120),
      role: style.role,
      fontId: normalizedText(style.fontId, "textStyle.fontId", 120),
      fontRevision: normalizedText(
        style.fontRevision,
        "textStyle.fontRevision",
        120,
      ),
      fontFamily: normalizedText(style.fontFamily, "textStyle.fontFamily", 160),
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      letterSpacing: style.letterSpacing,
      ...(style.colorKey !== undefined ? { colorKey: style.colorKey } : {}),
      position: style.position,
    });
  });
  const normalizeGuidelineList = (
    values: readonly string[],
    label: string,
  ): readonly string[] => {
    if (values.length > 12) {
      return invalid(`${label} cannot contain more than 12 entries.`);
    }
    const normalized = values.map((value) => normalizedText(value, label, 240));
    if (new Set(normalized).size !== normalized.length) {
      return invalid(`${label} cannot contain duplicates.`);
    }
    return Object.freeze(normalized);
  };
  const guidelines = Object.freeze({
    ...(input.guidelines.voice !== undefined
      ? {
          voice: normalizedText(
            input.guidelines.voice,
            "guidelines.voice",
            1000,
          ),
        }
      : {}),
    principles: normalizeGuidelineList(
      input.guidelines.principles,
      "guidelines.principles",
    ),
    avoid: normalizeGuidelineList(input.guidelines.avoid, "guidelines.avoid"),
  });
  return Object.freeze({
    schemaVersion: 1 as const,
    name: normalizedText(input.name, "name", 160),
    ...(input.description !== undefined
      ? { description: normalizedDescription(input.description) }
      : {}),
    colors: Object.freeze(
      colors.toSorted(
        (left, right) =>
          left.position - right.position || left.key.localeCompare(right.key),
      ),
    ),
    logos: Object.freeze(
      logos.toSorted(
        (left, right) =>
          left.position - right.position || left.key.localeCompare(right.key),
      ),
    ),
    referenceImages: Object.freeze(
      referenceImages.toSorted(
        (left, right) =>
          left.position - right.position || left.key.localeCompare(right.key),
      ),
    ),
    textStyles: Object.freeze(
      textStyles.toSorted(
        (left, right) =>
          left.position - right.position || left.key.localeCompare(right.key),
      ),
    ),
    guidelines,
  });
}

export function createWorkspaceBrand(dependencies: {
  readonly repository: WorkspaceBrandRepository;
  readonly now: () => Date;
  readonly nextId: () => string;
}): WorkspaceBrand {
  const brand: WorkspaceBrand = {
    list(authority, options) {
      return dependencies.repository.list(authority, {
        lifecycleStatus: options?.lifecycleStatus ?? "active",
        now: dependencies.now(),
      });
    },
    async getDraft(authority, brandKitId) {
      const result = await dependencies.repository.getDraft(
        authority,
        brandKitId,
        dependencies.now(),
      );
      if (!result) {
        throw new DomainError("brand.not_found", "Brand Kit was not found.");
      }
      return result;
    },
    async getRevision(authority, brandKitId, brandKitRevisionId) {
      const result = await dependencies.repository.getRevision(
        authority,
        brandKitId,
        brandKitRevisionId,
        dependencies.now(),
      );
      if (!result) {
        throw new DomainError(
          "brand.revision_not_found",
          "Brand Kit Revision was not found.",
        );
      }
      return result;
    },
    listRevisions(authority, brandKitId) {
      return dependencies.repository.listRevisions(
        authority,
        brandKitId,
        dependencies.now(),
      );
    },
    async getDefaultRevision(authority) {
      const result = await dependencies.repository.getDefaultRevision(
        authority,
        dependencies.now(),
      );
      if (!result) {
        throw new DomainError(
          "brand.default_not_found",
          "Default published Brand Kit was not found.",
        );
      }
      return result;
    },
    create(command) {
      return dependencies.repository.create({
        authority: command.authority,
        brandKitId: dependencies.nextId(),
        document: normalizeBrandKitDocument({
          name: command.name,
          ...(command.description !== undefined
            ? { description: command.description }
            : {}),
          colors: [],
          logos: [],
          referenceImages: [],
          textStyles: [],
          guidelines: { principles: [], avoid: [] },
        }),
        idempotencyKey: command.idempotencyKey,
        actorPrincipalId: command.authority.principalId,
        now: dependencies.now(),
        audit: command.audit,
      });
    },
    updateDraft(command) {
      return dependencies.repository.updateDraft({
        authority: command.authority,
        brandKitId: command.brandKitId,
        expectedDraftVersion: command.expectedDraftVersion,
        document: normalizeBrandKitDocument(command),
        actorPrincipalId: command.authority.principalId,
        now: dependencies.now(),
        audit: command.audit,
      });
    },
    publish(command) {
      return dependencies.repository.publish({
        authority: command.authority,
        brandKitId: command.brandKitId,
        brandKitRevisionId: dependencies.nextId(),
        expectedDraftVersion: command.expectedDraftVersion,
        idempotencyKey: command.idempotencyKey,
        actorPrincipalId: command.authority.principalId,
        now: dependencies.now(),
        audit: command.audit,
      });
    },
    setDefault(command) {
      return dependencies.repository.setDefault({
        authority: command.authority,
        brandKitId: command.brandKitId,
        expectedBrandKitVersion: command.expectedBrandKitVersion,
        actorPrincipalId: command.authority.principalId,
        now: dependencies.now(),
        audit: command.audit,
      });
    },
  };
  return Object.freeze(brand);
}
