import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { browserBackgroundRemoveRuntimeConfigFromManifest } from "./browser-background-remove-runtime-config.js";

describe("Browser background-removal release admission", () => {
  it("keeps ONNX execution outside the disabled Canvas path", () => {
    const source = readFileSync(
      new URL("./browser-background-remove-runtime-config.ts", import.meta.url),
      "utf8",
    );

    expect(source).not.toContain("onnxruntime-web");
    expect(source).not.toContain("u2net-browser-background-remove.js");
  });

  it("keeps one U2Net Worker and model session for the Canvas runtime lifetime", () => {
    const clientSource = readFileSync(
      new URL(
        "./u2net-browser-background-remove-worker-client.ts",
        import.meta.url,
      ),
      "utf8",
    );
    const workerSource = readFileSync(
      new URL("./u2net-background-remove.worker.ts", import.meta.url),
      "utf8",
    );

    expect(clientSource).toContain("dispose(): void");
    expect(clientSource).not.toContain(
      "worker.terminate();\n        };\n        const abort",
    );
    expect(workerSource).toContain("let remover:");
    expect(workerSource).toContain("configurationIdentity");
  });

  it("projects a server-pinned storage model without exposing its object identity", () => {
    const capability = {
      capabilityKey: "image.background.remove",
      implementationRevisionId: "01K00000000000000000000012",
      implementationDigest: `sha256:${"b".repeat(64)}`,
      runtimeAdapterRevisionId: "01K00000000000000000000013",
      runtimeAdapterRevisionDigest: `sha256:${"e".repeat(64)}`,
      adapterKey: "first-party.image.background-remove.isnet.browser.v1",
      runtimeRole: "background_remove",
      runtimeProfileKind: "browser.u2net.v1",
      runtimeProfileVersion: 1,
      runtimeProfileSettings: {
        backend: "wasm",
        role: "background_remove",
      },
      implementationConfiguration: {
        model: {
          family: "isnet",
          sha256: "d".repeat(64),
          variant: "isnet-general-fp16",
          inputSize: 1024,
          normalization: "isnet",
        },
        wasmPaths: "/onnxruntime/",
      },
      modelResource: {
        revisionId: "01K00000000000000000000011",
        revisionDigest: `sha256:${"a".repeat(64)}`,
        contentUrl:
          "/api/v1/model-resource-revisions/01K00000000000000000000011/content",
        contentDigest: `sha256:${"d".repeat(64)}`,
        format: "onnx" as const,
        family: "isnet",
        variant: "isnet-general-fp16",
      },
      backend: "wasm" as const,
      probeProfileVersion: 1 as const,
      probeResultDigest: `sha256:${"c".repeat(64)}`,
    };
    const configuration = browserBackgroundRemoveRuntimeConfigFromManifest(
      {
        schemaVersion: "kanvas.browser-runtime-manifest/v1",
        runtimeReleaseId: "01K00000000000000000000010",
        runtimeReleaseDigest: `sha256:${"f".repeat(64)}`,
        capabilities: [capability],
      },
      "01K00000000000000000000001",
    );

    expect(configuration).toMatchObject({
      modelWorkspaceId: "01K00000000000000000000001",
      modelUrl:
        "/api/v1/model-resource-revisions/01K00000000000000000000011/content",
      capabilities: [capability],
    });
  });
});
