import { resolve } from "node:path";

import { verifyDesignerReviewPacket } from "../src/designer-review-packet.js";

const root = resolve(process.argv[2] ?? "artifacts/atom-foundation-review-v1");
const result = await verifyDesignerReviewPacket(root);

process.stdout.write(`${JSON.stringify(result)}\n`);
