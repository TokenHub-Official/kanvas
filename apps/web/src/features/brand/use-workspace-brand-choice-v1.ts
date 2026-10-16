import type { BrandKitSummary } from "@kanvas/contracts/api";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { fetchBrandKits } from "../../api/transport.js";

export const workspaceDefaultBrandChoiceV1 = "workspace-default";
export const withoutBrandChoiceV1 = "without-brand";

export type WorkspaceBrandChoiceV1 =
  | typeof workspaceDefaultBrandChoiceV1
  | typeof withoutBrandChoiceV1
  | `brand:${string}`;

export interface WorkspaceBrandLaunchSelectionV1 {
  readonly brand?: BrandKitSummary;
  readonly brandKitRevisionId?: string;
  readonly withoutBrand: boolean;
}

function publishedBrandsV1(
  brands: readonly BrandKitSummary[],
): readonly BrandKitSummary[] {
  return brands.filter((brand) => Boolean(brand.latestPublishedRevision));
}

export function resolveWorkspaceBrandChoiceV1(
  brands: readonly BrandKitSummary[],
  choice: WorkspaceBrandChoiceV1,
) {
  const published = publishedBrandsV1(brands);
  const defaultBrand = published.find((brand) => brand.isDefault);
  const explicitlySelectedBrand = choice.startsWith("brand:")
    ? published.find(
        (brand) => workspaceBrandChoiceValueV1(brand.id) === choice,
      )
    : undefined;
  const selectedBrand =
    choice === workspaceDefaultBrandChoiceV1
      ? defaultBrand
      : explicitlySelectedBrand;
  const selection: WorkspaceBrandLaunchSelectionV1 =
    selectedBrand?.latestPublishedRevision
      ? {
          brand: selectedBrand,
          brandKitRevisionId: selectedBrand.latestPublishedRevision.id,
          withoutBrand: false,
        }
      : { withoutBrand: true };
  return {
    defaultBrand,
    publishedBrands: published,
    resolvedChoice: selectedBrand
      ? workspaceBrandChoiceValueV1(selectedBrand.id)
      : withoutBrandChoiceV1,
    selectedBrand,
    selection,
  } as const;
}

export function workspaceBrandChoiceValueV1(
  brandKitId: string,
): WorkspaceBrandChoiceV1 {
  return `brand:${brandKitId}`;
}

export function useWorkspaceBrandChoiceV1({
  canReadBrand,
  initialBrandKitId,
  preferredBrandKitId,
  workspaceId,
}: {
  readonly canReadBrand: boolean;
  readonly initialBrandKitId?: string | null;
  readonly preferredBrandKitId?: string;
  readonly workspaceId: string;
}) {
  const [choice, setChoice] = useState<WorkspaceBrandChoiceV1>(() => {
    if (initialBrandKitId === null) return withoutBrandChoiceV1;
    if (initialBrandKitId) {
      return workspaceBrandChoiceValueV1(initialBrandKitId);
    }
    return workspaceDefaultBrandChoiceV1;
  });
  const brands = useQuery({
    queryKey: ["brand-kits", workspaceId, "active"],
    queryFn: () => fetchBrandKits(workspaceId, { lifecycleStatus: "active" }),
    enabled: canReadBrand,
    retry: false,
    staleTime: 30_000,
  });
  const effectiveChoice =
    choice === workspaceDefaultBrandChoiceV1 && preferredBrandKitId
      ? workspaceBrandChoiceValueV1(preferredBrandKitId)
      : choice;
  const resolved = resolveWorkspaceBrandChoiceV1(
    brands.data?.items ?? [],
    effectiveChoice,
  );

  return {
    brands,
    choice,
    ...resolved,
    setChoice,
  } as const;
}
