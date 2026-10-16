import { parse } from "parse5";
import { randomBytes } from "node:crypto";

export interface ToolRuntimeDocument {
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}
const idPattern = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/u;
export function toolRuntimePath(
  sessionId: string,
  workspaceId?: string,
): string {
  if (
    !idPattern.test(sessionId) ||
    (workspaceId !== undefined && !idPattern.test(workspaceId))
  )
    throw new Error("Invalid runtime identity.");
  return workspaceId === undefined
    ? `/api/v1/instance/tool-runtime/${sessionId}`
    : `/api/v1/tool-runtime/workspaces/${workspaceId}/sessions/${sessionId}`;
}
function origins(values: readonly string[]): string[] {
  const result = [
    ...new Set(
      values.map((value) => {
        const url = new URL(value);
        if (
          !["http:", "https:"].includes(url.protocol) ||
          url.username ||
          url.password ||
          url.hostname.includes("*") ||
          url.origin !== value
        )
          throw new Error("Runtime parents must be explicit HTTP origins.");
        return url.origin;
      }),
    ),
  ];
  if (!result.length)
    throw new Error("Runtime requires an allowed parent origin.");
  return result;
}
function headers(csp: string): Readonly<Record<string, string>> {
  return {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Security-Policy": csp,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-DNS-Prefetch-Control": "off",
    "Permissions-Policy":
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), clipboard-read=(), clipboard-write=(), fullscreen=()",
  };
}
const hostScript = String.raw`
(() => {
  const config = JSON.parse(document.getElementById('runtime-config').textContent);
  const root = document.getElementById('runtime-root');
  let connected = false;
  let stopped = false;
  let parentOrigin;
  let parentPort;
  let childPort;
  let frame;
  let loads = 0;
  let diagnostics = 0;
  const bounded = (data, limit) => {
    try { const text = JSON.stringify(data); return typeof text === 'string' && text.length <= limit; }
    catch { return false; }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    parentPort?.close();
    childPort?.close();
    frame?.remove();
    root.textContent = config.disconnected;
    if (parentOrigin) parent.postMessage({ type: 'kanvas.tool.host.stopped', version: 1 }, parentOrigin);
  };
  if (parent === window) { root.textContent = config.disconnected; return; }
  addEventListener('pagehide', stop, { once: true });
  addEventListener('message', event => {
    if (config.diagnostics && !stopped && frame && event.source === frame.contentWindow && event.origin === 'null') {
      const data = event.data;
      if (data?.type === 'kanvas.tool.diagnostic' && data.version === 1 && typeof data.message === 'string' && data.message.length <= 600 && diagnostics < 20) {
        diagnostics += 1;
        parent.postMessage({type:'kanvas.tool.host.diagnostic',version:1,message:data.message,line:Number.isSafeInteger(data.line) && data.line > 0 ? data.line : null},parentOrigin);
      }
      return;
    }
    if (event.source !== parent || !config.parentOrigins.includes(event.origin)) return;
    if (event.data?.type === 'kanvas.tool.host.close' && event.data.version === 1) { stop(); return; }
    if (connected || stopped || event.data?.type !== 'kanvas.tool.host.connect' || event.data.version !== 1 || event.ports.length !== 1) return;
    connected = true;
    parentOrigin = event.origin;
    parentPort = event.ports[0];
    parentPort.onmessageerror = stop;
    parentPort.onmessage = response => {
      if (stopped) return;
      if (!bounded(response.data, 1048576)) { stop(); return; }
      childPort?.postMessage(response.data);
    };
    parentPort.start();
    frame = document.createElement('iframe');
    frame.title = 'Tool';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.setAttribute('allow', "camera 'none'; microphone 'none'; geolocation 'none'; fullscreen 'none'; clipboard-read 'none'; clipboard-write 'none'");
    frame.addEventListener('load', () => {
      loads += 1;
      if (loads !== 1 || stopped) { stop(); return; }
      const channel = new MessageChannel();
      childPort = channel.port1;
      childPort.onmessageerror = stop;
      childPort.onmessage = request => {
        if (stopped) return;
        if (!bounded(request.data, 32768)) { stop(); return; }
        parentPort.postMessage(request.data);
      };
      childPort.start();
      frame.contentWindow.postMessage({ type: 'kanvas.tool.connect', version: 1 }, '*', [channel.port2]);
    });
    frame.src = config.documentPath;
    root.replaceChildren(frame);
  });
  parent.postMessage({ type: 'kanvas.tool.host.ready', version: 1 }, '*');
})();`;

