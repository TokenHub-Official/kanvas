import { createHash, randomBytes } from "node:crypto";

import {
  createBrowserAttemptGrantCodec,
  type BrowserAttemptGrantCodec,
  type BrowserAttemptGrantEntropy,
  type BrowserAttemptGrantSha256,
} from "@kanvas/application/browser-execution";

export const nodeBrowserAttemptGrantEntropy =
  Object.freeze<BrowserAttemptGrantEntropy>({
    randomBytes(length) {
      return randomBytes(length);
    },
  });

export const nodeBrowserAttemptGrantSha256 =
  Object.freeze<BrowserAttemptGrantSha256>({
    digest(value) {
      return new Uint8Array(createHash("sha256").update(value).digest());
    },
  });

export function createNodeBrowserAttemptGrantCodec(): BrowserAttemptGrantCodec {
  return createBrowserAttemptGrantCodec({
    entropy: nodeBrowserAttemptGrantEntropy,
    sha256: nodeBrowserAttemptGrantSha256,
  });
}
