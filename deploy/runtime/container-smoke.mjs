// Runs inside the built image with no network and only fake backend services.
import assert from "node:assert/strict";
import { createConnection } from "node:net";
import { supervise } from "/app/runtime/supervisor.mjs";
const backend = `
const http=require('http'); const crypto=require('crypto');
const server=http.createServer(async(req,res)=>{
 if(req.url.startsWith('/health/')) { res.end('ok'); return; }
 if(req.url==='/api/stream') {res.writeHead(200,{'content-type':'text/event-stream'});res.write('data: first\\n\\n');setTimeout(()=>res.end('data: last\\n\\n'),100);return;}
 let bytes=0;for await(const chunk of req)bytes+=chunk.length;
 res.setHeader('content-type','application/json');res.end(JSON.stringify({url:req.url,method:req.method,proto:req.headers['x-forwarded-proto'],host:req.headers.host,bytes}));
});
server.on('upgrade',(req,socket)=>{const key=crypto.createHash('sha1').update(req.headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.end('HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: '+key+'\\r\\n\\r\\n');});
server.listen(Number(process.argv[1]),'127.0.0.1');process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
`;
let exitResolve;
const exited = new Promise((resolve) => {
  exitResolve = resolve;
});
const runtime = await supervise({
  graceMs: 5000,
  onExit: exitResolve,
  probe: async (kind) =>
    (
      await Promise.all(
        [3000, 3001].map(async (port) => {
          const r = await fetch(`http://127.0.0.1:${port}/health/${kind}`, {
            signal: AbortSignal.timeout(1000),
          });
          await r.body.cancel();
          return r.ok;
        }),
      )
    ).every(Boolean),
  commands: [
    {
      name: "server",
      command: process.execPath,
      args: ["-e", backend, "3000"],
    },
    {
      name: "worker",
      command: process.execPath,
      args: ["-e", backend, "3001"],
    },
    { name: "web", command: "nginx", args: ["-g", "daemon off;"] },
  ],
});
try {
  const base = "http://127.0.0.1:8080";
  let available = false;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(base + "/health/ready");
      await r.body.cancel();
      if (r.ok) {
        available = true;
        break;
      }
    } catch {
      // Startup may not have opened the socket yet.
    }
    await new Promise((r) => setTimeout(r, 50));
  }
  assert.ok(available, "application never ready");
  for (const kind of ["live", "ready", "startup"]) {
    const r = await fetch(base + "/health/" + kind);
    assert.equal(r.status, 200);
    await r.body.cancel();
  }
  const root = await (await fetch(base + "/")).text();
  assert.match(root, /<html/i);
  assert.equal(await (await fetch(base + "/login")).text(), root);
  const api = await (
    await fetch(base + "/api/echo?x=1", {
      method: "POST",
      headers: { "x-forwarded-proto": "https" },
      body: "x".repeat(1024 * 1024),
    })
  ).json();
  assert.equal(api.url, "/api/echo?x=1");
  assert.equal(api.method, "POST");
  assert.equal(api.proto, "https");
  assert.equal(api.bytes, 1024 * 1024);
  const stream = await fetch(base + "/api/stream");
  const reader = stream.body.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /first/);
  assert.doesNotMatch(new TextDecoder().decode(first.value), /last/);
  await reader.cancel();
  const upgrade = await new Promise((resolve, reject) => {
    const socket = createConnection(8080, "127.0.0.1", () =>
      socket.write(
        "GET /api/ws HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
      ),
    );
    socket.setTimeout(2000, () => socket.destroy(new Error("upgrade timeout")));
    socket.once("data", (d) => {
      resolve(d.toString());
      socket.destroy();
    });
    socket.on("error", reject);
  });
  assert.match(upgrade, /101 Switching Protocols/);
  process.kill(process.pid, "SIGTERM");
  assert.equal(await exited, 0);
  console.log(
    "PASS: real Nginx SPA/API/upload/HTTPS headers/SSE/WebSocket/aggregate health/SIGTERM; fake backends only.",
  );
} finally {
  runtime.stop(true);
}
