import { readFileSync } from "node:fs";

export interface DatabaseConnectionConfig {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  readonly user: string;
  readonly password: string;
  readonly connectionLimit: number;
  readonly ssl?: {
    readonly rejectUnauthorized: true;
    readonly verifyIdentity: true;
    readonly ca?: string;
  };
}

function required(environment: NodeJS.ProcessEnv, name: string): string {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Missing required deployment configuration: ${name}`);
  }
  return value;
}

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (!value?.trim()) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function loadPassword(environment: NodeJS.ProcessEnv): string {
  const direct = environment.KANVAS_DATABASE_PASSWORD;
  const file = environment.KANVAS_DATABASE_PASSWORD_FILE;
  if (direct && file) {
    throw new Error(
      "Set only one of KANVAS_DATABASE_PASSWORD or KANVAS_DATABASE_PASSWORD_FILE.",
    );
  }
  if (file) {
    const value = readFileSync(file, "utf8").trim();
    if (!value) {
      throw new Error("KANVAS_DATABASE_PASSWORD_FILE is empty.");
    }
    return value;
  }
  if (direct) {
    return direct;
  }
  throw new Error(
    "Missing KANVAS_DATABASE_PASSWORD_FILE deployment secret reference.",
  );
}

export function loadDatabaseConnectionConfig(
  environment: NodeJS.ProcessEnv,
): DatabaseConnectionConfig {
  if (environment.KANVAS_DATABASE_URL) {
    if (
      [
        "KANVAS_DATABASE_HOST",
        "KANVAS_DATABASE_PORT",
        "KANVAS_DATABASE_NAME",
        "KANVAS_DATABASE_USER",
        "KANVAS_DATABASE_PASSWORD",
        "KANVAS_DATABASE_PASSWORD_FILE",
      ].some((key) => environment[key] !== undefined)
    )
      throw new Error(
        "Do not combine KANVAS_DATABASE_URL with split connection fields.",
      );
    try {
      const url = new URL(environment.KANVAS_DATABASE_URL);
      const database = decodeURIComponent(url.pathname.slice(1));
      if (
        url.protocol !== "mysql:" ||
        !url.hostname ||
        !url.username ||
        !database ||
        database.includes("/") ||
        [...url.searchParams.keys()].some((key) => key !== "ssl") ||
        url.searchParams.getAll("ssl").length > 1 ||
        (url.searchParams.has("ssl") &&
          url.searchParams.get("ssl") !== "true") ||
        url.hash
      )
        throw new Error();
      return Object.freeze({
        host: url.hostname.replace(/^\[|\]$/gu, ""),
        port: positiveInteger(url.port, 3306, "KANVAS_DATABASE_PORT"),
        database,
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        connectionLimit: positiveInteger(
          environment.KANVAS_DATABASE_CONNECTION_LIMIT,
          10,
          "KANVAS_DATABASE_CONNECTION_LIMIT",
        ),
        ...loadDatabaseTls(environment, url.searchParams.get("ssl") === "true"),
      });
    } catch {
      throw new Error(
        "Invalid KANVAS_DATABASE_URL or TLS configuration; expected mysql://user:password@host:port/database with optional ?ssl=true and no fragment.",
      );
    }
  }
  return Object.freeze({
    host: required(environment, "KANVAS_DATABASE_HOST"),
    port: positiveInteger(
      environment.KANVAS_DATABASE_PORT,
      3306,
      "KANVAS_DATABASE_PORT",
    ),
    database: required(environment, "KANVAS_DATABASE_NAME"),
    user: required(environment, "KANVAS_DATABASE_USER"),
    password: loadPassword(environment),
    connectionLimit: positiveInteger(
      environment.KANVAS_DATABASE_CONNECTION_LIMIT,
      10,
      "KANVAS_DATABASE_CONNECTION_LIMIT",
    ),
    ...loadDatabaseTls(environment, false),
  });
}

function loadDatabaseTls(
  environment: NodeJS.ProcessEnv,
  enabled: boolean,
): Pick<DatabaseConnectionConfig, "ssl"> {
  const caPath = environment.KANVAS_DATABASE_SSL_CA_FILE;
  if (!enabled && !caPath) return {};
  const ca = caPath ? readFileSync(caPath, "utf8") : undefined;
  if (ca !== undefined && !ca.trim())
    throw new Error("Database CA file is empty.");
  return {
    ssl: {
      rejectUnauthorized: true,
      verifyIdentity: true,
      ...(ca ? { ca } : {}),
    },
  };
}
