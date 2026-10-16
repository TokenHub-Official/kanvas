import { describe, expect, it } from "vitest";

import { loadDatabaseConnectionConfig } from "../src/index.js";

describe("database deployment config", () => {
  it("uses ordinary connection defaults for empty optional tuning", () => {
    const environment = {
      KANVAS_DATABASE_HOST: "db.example",
      KANVAS_DATABASE_NAME: "kanvas",
      KANVAS_DATABASE_USER: "fixture",
      KANVAS_DATABASE_PASSWORD: "fixture",
    };
    expect(
      loadDatabaseConnectionConfig({
        ...environment,
        KANVAS_DATABASE_PORT: " ",
        KANVAS_DATABASE_CONNECTION_LIMIT: "",
      }),
    ).toEqual(loadDatabaseConnectionConfig(environment));
  });

  it("decodes URL credentials without leaking invalid input", () => {
    expect(
      loadDatabaseConnectionConfig({
        KANVAS_DATABASE_URL:
          "mysql://user:p%40ss%3Aword@db.example:3307/kanvas_test",
      }),
    ).toMatchObject({
      host: "db.example",
      port: 3307,
      user: "user",
      password: "p@ss:word",
      database: "kanvas_test",
    });
    expect(
      loadDatabaseConnectionConfig({
        KANVAS_DATABASE_URL: "mysql://user:secret@host/db?ssl=true",
      }),
    ).toMatchObject({ ssl: { rejectUnauthorized: true } });
    expect(() =>
      loadDatabaseConnectionConfig({
        KANVAS_DATABASE_URL: "mysql://user:secret@host/db?ssl=false",
      }),
    ).toThrow(/Invalid KANVAS_DATABASE_URL/u);
    expect(() =>
      loadDatabaseConnectionConfig({
        KANVAS_DATABASE_URL: "mysql://user:secret@host/db",
        KANVAS_DATABASE_HOST: "other",
      }),
    ).toThrow(/Do not combine/u);
  });
  it("loads an explicit direct secret for test composition", () => {
    expect(
      loadDatabaseConnectionConfig({
        KANVAS_DATABASE_HOST: "127.0.0.1",
        KANVAS_DATABASE_NAME: "kanvas",
        KANVAS_DATABASE_USER: "kanvas",
        KANVAS_DATABASE_PASSWORD: "test-only",
      }),
    ).toMatchObject({
      host: "127.0.0.1",
      port: 3306,
      database: "kanvas",
      user: "kanvas",
      connectionLimit: 10,
    });
  });

  it("rejects ambiguous password sources", () => {
    expect(() =>
      loadDatabaseConnectionConfig({
        KANVAS_DATABASE_HOST: "127.0.0.1",
        KANVAS_DATABASE_NAME: "kanvas",
        KANVAS_DATABASE_USER: "kanvas",
        KANVAS_DATABASE_PASSWORD: "direct",
        KANVAS_DATABASE_PASSWORD_FILE: "/run/secrets/mysql_password",
      }),
    ).toThrow(/only one/u);
  });
});
