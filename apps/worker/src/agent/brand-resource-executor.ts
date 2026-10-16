import type {
  AgentActionReceiptRecord,
  TrustedWorkspaceScope,
  WorkspaceBrandRepository,
} from "@kanvas/application";
import type {
  BrandPublishedInspectToolInput,
  BrandPublishedSearchToolInput,
  BrandResourceToolExecution,
  BrandResourceToolExecutor,
} from "@kanvas/agent-runtime";

const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
const maximumResults = 20;

function record(value: unknown): Readonly<Record<string, unknown>> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Readonly<Record<string, unknown>>)
    : undefined;
}

function searchInput(value: unknown): BrandPublishedSearchToolInput {
  const input = record(value);
  const query = input?.query;
  if (
    !input ||
    Object.keys(input).some((key) => key !== "query") ||
    (query !== undefined &&
      (typeof query !== "string" ||
        query.trim().length < 1 ||
        [...query.trim()].length > 200))
  ) {
    throw new TypeError("Published Brand search input is invalid.");
  }
  return Object.freeze({
    ...(typeof query === "string" ? { query: query.trim() } : {}),
  });
}

function inspectInput(value: unknown): BrandPublishedInspectToolInput {
  const input = record(value);
  if (
    !input ||
    Object.keys(input).some((key) => key !== "brandKitRevisionId") ||
    typeof input.brandKitRevisionId !== "string" ||
    !idPattern.test(input.brandKitRevisionId)
  ) {
    throw new TypeError("Published Brand inspection input is invalid.");
  }
  return Object.freeze({ brandKitRevisionId: input.brandKitRevisionId });
}

function normalizedText(value: string | undefined): string {
  return value?.replace(/\s+/gu, " ").trim().toLocaleLowerCase() ?? "";
}

function brandPriority(
  candidate: {
    readonly brandKitId: string;
    readonly brandKitRevisionId: string;
    readonly isDefault: boolean;
  },
  options: {
    readonly selectedBrandRevisionId?: string;
    readonly boundBrandKitIds: ReadonlySet<string>;
  },
): number {
  if (candidate.brandKitRevisionId === options.selectedBrandRevisionId)
    return 0;
  if (options.boundBrandKitIds.has(candidate.brandKitId)) return 1;
  if (candidate.isDefault) return 2;
  return 3;
}

