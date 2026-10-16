export const BROWSER_U2NET_INPUT_SIZE = Object.freeze({
  compact: 320,
  standard: 1024,
});

export interface BrowserU2NetConfiguration {
  readonly inputSize: (typeof BROWSER_U2NET_INPUT_SIZE)[keyof typeof BROWSER_U2NET_INPUT_SIZE];
  readonly modelDigest: string;
  readonly modelUrl: string;
  readonly modelWorkspaceId?: string;
  readonly modelVariant: "u2net" | "u2netp" | "isnet-general-fp16";
  readonly normalization: "imagenet" | "isnet";
  readonly wasmPaths: string;
}
