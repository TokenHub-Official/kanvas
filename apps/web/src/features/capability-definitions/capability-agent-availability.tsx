import type { CapabilityAdminSummary } from "@kanvas/contracts/api";
import { useTranslation } from "react-i18next";

export function CapabilityAgentAvailability({
  availability,
}: {
  readonly availability: CapabilityAdminSummary["agentAvailability"];
}): React.JSX.Element | null {
  const { t } = useTranslation();
  if (!availability || availability.status === "ready") return null;
  return (
    <p role="status" className="m-0 text-sm text-warning">
      {t(
        `settings.capabilityDefinitions.agentAvailability.${availability.reason ?? "evaluation_failed"}`,
        {
          defaultValue: t(
            "settings.capabilityDefinitions.agentAvailability.unavailable",
          ),
        },
      )}
    </p>
  );
}
