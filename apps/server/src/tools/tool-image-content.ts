import type { ToolImageContent } from "@kanvas/contracts/api";
import type { StoredSiteToolImage } from "@kanvas/database";

export function toolImageContent(image: StoredSiteToolImage): ToolImageContent {
  return {
    id: image.id,
    mimeType: "image/png",
    contentBase64: image.bytes.toString("base64"),
    sha256: image.sha256,
    width: image.width,
    height: image.height,
  };
}
