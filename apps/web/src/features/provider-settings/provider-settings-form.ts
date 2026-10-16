import type { ProviderSettingPreset } from "@kanvas/contracts/api";

const MIN_PRINTABLE_ASCII_CODE_POINT = 32;
const DELETE_CONTROL_CODE_POINT = 127;
const API_KEY_MAX_LENGTH = 4_096;
const BASE_URL_MAX_LENGTH = 2_048;
const DISPLAY_NAME_MAX_LENGTH = 160;
const MODEL_KEY_LIMIT = 32;
const MODEL_KEY_MAX_LENGTH = 255;
const MODEL_IDENTIFIER_MAX_LENGTH = 160;
const modelIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/u;

export type ProviderCreateField =
  "displayName" | "baseUrl" | "apiKey" | "modelKeys";

export interface ProviderCreateFormValues {
  readonly preset: ProviderSettingPreset;
  readonly displayName: string;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly modelKeys?: string;
}

export type ProviderCreateFieldErrors = Partial<
  Readonly<Record<ProviderCreateField, string>>
>;

const providerCreateFieldOrder = Object.freeze([
  "displayName",
  "baseUrl",
  "apiKey",
  "modelKeys",
] as const satisfies readonly ProviderCreateField[]);

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0);
    return (
      codePoint !== undefined &&
      (codePoint < MIN_PRINTABLE_ASCII_CODE_POINT ||
        codePoint === DELETE_CONTROL_CODE_POINT)
    );
  });
}

export function providerApiKeyError(value: string): string | undefined {
  if (!value) {
    return "请输入 API Key。";
  }
  if (value !== value.trim()) {
    return "API Key 不能包含首尾空格。";
  }
  if (
    value.length > API_KEY_MAX_LENGTH ||
    containsControlCharacter(value) ||
    /[^\x21-\x7e]/u.test(value)
  ) {
    return "API Key 必须是 4096 个字符以内的可打印英文字符。";
  }
  return undefined;
}

export function providerModelIdentifierError(
  value: string,
): string | undefined {
  if (!value.trim()) return "请输入模型标识。";
  if (value !== value.trim()) return "模型标识不能包含首尾空格。";
  if (
    value.length > MODEL_IDENTIFIER_MAX_LENGTH ||
    !modelIdentifierPattern.test(value)
  ) {
    return "请使用英文字母、数字、点、下划线、斜杠或连字符，最多 160 个字符。";
  }
  return undefined;
}

export function parseProviderModelKeys(value: string): readonly string[] {
  return value
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean);
}

export function providerBaseUrlError(value: string): string | undefined {
  const normalized = value.trim();
  if (!normalized) {
    return "请输入模型服务地址。";
  }
  if (normalized.length > BASE_URL_MAX_LENGTH) {
    return "模型服务地址不能超过 2048 个字符。";
  }
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return "请输入完整的 HTTPS 模型服务地址。";
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return "服务地址必须使用 HTTPS，且不能包含账号、查询参数或片段。";
  }
  return undefined;
}

export function validateProviderCreateFields(
  values: ProviderCreateFormValues,
): ProviderCreateFieldErrors {
  const displayName = values.displayName.trim();
  const modelKeys = parseProviderModelKeys(values.modelKeys ?? "");
  const uniqueModelKeys = new Set(modelKeys);
  const baseUrlError =
    values.preset === "newapi"
      ? providerBaseUrlError(values.baseUrl)
      : undefined;
  const apiKeyError = providerApiKeyError(values.apiKey);
  let displayNameError: string | undefined;
  if (!displayName) {
    displayNameError = "请输入服务名称。";
  } else if (
    displayName.length > DISPLAY_NAME_MAX_LENGTH ||
    containsControlCharacter(displayName)
  ) {
    displayNameError = "服务名称不能超过 160 个字符或包含控制字符。";
  }
  let modelKeysError: string | undefined;
  if (modelKeys.length > MODEL_KEY_LIMIT) {
    modelKeysError = "一次最多配置 32 个模型 ID。";
  } else if (uniqueModelKeys.size !== modelKeys.length) {
    modelKeysError = "模型 ID 不能重复。";
  } else if (
    modelKeys.some(
      (value) =>
        value.length > MODEL_KEY_MAX_LENGTH || containsControlCharacter(value),
    )
  ) {
    modelKeysError = "每个模型 ID 不能超过 255 个字符或包含控制字符。";
  }
  return {
    ...(displayNameError ? { displayName: displayNameError } : {}),
    ...(baseUrlError ? { baseUrl: baseUrlError } : {}),
    ...(apiKeyError ? { apiKey: apiKeyError } : {}),
    ...(modelKeysError ? { modelKeys: modelKeysError } : {}),
  };
}

export function firstProviderCreateErrorField(
  errors: ProviderCreateFieldErrors,
): ProviderCreateField | undefined {
  return providerCreateFieldOrder.find((field) => Boolean(errors[field]));
}

export function clearProviderCreateFieldError(
  errors: ProviderCreateFieldErrors,
  field: ProviderCreateField,
): ProviderCreateFieldErrors {
  const next = { ...errors };
  delete next[field];
  return next;
}
