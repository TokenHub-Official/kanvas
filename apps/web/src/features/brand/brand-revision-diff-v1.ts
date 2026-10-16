import type {
  BrandKitColor,
  BrandKitGuidelines,
  BrandKitLogo,
  BrandKitReferenceImage,
  BrandKitRevision,
  BrandKitTextStyle,
} from "@kanvas/contracts/api";

export interface BrandDocumentProjectionV1 {
  readonly name: string;
  readonly description?: string;
  readonly colors: readonly BrandKitColor[];
  readonly logos: readonly BrandKitLogo[];
  readonly referenceImages: readonly BrandKitReferenceImage[];
  readonly textStyles: readonly BrandKitTextStyle[];
  readonly guidelines: BrandKitGuidelines;
}

export interface BrandCollectionChangesV1 {
  readonly added: readonly string[];
  readonly changed: readonly string[];
  readonly removed: readonly string[];
}

export interface BrandRevisionChangesV1 {
  readonly identityChanged: boolean;
  readonly colors: BrandCollectionChangesV1;
  readonly logos: BrandCollectionChangesV1;
  readonly referenceImages: BrandCollectionChangesV1;
  readonly textStyles: BrandCollectionChangesV1;
  readonly guidelinesChanged: boolean;
  readonly hasChanges: boolean;
}

function comparable(value: unknown): string {
  return JSON.stringify(value);
}

function collectionChangesV1<
  T extends { readonly key: string; readonly name: string },
>(current: readonly T[], next: readonly T[]): BrandCollectionChangesV1 {
  const currentByKey = new Map(current.map((item) => [item.key, item]));
  const nextByKey = new Map(next.map((item) => [item.key, item]));
  const added: string[] = [];
  const changed: string[] = [];
  const removed: string[] = [];
  for (const item of next) {
    const previous = currentByKey.get(item.key);
    if (!previous) added.push(item.name);
    else if (comparable(previous) !== comparable(item)) changed.push(item.name);
  }
  for (const item of current) {
    if (!nextByKey.has(item.key)) removed.push(item.name);
  }
  return Object.freeze({
    added: Object.freeze(added),
    changed: Object.freeze(changed),
    removed: Object.freeze(removed),
  });
}

function collectionHasChanges(changes: BrandCollectionChangesV1): boolean {
  return (
    changes.added.length > 0 ||
    changes.changed.length > 0 ||
    changes.removed.length > 0
  );
}

export function brandRevisionChangesV1(
  current: BrandDocumentProjectionV1,
  next: BrandDocumentProjectionV1,
): BrandRevisionChangesV1 {
  const colors = collectionChangesV1(current.colors, next.colors);
  const logos = collectionChangesV1(current.logos, next.logos);
  const referenceImages = collectionChangesV1(
    current.referenceImages,
    next.referenceImages,
  );
  const textStyles = collectionChangesV1(current.textStyles, next.textStyles);
  const identityChanged =
    current.name !== next.name ||
    (current.description ?? "") !== (next.description ?? "");
  const guidelinesChanged =
    comparable(current.guidelines) !== comparable(next.guidelines);
  return Object.freeze({
    identityChanged,
    colors,
    logos,
    referenceImages,
    textStyles,
    guidelinesChanged,
    hasChanges:
      identityChanged ||
      guidelinesChanged ||
      collectionHasChanges(colors) ||
      collectionHasChanges(logos) ||
      collectionHasChanges(referenceImages) ||
      collectionHasChanges(textStyles),
  });
}

export function brandRevisionProjectionV1(
  revision: BrandKitRevision,
): BrandDocumentProjectionV1 {
  return revision;
}