/** Only trusted loader code is embedded here. Uploaded HTML is a separate response. */
export function createToolHostDocument(options: {
  sessionId: string;
  workspaceId?: string;
  parentOrigins: readonly string[];
  locale?: "zh-CN" | "en-US";
}): ToolRuntimeDocument {
  const parentOrigins = origins(options.parentOrigins);
  const documentPath = `${toolRuntimePath(options.sessionId, options.workspaceId)}/document`;
  const nonce = randomBytes(24).toString("base64");
  const config = JSON.stringify({
    parentOrigins,
    documentPath,
    diagnostics: options.workspaceId === undefined,
    disconnected:
      options.locale === "en-US"
        ? "Tool disconnected. Reopen to continue."
        : "工具已断开，请重新打开。",
  }).replace(/</g, "\\u003c");
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${nonce}'`,
    `style-src 'nonce-${nonce}'`,
    `frame-src ${parentOrigins.map((origin) => origin + documentPath).join(" ")}`,
    `frame-ancestors ${parentOrigins.join(" ")}`,
    "connect-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "sandbox allow-scripts allow-same-origin",
  ].join("; ");
  return {
    headers: headers(csp),
    body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Kanvas Tool</title><style nonce="${nonce}">html,body,#runtime-root{width:100%;height:100%;margin:0}body{font:14px system-ui;color:#6b6a73;background:#fff}iframe{display:block;width:100%;height:100%;border:0}</style></head><body><div id="runtime-root"></div><script id="runtime-config" type="application/json" nonce="${nonce}">${config}</script><script nonce="${nonce}">${hostScript}</script></body></html>`,
  };
}

const diagnosticScript = `<script>(()=>{let count=0;const send=(message,line)=>{if(count++>=20)return;parent.postMessage({type:'kanvas.tool.diagnostic',version:1,message:String(message).slice(0,600),line:line||null},'*')};addEventListener('error',event=>send(event.message,event.lineno));addEventListener('unhandledrejection',event=>send(event.reason instanceof Error?event.reason.message:'Unhandled promise rejection',null));})();</script>`;
function withPreviewDiagnostics(html: string): string {
  const document = parse(html, { sourceCodeLocationInfo: true });
  const root = document.childNodes.find(
    (node) => "tagName" in node && node.tagName === "html",
  );
  const head =
    root && "childNodes" in root
      ? root.childNodes.find(
          (node) => "tagName" in node && node.tagName === "head",
        )
      : undefined;
  const doctype = document.childNodes.find(
    (node) => node.nodeName === "#documentType",
  );
  const offset =
    head && "tagName" in head
      ? head.sourceCodeLocation?.startTag?.endOffset
      : undefined;
  const rootOffset =
    root && "tagName" in root
      ? root.sourceCodeLocation?.startTag?.endOffset
      : undefined;
  const insertAt =
    offset ?? rootOffset ?? doctype?.sourceCodeLocation?.endOffset ?? 0;
  return html.slice(0, insertAt) + diagnosticScript + html.slice(insertAt);
}

/** HTTP sandbox remains in force even when author markup removes/replaces meta policies. */
export function createToolContentDocument(
  html: Buffer,
  parentOrigins: readonly string[],
  diagnostics = false,
): ToolRuntimeDocument {
  const csp = [
    "sandbox allow-scripts",
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "font-src data:",
    "worker-src blob:",
    "connect-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    `frame-ancestors ${origins(parentOrigins).join(" ")}`,
  ].join("; ");
  return {
    body: diagnostics
      ? withPreviewDiagnostics(html.toString("utf8"))
      : html.toString("utf8"),
    headers: headers(csp),
  };
}
