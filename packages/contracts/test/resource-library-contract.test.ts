import { describe, expect, it } from "vitest";
import { Value } from "@sinclair/typebox/value";
import {
  LibraryUploadQuerySchema,
  SaveLibraryBodySchema,
  resourceLibraryRoutes,
  routeRegistry,
} from "../src/api/index.js";

describe("Resource library contracts", () => {
  it("registers all owner-scoped routes and requires idempotency for content mutations", () => {
    for (const route of resourceLibraryRoutes) {
      expect(routeRegistry).toContain(route);
      expect(route.path).toContain(
        "/workspaces/{workspaceId}/resource-libraries",
      );
      expect(route.security).toEqual(["browserSession"]);
    }
    expect(
      resourceLibraryRoutes
        .filter((route) => ["PUT", "POST"].includes(route.method))
        .every((route) => route.idempotency === "required"),
    ).toBe(true);
  });
  it("does not let callers set physical storage facts or accept unsupported documents", () => {
    const body = {
      expectedVersion: 0,
      document: {
        schemaVersion: 1,
        name: "Product",
        description: "",
        entries: [],
      },
    };
    expect(Value.Check(SaveLibraryBodySchema, body)).toBe(true);
    expect(
      Value.Check(SaveLibraryBodySchema, { ...body, workspaceId: "spoof" }),
    ).toBe(false);
    const query = {
      filename: "facts.txt",
      mediaType: "text/plain",
      byteSize: "8",
      sha256: "a".repeat(64),
    };
    expect(Value.Check(LibraryUploadQuerySchema, query)).toBe(true);
    expect(
      Value.Check(LibraryUploadQuerySchema, {
        ...query,
        mediaType: "application/zip",
      }),
    ).toBe(false);
    expect(
      Value.Check(LibraryUploadQuerySchema, {
        ...query,
        mediaType: "application/pdf",
      }),
    ).toBe(true);
    expect(
      Value.Check(LibraryUploadQuerySchema, {
        ...query,
        mediaType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toBe(true);
    expect(
      Value.Check(LibraryUploadQuerySchema, { ...query, objectKey: "unsafe" }),
    ).toBe(false);
  });
});
