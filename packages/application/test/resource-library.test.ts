import { describe, expect, it } from "vitest";
import { normalizeResourceLibraryDocument } from "../src/modules/resource-library/index.js";
import {
  permissionsForWorkspaceRole,
  servicePermissionAllowlist,
} from "../src/modules/authorization/index.js";

const id = (value: number) => `01K${String(value).padStart(23, "0")}`;
const entry = {
  id: id(1),
  name: " Product image ",
  purpose: " Shape reference ",
  artifactId: id(2),
};

describe("Resource Library document", () => {
  it("rejects malformed persisted documents at the module interface", () => {
    for (const value of [
      null,
      [],
      {},
      { schemaVersion: 1, name: "A", description: "", entries: [null] },
      { schemaVersion: 1, name: 42, description: "", entries: [] },
    ]) {
      expect(() => normalizeResourceLibraryDocument(value)).toThrow();
    }
  });
  it("preserves ordered exact references and normalizes presentation text", () => {
    const result = normalizeResourceLibraryDocument({
      schemaVersion: 1,
      name: " Product A ",
      description: " Specs ",
      entries: [entry, { ...entry, id: id(3), sourceAssetId: id(4) }],
    });
    expect(result.name).toBe("Product A");
    expect(result.entries.map((item) => item.id)).toEqual([id(1), id(3)]);
    expect(result.entries[0]).toEqual({
      ...entry,
      name: "Product image",
      purpose: "Shape reference",
    });
    expect(Object.isFrozen(result.entries)).toBe(true);
  });
  it("rejects duplicate identities and invalid cross-object references", () => {
    for (const entries of [
      [entry, entry],
      [{ ...entry, artifactId: "invalid" }],
      [{ ...entry, sourceAssetId: "invalid" }],
    ]) {
      expect(() =>
        normalizeResourceLibraryDocument({
          schemaVersion: 1,
          name: "Product",
          description: "",
          entries,
        }),
      ).toThrow();
    }
  });
  it("rejects excessive catalogs and empty names", () => {
    expect(() =>
      normalizeResourceLibraryDocument({
        schemaVersion: 1,
        name: " ",
        description: "",
        entries: [],
      }),
    ).toThrow();
    expect(() =>
      normalizeResourceLibraryDocument({
        schemaVersion: 1,
        name: "Product",
        description: "",
        entries: Array.from({ length: 201 }, (_, i) => ({
          ...entry,
          id: id(i + 10),
        })),
      }),
    ).toThrow();
  });
  it("separates shared reading from management and automation", () => {
    for (const role of [
      "owner",
      "admin",
      "editor",
      "operator",
      "reviewer",
      "viewer",
    ] as const) {
      expect(permissionsForWorkspaceRole(role)).toContain("library.read");
    }
    expect(permissionsForWorkspaceRole("editor")).toContain("library.manage");
    expect(permissionsForWorkspaceRole("operator")).not.toContain(
      "library.manage",
    );
    expect(servicePermissionAllowlist).toContain("library.read");
    expect(servicePermissionAllowlist).not.toContain("library.manage");
  });
});
