import type { WorkspaceFontRevision } from "@kanvas/contracts/resource-source";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  downloadArtifact,
  fetchWorkspaceFontCatalog,
} from "../../api/transport.js";
import {
  canvasFontCatalogV1,
  type CanvasFontCategoryV1,
  type CanvasFontDefinitionV1,
} from "./font-catalog-v1.js";

const emptyFontRevisions: readonly WorkspaceFontRevision[] = Object.freeze([]);

function canvasCategory(
  category: WorkspaceFontRevision["category"],
): CanvasFontCategoryV1 {
  return category === "monospace" || category === "other" ? "sans" : category;
}

export function workspaceCanvasFontDefinitionsV1(
  revisions: readonly WorkspaceFontRevision[],
): readonly CanvasFontDefinitionV1[] {
  return revisions.map((revision) => ({
    category: canvasCategory(revision.category),
    family: revision.family,
    id: revision.id,
    label: revision.family,
    languages: revision.languages,
    license: revision.license.licenseId,
    revision: revision.id,
    scripts: revision.scripts,
    source: "workspace",
    weights: [...new Set(revision.files.map((file) => file.weight))].toSorted(
      (left, right) => left - right,
    ),
  }));
}

export function useCanvasFontResources(workspaceId: string): {
  readonly fonts: readonly CanvasFontDefinitionV1[];
  readonly isError: boolean;
  readonly isPending: boolean;
} {
  const catalog = useQuery({
    queryKey: ["workspace-font-catalog", workspaceId],
    queryFn: () => fetchWorkspaceFontCatalog(workspaceId),
    retry: false,
  });
  const [loadedRevisionIds, setLoadedRevisionIds] = useState<
    ReadonlySet<string>
  >(() => new Set());
  const [loadError, setLoadError] = useState(false);
  const [loadPending, setLoadPending] = useState(false);
  const revisions = catalog.data?.fonts ?? emptyFontRevisions;
  const workspaceFonts = useMemo(() => {
    const definitions = workspaceCanvasFontDefinitionsV1(revisions);
    return definitions.filter((font) => loadedRevisionIds.has(font.revision));
  }, [loadedRevisionIds, revisions]);
  const fonts = useMemo(
    () => [...workspaceFonts, ...canvasFontCatalogV1],
    [workspaceFonts],
  );

  useEffect(() => {
    const controller = new AbortController();
    const loadedFaces: FontFace[] = [];
    const objectUrls: string[] = [];
    if (revisions.length === 0) {
      setLoadedRevisionIds(new Set());
      setLoadError(false);
      setLoadPending(false);
      return () => controller.abort();
    }
    setLoadedRevisionIds(new Set());
    setLoadError(false);
    setLoadPending(true);

    async function load(): Promise<void> {
      const outcomes = await Promise.all(
        revisions.map(async (revision) => {
          const files = await Promise.allSettled(
            revision.files.map(async (file) => {
              const blob = await downloadArtifact(
                workspaceId,
                file.artifactId,
                fetch,
                controller.signal,
              );
              if (controller.signal.aborted) return;
              const url = URL.createObjectURL(blob);
              objectUrls.push(url);
              const face = new FontFace(revision.family, `url(${url})`, {
                style: file.style,
                weight: String(file.weight),
              });
              await face.load();
              if (controller.signal.aborted) return;
              document.fonts.add(face);
              loadedFaces.push(face);
            }),
          );
          return {
            id: revision.id,
            loaded: files.some((file) => file.status === "fulfilled"),
            failed: files.some((file) => file.status === "rejected"),
          };
        }),
      );
      if (controller.signal.aborted) return;
      setLoadedRevisionIds(
        new Set(outcomes.filter((item) => item.loaded).map((item) => item.id)),
      );
      setLoadError(outcomes.some((item) => item.failed));
      setLoadPending(false);
    }

    void load();
    return () => {
      controller.abort();
      for (const face of loadedFaces) document.fonts.delete(face);
      for (const url of objectUrls) URL.revokeObjectURL(url);
    };
  }, [revisions, workspaceId]);

  return {
    fonts,
    isError: catalog.isError || loadError,
    isPending: catalog.isPending || loadPending,
  };
}
