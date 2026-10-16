import zhCNLibraries from "./locales/zh-CN/libraries.json";
import enUSLibraries from "./locales/en-US/libraries.json";
import zhCNRuntimeConfiguration from "./locales/zh-CN/runtime-configuration.json";
import enUSRuntimeConfiguration from "./locales/en-US/runtime-configuration.json";
import enUSAssets from "./locales/en-US/assets.json";
import enUSAgent from "./locales/en-US/agent.json";
import enUSCanvas from "./locales/en-US/canvas.json";
import enUSBrand from "./locales/en-US/brand.json";
import enUSCommon from "./locales/en-US/common.json";
import enUSInstanceAccess from "./locales/en-US/instance-access.json";
import enUSOperations from "./locales/en-US/operations.json";
import enUSPublicEntry from "./locales/en-US/public-entry.json";
import enUSSettings from "./locales/en-US/settings.json";
import enUSStudio from "./locales/en-US/studio.json";
import enUSWorkflows from "./locales/en-US/workflows.json";
import zhCNAssets from "./locales/zh-CN/assets.json";
import zhCNAgent from "./locales/zh-CN/agent.json";
import zhCNCanvas from "./locales/zh-CN/canvas.json";
import zhCNBrand from "./locales/zh-CN/brand.json";
import zhCNCommon from "./locales/zh-CN/common.json";
import zhCNInstanceAccess from "./locales/zh-CN/instance-access.json";
import zhCNOperations from "./locales/zh-CN/operations.json";
import zhCNPublicEntry from "./locales/zh-CN/public-entry.json";
import zhCNSettings from "./locales/zh-CN/settings.json";
import zhCNStudio from "./locales/zh-CN/studio.json";
import zhCNWorkflows from "./locales/zh-CN/workflows.json";

export const supportedLocaleDefinitions = [
  {
    browserLanguage: "zh",
    labelKey: "common.appShell.account.languages.zh-CN",
    locale: "zh-CN",
  },
  {
    browserLanguage: "en",
    labelKey: "common.appShell.account.languages.en-US",
    locale: "en-US",
  },
] as const;

export type ProductLocale =
  (typeof supportedLocaleDefinitions)[number]["locale"];

export const supportedLocales: readonly ProductLocale[] =
  supportedLocaleDefinitions.map(({ locale }) => locale);

export const resources = {
  "zh-CN": {
    translation: {
      agent: zhCNAgent,
      common: zhCNCommon,
      instanceAccess: zhCNInstanceAccess,
      runtimeConfiguration: zhCNRuntimeConfiguration,
      operations: zhCNOperations,
      assets: zhCNAssets,
      brand: zhCNBrand,
      libraries: zhCNLibraries,
      canvas: zhCNCanvas,
      publicEntry: zhCNPublicEntry,
      settings: zhCNSettings,
      studio: zhCNStudio,
      workflows: zhCNWorkflows,
    },
  },
  "en-US": {
    translation: {
      agent: enUSAgent,
      common: enUSCommon,
      instanceAccess: enUSInstanceAccess,
      runtimeConfiguration: enUSRuntimeConfiguration,
      operations: enUSOperations,
      assets: enUSAssets,
      brand: enUSBrand,
      libraries: enUSLibraries,
      canvas: enUSCanvas,
      publicEntry: enUSPublicEntry,
      settings: enUSSettings,
      studio: enUSStudio,
      workflows: enUSWorkflows,
    },
  },
} as const;