export function createAgentBrandResourceExecutor(options: {
  readonly authority: TrustedWorkspaceScope;
  readonly brands: Pick<WorkspaceBrandRepository, "list" | "getRevision">;
  readonly boundBrandKitIds: ReadonlySet<string>;
  readonly selectedBrandRevisionId?: string;
  readonly now: () => Date;
  readonly executeWithReceipt: (
    toolKey: string,
    input: unknown,
    operation: (
      action: AgentActionReceiptRecord,
    ) => Promise<BrandResourceToolExecution>,
    failureReason: (error: unknown) => string,
  ) => Promise<BrandResourceToolExecution>;
}): BrandResourceToolExecutor {
  return Object.freeze({
    search: (value: BrandPublishedSearchToolInput) => {
      const input = searchInput(value);
      return options.executeWithReceipt(
        "brand.search-published",
        input,
        async () => {
          const summaries = await options.brands.list(options.authority, {
            lifecycleStatus: "active",
            now: options.now(),
          });
          const [publishedRevisions, selectedRevision] = await Promise.all([
            Promise.all(
              summaries.map((brand) => {
                const revisionId = brand.latestPublishedRevision?.id;
                return revisionId
                  ? options.brands.getRevision(
                      options.authority,
                      brand.id,
                      revisionId,
                      options.now(),
                    )
                  : Promise.resolve(undefined);
              }),
            ),
            options.selectedBrandRevisionId
              ? options.brands.getRevision(
                  options.authority,
                  undefined,
                  options.selectedBrandRevisionId,
                  options.now(),
                )
              : Promise.resolve(undefined),
          ]);
          const candidates = publishedRevisions.flatMap((revision, index) => {
            const brand = summaries[index];
            return revision && brand && revision.brandKitId === brand.id
              ? [
                  {
                    brandKitId: brand.id,
                    brandKitRevisionId: revision.id,
                    revisionNumber: revision.revisionNumber,
                    name: revision.document.name,
                    ...(revision.document.description
                      ? { description: revision.document.description }
                      : {}),
                    isDefault: brand.isDefault,
                    publishedAt: revision.publishedAt,
                  },
                ]
              : [];
          });
          if (
            selectedRevision &&
            !candidates.some(
              (candidate) =>
                candidate.brandKitRevisionId === selectedRevision.id,
            )
          ) {
            candidates.push({
              brandKitId: selectedRevision.brandKitId,
              brandKitRevisionId: selectedRevision.id,
              revisionNumber: selectedRevision.revisionNumber,
              name: selectedRevision.document.name,
              ...(selectedRevision.document.description
                ? { description: selectedRevision.document.description }
                : {}),
              isDefault: false,
              publishedAt: selectedRevision.publishedAt,
            });
          }
          const query = normalizedText(input.query);
          const queryMatches = candidates.filter(
            (candidate) =>
              !query ||
              normalizedText(candidate.name).includes(query) ||
              normalizedText(candidate.description).includes(query),
          );
          const selected = candidates.filter(
            (candidate) =>
              candidate.brandKitRevisionId === options.selectedBrandRevisionId,
          );
          const matching = [
            ...new Map(
              [...selected, ...queryMatches].map((candidate) => [
                candidate.brandKitRevisionId,
                candidate,
              ]),
            ).values(),
          ];
          const fallback = Boolean(query) && queryMatches.length === 0;
          const source = fallback ? candidates : matching;
          const results = source
            .toSorted((left, right) => {
              const leftPriority = brandPriority(left, options);
              const rightPriority = brandPriority(right, options);
              return (
                leftPriority - rightPriority ||
                left.name.localeCompare(right.name) ||
                left.brandKitRevisionId.localeCompare(right.brandKitRevisionId)
              );
            })
            .slice(0, maximumResults)
            .map((candidate) =>
              Object.freeze({
                brandKitRevisionId: candidate.brandKitRevisionId,
                name: candidate.name,
                ...(candidate.description
                  ? { description: candidate.description }
                  : {}),
                revisionNumber: candidate.revisionNumber,
                isDefault: candidate.isDefault,
                selectedForRun:
                  candidate.brandKitRevisionId ===
                  options.selectedBrandRevisionId,
                boundToAgent: options.boundBrandKitIds.has(
                  candidate.brandKitId,
                ),
                publishedAt: candidate.publishedAt.toISOString(),
              }),
            );
          return Object.freeze({
            modelOutput: Object.freeze({
              ...(fallback
                ? { queryMatched: false, showingPublishedBrands: true }
                : {}),
              brands: Object.freeze(results),
              ...(source.length > results.length
                ? { truncated: true, totalResults: source.length }
                : {}),
            }),
            outcomeReference: {
              kind: "query" as const,
              resultCount: results.length,
            },
          });
        },
        () => "agent.brand_catalog_unavailable",
      );
    },
    inspectPublished: (value: BrandPublishedInspectToolInput) => {
      const input = inspectInput(value);
      return options.executeWithReceipt(
        "brand.inspect-published",
        input,
        async () => {
          const revision = await options.brands.getRevision(
            options.authority,
            undefined,
            input.brandKitRevisionId,
            options.now(),
          );
          if (!revision) {
            throw Object.assign(
              new Error("Published Brand revision is unavailable."),
              {
                code: "agent.brand_revision_unavailable",
                effect: "not_started",
              },
            );
          }
          return Object.freeze({
            modelOutput: Object.freeze({
              brand: Object.freeze({
                brandKitRevisionId: revision.id,
                revisionNumber: revision.revisionNumber,
                publishedAt: revision.publishedAt.toISOString(),
                document: revision.document,
                selectedForRun: revision.id === options.selectedBrandRevisionId,
                boundToAgent: options.boundBrandKitIds.has(revision.brandKitId),
              }),
            }),
            outcomeReference: { kind: "query" as const, resultCount: 1 },
          });
        },
        () => "agent.brand_read_failed",
      );
    },
  });
}
