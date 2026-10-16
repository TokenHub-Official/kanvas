// Transport adapter for legacy Matrix CLI, whose --envs parser splits every '='.
// GitLab still stores the ordinary KANVAS_* keys. No credentials are baked in.
const prefix = "KANVAS_CI_B64_";
for (const [key, value] of Object.entries(process.env)) {
  if (!key.startsWith(prefix)) continue;
  const suffix = key.slice(prefix.length);
  const target = `KANVAS_${suffix}`;
  if (!/^[A-Z][A-Z0-9_]*$/.test(suffix) || suffix.startsWith("CI_B64_")) {
    throw new Error("Invalid encoded Kanvas configuration key.");
  }
  if (process.env[target] !== undefined) {
    throw new Error(`Conflicting deployment configuration: ${target}.`);
  }
  if (!/^[A-Za-z0-9+/]*$/.test(value) || value.length % 4 === 1) {
    throw new Error(`Invalid encoded deployment configuration: ${target}.`);
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64").replace(/=+$/, "") !== value) {
    throw new Error(`Invalid encoded deployment configuration: ${target}.`);
  }
  const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (decoded.includes("\0")) {
    throw new Error(`Invalid encoded deployment configuration: ${target}.`);
  }
  process.env[target] = decoded;
  delete process.env[key];
}
