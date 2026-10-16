import type { ProviderSettingPreset } from "@kanvas/contracts/api";
import { getProviderDefinition } from "@kanvas/contracts/provider-definition";

export function ProviderLogo({
  preset,
  size = 20,
}: {
  readonly preset: ProviderSettingPreset;
  readonly size?: number;
}): React.JSX.Element | null {
  const logoPath = getProviderDefinition(preset).logoPath;
  return logoPath ? (
    <img
      alt=""
      aria-hidden="true"
      className="shrink-0 rounded-[5px] object-contain"
      height={size}
      src={logoPath}
      width={size}
    />
  ) : null;
}
