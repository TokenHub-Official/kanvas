import { LoadingOutlined, SearchOutlined } from "@ant-design/icons";
import type { ResourceAdoptionResult } from "@kanvas/contracts/api";
import type {
  ResourceArtTextCandidate,
  ResourceCandidate,
  ResourceFontCandidate,
} from "@kanvas/contracts/resource-source";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Input } from "antd";
import { useMemo, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";

import {
  adoptResourceCatalogCandidate,
  fetchResourceCatalogSources,
  searchResourceCatalog,
} from "../../api/transport.js";
import { KanvasSelect } from "../../components/kanvas-select.js";
import { resourceAdoptionIdempotencyKey } from "./resource-adoption-key.js";

type TextResourceKind = "art_text" | "font";

interface SubmittedTextSearch {
  readonly sourceId: string;
  readonly query: string;
}

function isTextCandidate(
  candidate: ResourceCandidate,
  kind: TextResourceKind,
): candidate is ResourceArtTextCandidate | ResourceFontCandidate {
  return candidate.kind === kind;
}

export function ResourceCatalogTextPicker({
  canEdit,
  csrfToken,
  kind,
  onAdopt,
  workspaceId,
}: {
  readonly canEdit: boolean;
  readonly csrfToken: string;
  readonly kind: TextResourceKind;
  readonly onAdopt: (
    result: ResourceAdoptionResult,
    candidate: ResourceArtTextCandidate | ResourceFontCandidate,
  ) => Promise<void>;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState<SubmittedTextSearch>();
  const [selectedSourceId, setSelectedSourceId] = useState<string>();
  const capability = kind === "font" ? "font.list" : "art_text.list";
  const sources = useQuery({
    queryKey: ["resource-catalog-sources", workspaceId],
    queryFn: () => fetchResourceCatalogSources(workspaceId),
    retry: false,
  });
  const availableSources = useMemo(
    () =>
      (sources.data?.sources ?? []).filter((source) =>
        source.capabilities.includes(capability),
      ),
    [capability, sources.data?.sources],
  );
  const activeSourceId = availableSources.some(
    (source) => source.id === selectedSourceId,
  )
    ? selectedSourceId
    : availableSources[0]?.id;
  let effectiveSearch: SubmittedTextSearch | undefined;
  if (submitted?.sourceId === activeSourceId) {
    effectiveSearch = submitted;
  } else if (activeSourceId) {
    effectiveSearch = { sourceId: activeSourceId, query: "" };
  }
  const results = useQuery({
    queryKey: [
      "resource-catalog-text-search",
      workspaceId,
      kind,
      effectiveSearch?.sourceId,
      effectiveSearch?.query,
    ],
    queryFn: () =>
      searchResourceCatalog(workspaceId, {
        sourceId: effectiveSearch!.sourceId,
        query: effectiveSearch!.query,
        limit: 24,
      }),
    enabled: Boolean(effectiveSearch),
    retry: false,
  });
  const candidates = useMemo(
    () =>
      (results.data?.candidates ?? []).filter((candidate) =>
        isTextCandidate(candidate, kind),
      ),
    [kind, results.data?.candidates],
  );
  const adopt = useMutation({
    mutationFn: async (
      candidate: ResourceArtTextCandidate | ResourceFontCandidate,
    ) =>
      adoptResourceCatalogCandidate(
        { csrfToken, workspaceId },
        {
          schemaVersion: 1,
          sourceInstanceId: candidate.sourceInstanceId,
          sourceRevisionId: candidate.sourceRevisionId,
          candidateKind: candidate.kind,
          externalId: candidate.externalId,
          expectedTermsDigest: candidate.license.termsDigest,
          displayName: candidate.title,
        },
        await resourceAdoptionIdempotencyKey(candidate),
      ),
    onSuccess: async (result, candidate) => {
      await onAdopt(result, candidate);
      await queryClient.invalidateQueries({
        queryKey: [
          kind === "font"
            ? "workspace-font-catalog"
            : "workspace-art-text-catalog",
          workspaceId,
        ],
      });
    },
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (activeSourceId) {
      const next = { sourceId: activeSourceId, query: query.trim() };
      if (
        effectiveSearch?.sourceId === next.sourceId &&
        effectiveSearch.query === next.query
      ) {
        void results.refetch();
        return;
      }
      setSubmitted(next);
    }
  }

  if (sources.isPending) {
    return (
      <div className="flex min-h-28 items-center justify-center gap-2 text-xs text-[var(--muted)]">
        <LoadingOutlined aria-hidden="true" spin />
        {t("canvas.resourceCatalog.loading")}
      </div>
    );
  }
  if (sources.isError) {
    return (
      <div className="grid gap-2 rounded-lg bg-red-50 p-3 text-xs text-red-700">
        <span>{t("canvas.resourceCatalog.sourceLoadFailed")}</span>
        <Button onClick={() => void sources.refetch()} size="small">
          {t("canvas.assetPicker.retry")}
        </Button>
      </div>
    );
  }
  if (availableSources.length === 0) {
    return (
      <p className="rounded-lg bg-[#f7f7f8] p-3 text-xs text-[var(--muted)]">
        {t("canvas.resourceCatalog.noTextSource")}
      </p>
    );
  }

  return (
    <div className="grid max-h-[calc(100dvh-240px)] min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <div className="relative z-[1] grid gap-2 bg-[var(--paper)] pb-3">
        <KanvasSelect
          aria-label={t("canvas.resourceCatalog.source")}
          onChange={(value) => {
            setQuery("");
            setSubmitted(undefined);
            setSelectedSourceId(String(value));
          }}
          options={availableSources.map((source) => ({
            label: source.displayName,
            value: source.id,
          }))}
          value={activeSourceId}
        />
        <form className="flex gap-2" onSubmit={submit}>
          <Input
            allowClear
            aria-label={t("canvas.resourceCatalog.searchPlaceholder")}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("canvas.resourceCatalog.searchPlaceholder")}
            prefix={<SearchOutlined aria-hidden="true" />}
            value={query}
          />
          <Button htmlType="submit">
            {t("canvas.resourceCatalog.search")}
          </Button>
        </form>
      </div>
      <div className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain pr-1">
        {results.isFetching ? (
          <div className="py-6 text-center text-xs text-[var(--muted)]">
            <LoadingOutlined aria-hidden="true" spin />
          </div>
        ) : null}
        {results.isError ? (
          <p className="m-0 text-xs text-red-600">
            {t("canvas.resourceCatalog.searchFailed")}
          </p>
        ) : null}
        {!results.isFetching && !results.isError && candidates.length === 0 ? (
          <p className="m-0 py-6 text-center text-xs text-[var(--muted)]">
            {t("canvas.resourceCatalog.noResults")}
          </p>
        ) : null}
        <div className="grid gap-1 pb-1">
          {candidates.map((candidate) => (
            <div
              className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg bg-[#f7f7f8] p-2"
              key={`${candidate.sourceRevisionId}:${candidate.externalId}`}
            >
              <span
                className="min-w-0 truncate text-sm"
                style={
                  candidate.kind === "art_text"
                    ? {
                        color:
                          candidate.manifest.fill.kind === "solid"
                            ? candidate.manifest.fill.color
                            : undefined,
                        letterSpacing: candidate.manifest.letterSpacing,
                      }
                    : undefined
                }
              >
                {candidate.kind === "font" ? candidate.family : candidate.title}
              </span>
              <Button
                disabled={!canEdit || adopt.isPending}
                loading={
                  adopt.isPending &&
                  adopt.variables?.externalId === candidate.externalId
                }
                onClick={() => adopt.mutate(candidate)}
                size="small"
                type="primary"
              >
                {t("canvas.resourceCatalog.add")}
              </Button>
            </div>
          ))}
        </div>
        {adopt.isError ? (
          <p className="text-xs text-red-600">
            {t("canvas.resourceCatalog.adoptFailed")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
