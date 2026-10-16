// Lifecycle-only fixture. Real database installation is validated separately.
import { access, writeFile } from "node:fs/promises";
if (process.argv[2] === "migrate") {
  await writeFile("/tmp/schema-fixture-current", "current");
} else if (process.argv[2] === "check") {
  await access("/tmp/schema-fixture-current");
} else {
  process.exitCode = 1;
}
