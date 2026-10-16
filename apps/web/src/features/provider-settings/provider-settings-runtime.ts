import { ApiProblem } from "../../api/transport.js";
import { i18n } from "../../i18n/i18n.js";

const HTTP_BAD_REQUEST = 400;
const HTTP_FORBIDDEN = 403;
const HTTP_CONFLICT = 409;
const HTTP_SERVICE_UNAVAILABLE = 503;
const HTTP_SERVER_ERROR = 500;

export function providerSettingsError(error: unknown): string {
  if (!(error instanceof ApiProblem)) {
    return i18n.t("settings.providers.errors.generic");
  }
  if (error.code === "provider_settings.policy_not_initialized") {
    return i18n.t("settings.providers.errors.policyNotInitialized");
  }
  if (error.status === HTTP_CONFLICT) {
    return i18n.t("settings.providers.errors.conflict");
  }
  if (error.status === HTTP_BAD_REQUEST) {
    return i18n.t("settings.providers.errors.invalid");
  }
  if (error.status === HTTP_FORBIDDEN) {
    return i18n.t("settings.providers.errors.forbidden");
  }
  if (error.status === HTTP_SERVICE_UNAVAILABLE) {
    return i18n.t("settings.providers.errors.unavailable");
  }
  if (error.status >= HTTP_SERVER_ERROR) {
    return i18n.t("settings.providers.errors.generic");
  }
  return i18n.t("settings.providers.errors.generic");
}

export function createProviderOperationKey(): string {
  return `provider-setting-${crypto.randomUUID()}`;
}
