import type { CapabilityRunDetails } from "@kanvas/contracts/api";
import { ToolResult } from "./tool-result.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "antd";
import { connectToolPort } from "./bridge.js";
import { workspaceCapabilityToolSession } from "./capability-session.js";
import calculatorHtml from "./examples/calculator.html?raw";
import capabilityHtml from "./examples/capability.html?raw";

export type ExternalToolId = "calculator" | "capability";

export function ToolFrame(props: {
  readonly toolId: ExternalToolId;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly csrfToken: string;
  readonly canRun: boolean;
  readonly canDownload: boolean;
}): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const locale = i18n.resolvedLanguage?.startsWith("en") ? "en-US" : "zh-CN";
  const [generation, setGeneration] = useState(0);
  return (
    <section className="min-w-0 rounded-card border border-line bg-paper">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
        <span className="text-sm text-muted">
          {t(`studio.externalTools.${props.toolId}Summary`)}
        </span>
        <Button onClick={() => setGeneration((value) => value + 1)}>
          {t("studio.externalTools.reconnect")}
        </Button>
      </div>
      <IsolatedToolFrame
        key={`${props.toolId}:${props.workspaceId}:${props.principalId}:${String(props.canRun)}:${locale}:${String(generation)}:${props.csrfToken}`}
        {...props}
        locale={locale}
      />
    </section>
  );
}

function IsolatedToolFrame({
  toolId,
  workspaceId,
  principalId,
  csrfToken,
  canRun,
  canDownload,
  locale,
}: {
  readonly toolId: ExternalToolId;
  readonly workspaceId: string;
  readonly principalId: string;
  readonly csrfToken: string;
  readonly canRun: boolean;
  readonly canDownload: boolean;
  readonly locale: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [run, setRun] = useState<CapabilityRunDetails>();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const disconnectRef = useRef<(() => void) | undefined>(undefined);
  const execute = useMemo(
    () =>
      toolId === "capability"
        ? workspaceCapabilityToolSession({
            workspaceId,
            principalId,
            csrfToken,
            locale,
            allowed: canRun,
            onRun: setRun,
          })
        : undefined,
    [toolId, workspaceId, principalId, csrfToken, locale, canRun],
  );
  useEffect(() => () => disconnectRef.current?.(), [execute]);
  function connect(): void {
    disconnectRef.current?.();
    if (!execute || !frameRef.current?.contentWindow) return;
    const channel = new MessageChannel();
    disconnectRef.current = connectToolPort(channel.port1, execute);
    // srcDoc has an opaque origin. Transfer a port directly to this exact frame;
    // credentials and generic window message listeners are never exposed.
    frameRef.current.contentWindow.postMessage(
      { type: "kanvas.tool.connect", version: 1 },
      "*",
      [channel.port2],
    );
  }
  const html = (
    toolId === "calculator" ? calculatorHtml : capabilityHtml
  ).replace('<html lang="zh-CN">', `<html lang="${locale}">`);
  return (
    <>
      <iframe
        className="block h-[760px] w-full rounded-b-card border-0"
        ref={frameRef}
        onLoad={connect}
        sandbox="allow-scripts"
        referrerPolicy="no-referrer"
        srcDoc={html}
        title={t(`studio.externalTools.${toolId}`)}
      />
      {run?.lifecycleStatus === "completed" ? (
        <ToolResult
          run={run}
          workspaceId={workspaceId}
          canDownload={canDownload}
        />
      ) : null}
    </>
  );
}
