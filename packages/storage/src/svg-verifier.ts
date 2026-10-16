import { createHash } from "node:crypto";

import { MediaVerificationError } from "./media-verifier.js";
import type { ServerStreamMediaVerifier } from "./server-stream-upload-coordinator.js";

const allowedElements = new Set([
  "circle",
  "clippath",
  "defs",
  "desc",
  "ellipse",
  "g",
  "lineargradient",
  "line",
  "mask",
  "path",
  "polygon",
  "polyline",
  "radialgradient",
  "rect",
  "stop",
  "svg",
  "title",
]);

function reject(message: string): never {
  throw new MediaVerificationError("media_verification.malformed", message);
}

async function collect(
  body: AsyncIterable<Uint8Array>,
  maximumInputBytes: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of body) {
    size += chunk.byteLength;
    if (size > maximumInputBytes) {
      throw new MediaVerificationError(
        "media_verification.input_too_large",
        "SVG input exceeds the verification profile.",
      );
    }
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks, size);
}

export const verifyTrustedSvg: ServerStreamMediaVerifier = async (request) => {
  if (
    request.declaredMediaType !== undefined &&
    request.declaredMediaType !== "image/svg+xml"
  ) {
    throw new MediaVerificationError(
      "media_verification.declared_type_mismatch",
      "Declared media type is not SVG.",
    );
  }
  const bytes = await collect(request.body, request.maximumInputBytes);
  let document: string;
  try {
    document = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    throw new MediaVerificationError(
      "media_verification.malformed",
      "SVG input is not valid UTF-8.",
      { cause: error },
    );
  }
  if (document.includes("\0")) reject("SVG input contains a null byte.");
  const withoutDeclaration = document
    .trim()
    .replace(/^<\?xml\s[^?]*\?>\s*/iu, "");
  if (!/^<svg(?:\s|>)/iu.test(withoutDeclaration)) {
    reject("SVG input does not have an SVG root element.");
  }
  if (!/<\/svg>\s*$/iu.test(withoutDeclaration)) {
    reject("SVG input does not have a bounded SVG root element.");
  }
  const withoutStandardNamespace = withoutDeclaration.replace(
    /\sxmlns="http:\/\/www\.w3\.org\/2000\/svg"/iu,
    "",
  );
  if (
    /<!doctype|<!entity|<\?(?!xml\s)|\b(?:href|xlink:href|style|xmlns|xmlns:xlink)\s*=|\bon[a-z]+\s*=|javascript:|data:|https?:|url\s*\(/iu.test(
      withoutStandardNamespace,
    )
  ) {
    reject("SVG input contains an external or executable reference.");
  }
  const tags = [...withoutDeclaration.matchAll(/<\/?\s*([A-Za-z][\w:.-]*)/gu)];
  if (tags.length === 0 || tags.length > 10_000) {
    reject("SVG input has an invalid element count.");
  }
  for (const match of tags) {
    const name = match[1]!.toLowerCase();
    if (!allowedElements.has(name)) {
      reject(`SVG element ${name} is not allowed.`);
    }
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const verificationResultHash = `sha256:${createHash("sha256")
    .update("kanvas:svg-verification:v1\0")
    .update(request.verificationProfileVersion)
    .update("\0")
    .update(String(bytes.byteLength))
    .update("\0")
    .update(sha256)
    .digest("hex")}`;
  return {
    byteSize: String(bytes.byteLength),
    sha256,
    detectedMediaType: "image/svg+xml",
    verificationResultHash,
  };
};
