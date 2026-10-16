import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";

export interface ProviderSecretFileMaps {
  readonly deploymentSecretFiles: Readonly<Record<string, string>>;
  readonly kekValues?: Readonly<Record<string, string>>;
  readonly kekFiles: Readonly<Record<string, string>>;
}

function parsePathMap(
  file: string | undefined,
  name: string,
  keyPattern: RegExp,
): Readonly<Record<string, string>> {
  if (!file?.trim()) {
    return Object.freeze(Object.create(null) as Record<string, string>);
  }
  const mapFile = file.trim();
  if (!isAbsolute(mapFile)) {
    throw new Error(`${name} must be an absolute path.`);
  }
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(mapFile, "utf8")) as unknown;
  } catch (error) {
    throw new Error(`${name} must contain valid JSON.`, {
      cause: error,
    });
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} must contain a JSON object.`);
  }
  const result = Object.create(null) as Record<string, string>;
  for (const [key, path] of Object.entries(value)) {
    if (
      !keyPattern.test(key) ||
      typeof path !== "string" ||
      !isAbsolute(path) ||
      path !== path.trim() ||
      path.includes("\0")
    ) {
      throw new Error(
        `${name} contains an invalid key or mounted secret path.`,
      );
    }
    result[key] = path;
  }
  return Object.freeze(result);
}

export function loadProviderSecretFileMaps(
  environment: NodeJS.ProcessEnv,
): ProviderSecretFileMaps {
  const kekValues = Object.create(null) as Record<string, string>;
  if (environment.KANVAS_PROVIDER_KEK_MAP_JSON) {
    if (environment.KANVAS_PROVIDER_KEK_MAP_FILE)
      throw new Error("Set only one Provider KEK map source.");
    try {
      const value: unknown = JSON.parse(
        environment.KANVAS_PROVIDER_KEK_MAP_JSON,
      );
      if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error();
      for (const [version, key] of Object.entries(value)) {
        if (
          !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/u.test(version) ||
          typeof key !== "string" ||
          !/^[A-Za-z0-9+/]{43}=$/u.test(key) ||
          Buffer.from(key, "base64").byteLength !== 32
        )
          throw new Error();
        kekValues[version] = key;
      }
    } catch {
      throw new Error(
        "Invalid KANVAS_PROVIDER_KEK_MAP_JSON; expected version to base64 256-bit key map.",
      );
    }
  }
  return Object.freeze({
    kekValues: Object.freeze(kekValues),
    deploymentSecretFiles: parsePathMap(
      environment.KANVAS_PROVIDER_DEPLOYMENT_SECRET_MAP_FILE,
      "KANVAS_PROVIDER_DEPLOYMENT_SECRET_MAP_FILE",
      /^deployment:\/\/[A-Za-z0-9][A-Za-z0-9._/-]{0,222}$/u,
    ),
    kekFiles: parsePathMap(
      environment.KANVAS_PROVIDER_KEK_MAP_FILE,
      "KANVAS_PROVIDER_KEK_MAP_FILE",
      /^[A-Za-z0-9][A-Za-z0-9._/-]{0,159}$/u,
    ),
  });
}
