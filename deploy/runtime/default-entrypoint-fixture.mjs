// Mounted over each application entry ONLY by the isolated image test.
import { createServer } from "node:http";
import { existsSync, writeFileSync } from "node:fs";
const worker = process.cwd().endsWith("/worker");
writeFileSync(
  worker ? "/tmp/worker.pid" : "/tmp/server.pid",
  String(process.pid),
);
const server = createServer((request, response) => {
  if (request.url === "/health/ready" && existsSync("/tmp/unready"))
    response.statusCode = 503;
  response.end(
    process.env.KANVAS_INSTANCE_ID === "fixture-instance"
      ? "ok"
      : "missing-injected-config",
  );
});
server.listen(worker ? 3001 : 3000, "127.0.0.1");
process.on("SIGTERM", () => server.close(() => process.exit(0)));
