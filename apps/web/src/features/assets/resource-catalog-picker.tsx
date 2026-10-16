import {
  FileImageOutlined,
  LoadingOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import type { ResourceAdoptionResult } from "@kanvas/contracts/api";
import type { ResourceImageCandidate } from "@kanvas/contracts/resource-source";
import { useMutation, useQuery } from "@tanstack/react-query";
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

interface SubmittedSearch {
  readonly sourceId: string;
  readonly query: string;
}

export function resourceCatalogBrowseQuery(adapterKind: string): string {
  return adapterKind === "iconify.v1" ? "shape" : "background";
}

export function ResourceCatalogPicker({
  canEdit,
  csrfToken,
  onAdopt,
  onAdoptError,
  onPreview,
  workspaceId,
}: {
  readonly canEdit: boolean;
  readonly csrfToken: string;
  readonly onAdopt: (
    result: ResourceAdoptionResult,
    candidate: ResourceImageCandidate,
    previewId?: string,
  ) => Promise<void>;
  readonly onAdoptError: (previewId?: string) => void;
  readonly onPreview: (candidate: ResourceImageCandidate) => string | undefined;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const [selectedSourceId, setSelectedSourceId] = useState<string>();
  const [submitted, setSubmitted] = useState<SubmittedSearch>();
  const sources = useQuery({
    queryKey: ["resource-catalog-sources", workspaceId],
    queryFn: () => fetchResourceCatalogSources(workspaceId),
    retry: false,
  });
  const imageSources = useMemo(
    () =>
      (sources.data?.sources ?? [])
        .filter(
          (source) =>
            source.capabilities.includes("image.search") ||
            source.capabilities.includes("vector.search"),
        )
        .toSorted(
          (left, right) =>
            Number(right.capabilities.includes("image.search")) -
              Number(left.capabilities.includes("image.search")) ||
            left.displayName.localeCompare(right.displayName),
        ),
    [sources.data?.sources],
  );
  const activeSourceId = imageSources.some(
    (source) => source.id === selectedSourceId,
  )
    ? selectedSourceId
    : imageSources[0]?.id;
  const activeSource = imageSources.find(
    (source) => source.id === activeSourceId,
  );
  let effectiveSearch: SubmittedSearch | undefined;
  if (submitted?.sourceId === activeSource?.id) {
    effectiveSearch = submitted;
  } else if (activeSource) {
    effectiveSearch = {
      sourceId: activeSource.id,
      query: resourceCatalogBrowseQuery(activeSource.adapterKind),
    };
  }
  const results = useQuery({
    queryKey: [
      "resource-catalog-search",
      workspaceId,
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
  const imageCandidates = useMemo(
    () =>
      (results.data?.candidates ?? []).filter(
        (candidate): candidate is ResourceImageCandidate =>
          candidate.kind === "image" || candidate.kind === "vector",
      ),
    [results.data?.candidates],
  );
  const adopt = useMutation({
    mutationFn: async (candidate: ResourceImageCandidate) => {
      const previewId = onPreview(candidate);
      try {
        const result = await adoptResourceCatalogCandidate(
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
        );
        await onAdopt(result, candidate, previewId);
        return result;
      } catch (error) {
        onAdoptError(previewId);
        throw error;
      }
    },
  });

  function submit(event: FormEvent): void {
    event.preventDefault();
    if (!activeSource) return;
    const normalized = query.trim();
    const next = {
      sourceId: activeSource.id,
      query: normalized || resourceCatalogBrowseQuery(activeSource.adapterKind),
    };
    if (
      effectiveSearch?.sourceId === next.sourceId &&
      effectiveSearch.query === next.query
    ) {
      void results.refetch();
      return;
    }
    setSubmitted(next);
  }
  const changeSource = (value: unknown): void => {
    setQuery("");
    setSubmitted(undefined);
    setSelectedSourceId(String(value));
  };

  if (sources.isPending) {
    return (
      <div className="flex min-h-48 items-center justify-center gap-2 text-xs text-muted">
        <LoadingOutlined aria-hidden="true" spin />
        {t("canvas.assetPicker.externalLoading")}
      </div>
    );
  }
  if (sources.isError) {
    return (
      <div className="grid min-h-48 place-items-center text-center text-xs text-muted">
        <div className="grid gap-2">
          <FileImageOutlined aria-hidden="true" className="text-xl" />
          <span>{t("canvas.assetPicker.externalUnavailable")}</span>
          <Button onClick={() => void sources.refetch()} size="small">
            {t("canvas.assetPicker.retry")}
          </Button>
        </div>
      </div>
    );
  }
  if (imageSources.length === 0) {
    return (
      <div className="grid min-h-48 place-items-center text-center text-xs leading-5 text-muted">
        {t("canvas.assetPicker.noPublishedExternalSources")}
      </div>
    );
  }

  return (
    <div className="grid max-h-[calc(100dvh-240px)] min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <div className="relative z-[1] grid gap-2.5 bg-[var(--paper)] pb-3">
        <KanvasSelect
          aria-label={t("canvas.assetPicker.externalSource")}
          onChange={changeSource}
          options={imageSources.map((source) => ({
            label: source.displayName,
            value: source.id,
          }))}
          value={activeSourceId}
        />
        <form className="flex gap-2" onSubmit={submit}>
          <Input
            allowClear
            aria-label={t("canvas.assetPicker.searchExternal")}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("canvas.assetPicker.searchExternalPlaceholder")}
            prefix={<SearchOutlined aria-hidden="true" />}
            type="search"
            value={query}
            variant="filled"
          />
          <Button htmlType="submit" type="primary">
            {t("canvas.assetPicker.search")}
          </Button>
        </form>
      </div>
      <div className="min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain pr-1">
        {results.isFetching ? (
          <div className="grid min-h-40 place-items-center gap-2 text-xs text-muted">
            <LoadingOutlined aria-hidden="true" spin />
            {t("canvas.assetPicker.externalLoadingResults")}
          </div>
        ) : null}
        {results.isError ? (
          <p
            className="m-0 rounded-lg bg-red-50 p-2 text-xs text-red-700"
            role="alert"
          >
            {t("canvas.assetPicker.externalSearchError")}
          </p>
        ) : null}
        {effectiveSearch &&
        !results.isFetching &&
        !results.isError &&
        imageCandidates.length === 0 ? (
          <div className="grid min-h-40 place-items-center text-center text-xs text-muted">
            {t("canvas.assetPicker.noExternalResults")}
          </div>
        ) : null}
        {imageCandidates.length > 0 && !results.isFetching ? (
          <div className="grid grid-cols-2 gap-x-2 gap-y-3 pb-1">
            {imageCandidates.map((candidate) => (
              <article
                className="grid min-w-0 gap-1"
                key={candidate.externalId}
              >
                <button
                  aria-label={t("canvas.assetPicker.addExternal", {
                    name: candidate.title,
                  })}
                  className="group relative block aspect-square min-h-0 w-full overflow-hidden rounded-lg border border-line bg-mist p-0 disabled:cursor-wait"
                  disabled={!canEdit || adopt.isPending}
                  onClick={() => adopt.mutate(candidate)}
                  type="button"
                >
                  <img
                    alt=""
                    className={`absolute inset-0 size-full transition-transform group-hover:scale-[1.02] ${candidate.kind === "vector" ? "object-contain p-4" : "object-cover"}`}
                    loading="lazy"
                    src={candidate.preview.url}
                  />
                  {adopt.isPending &&
                  adopt.variables?.externalId === candidate.externalId ? (
                    <span className="absolute inset-0 grid place-items-center bg-black/40 text-white">
                      <LoadingOutlined aria-hidden="true" spin />
                    </span>
                  ) : null}
                </button>
                <strong
                  className="truncate px-0.5 text-xs"
                  title={candidate.title}
                >
                  {candidate.title}
                </strong>
              </article>
            ))}
          </div>
        ) : null}
        {adopt.isError ? (
          <p className="m-0 pt-2 text-xs text-red-700" role="alert">
            {t("canvas.assetPicker.externalImportError")}
          </p>
        ) : null}
      </div>
    </div>
  );
}
