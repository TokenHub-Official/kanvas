import type { CapabilityRunDetails, ToolSession } from "@kanvas/contracts/api";
import { Alert, Button, Spin } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { createToolRuntimeApi, type ToolApiScope } from "./tool-api.js";
import {
  createRuntimeSessionRecovery,
  createUploadedToolBridge,
} from "./runtime-session.js";
import { observeRuntimeOpening } from "./runtime-opening.js";
import { connectRuntimeFrame } from "./runtime-frame.js";
import { ToolResult } from "./tool-result.js";
const maximumDiagnostics = 20;
function storage(): Storage | undefined {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}
export function RuntimeSurface({
  toolId,
  revisionId,
  principalId,
  csrfToken,
  scope,
  canDownload = false,
}: {
  toolId: string;
  revisionId: string;
  principalId: string;
  csrfToken: string;
  scope: ToolApiScope;
  canDownload?: boolean;
}): React.JSX.Element {
  const { t, i18n } = useTranslation();
  const scopeKey =
    scope.kind === "use" ? `use:${scope.workspaceId}` : `preview:${revisionId}`;
  const scopeKind = scope.kind;
  const scopeWorkspaceId = scope.kind === "use" ? scope.workspaceId : undefined;
  const api = useMemo(
    () =>
      createToolRuntimeApi({
        scope:
          scopeKind === "use"
            ? { kind: "use", workspaceId: scopeWorkspaceId! }
            : { kind: "preview" },
        csrfToken,
        locale: i18n.language,
      }),
    [scopeKind, scopeWorkspaceId, csrfToken, i18n.language],
  );
  const recoveryStorage = useMemo(() => storage(), []);
  const recovery = useMemo(
    () =>
      createRuntimeSessionRecovery({
        api,
        toolId,
        revisionId,
        principalId,
        scopeKey,
        ...(recoveryStorage ? { storage: recoveryStorage } : {}),
      }),
    [api, toolId, revisionId, principalId, scopeKey, recoveryStorage],
  );
  const [session, setSession] = useState<ToolSession>();
  const [reason, setReason] = useState<string>();
  const [busy, setBusy] = useState(true);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [run, setRun] = useState<CapabilityRunDetails>();
  const frameRef = useRef<HTMLIFrameElement>(null);
  const automaticRecoveryRef = useRef<string | undefined>(undefined);
  const reopenedGenerationRef = useRef(-1);
  const [connectionAvailable, setConnectionAvailable] = useState(true);
  const [openingRequest, setOpeningRequest] = useState({
    mode: "display",
    generation: 0,
  });
  useEffect(() => {
    return observeRuntimeOpening({
      open: () => {
        const explicit =
          openingRequest.mode === "reopen" &&
          reopenedGenerationRef.current !== openingRequest.generation;
        // Credential/locale changes may restart this effect, but must not replay a reopen.
        if (explicit) reopenedGenerationRef.current = openingRequest.generation;
        return explicit ? recovery.reopen() : recovery.openForDisplay();
      },
      onSession: (value) => {
        setConnectionAvailable(true);
        setSession(value);
        setReason(undefined);
        setBusy(false);
      },
      onWaiting: () => {
        setReason("connection_unavailable");
        setBusy(false);
      },
      onRejected: () => {
        setReason("unavailable");
        setBusy(false);
      },
    });
  }, [recovery, openingRequest]);
  useEffect(() => {
    if (busy || !session?.available || reason || !frameRef.current) return;
    const execute = createUploadedToolBridge({
      api,
      session,
      principalId,
      scopeKey,
      ...(recoveryStorage ? { storage: recoveryStorage } : {}),
      onRun: setRun,
    });
    return connectRuntimeFrame({
      frame: frameRef.current,
      session,
      api,
      execute,
      onConnectionChange: setConnectionAvailable,
      onStopped: (failure) => {
        // Only expiry of a confirmed task-free session can silently replace its identity.
        // Each new session gets its own recovery allowance; one bad receipt cannot loop.
        if (
          failure === "expired" &&
          session.maximumRuns === 0 &&
          session.runIds.length === 0 &&
          automaticRecoveryRef.current !== session.id
        ) {
          automaticRecoveryRef.current = session.id;
          setBusy(true);
          setOpeningRequest((previous) => ({
            mode: "display",
            generation: previous.generation + 1,
          }));
        } else setReason(failure);
      },
      ...(scopeKind === "preview"
        ? {
            onDiagnostic: (message: string, line: number | null) => {
              setDiagnostics((previous) =>
                previous.length >= maximumDiagnostics
                  ? previous
                  : [...previous, line ? `${line}: ${message}` : message],
              );
            },
          }
        : {}),
    });
  }, [
    session,
    api,
    principalId,
    scopeKey,
    reason,
    busy,
    recoveryStorage,
    scopeKind,
    recovery,
  ]);
  function reopen() {
    setBusy(true);
    setOpeningRequest((previous) => ({
      mode: reason === "connection_unavailable" ? "display" : "reopen",
      generation: previous.generation + 1,
    }));
  }
  const unavailable =
    reason ||
    (session && !session.available ? session.unavailableReason : undefined);
  return (
    <div className="flex h-full min-h-0 flex-col bg-paper">
      {busy ? (
        <div className="flex min-h-48 flex-1 items-center justify-center">
          <Spin aria-label={t("studio.tools.opening")} />
        </div>
      ) : null}
      {!busy && unavailable ? (
        <div className="m-auto w-full max-w-xl p-6">
          <Alert
            type="warning"
            title={t(
              reason === "connection_unavailable"
                ? "studio.tools.reconnecting"
                : "studio.tools.disconnected",
            )}
            description={
              session?.maximumRuns === 0
                ? undefined
                : t("studio.tools.disconnectedHelp")
            }
          />
          <div className="mt-4 flex gap-2">
            <Button
              type="primary"
              onClick={() => {
                void reopen();
              }}
            >
              {t("studio.tools.reopen")}
            </Button>
          </div>
        </div>
      ) : null}
      {!busy && !unavailable && !connectionAvailable ? (
        <Alert
          type="info"
          title={t("studio.tools.reconnecting")}
          description={t("studio.tools.reconnectingHelp")}
        />
      ) : null}
      {!busy && !unavailable ? (
        <iframe
          ref={frameRef}
          title={t("studio.tools.toolFrame")}
          className="block min-h-0 w-full flex-1 border-0"
        />
      ) : null}
      {scope.kind === "preview" ? (
        <details
          className="max-h-40 shrink-0 overflow-auto p-3 text-xs"
          open={diagnostics.length > 0}
        >
          <summary className="cursor-pointer">
            {t("studio.tools.editor.debug")}
            {diagnostics.length ? ` (${diagnostics.length})` : ""}
          </summary>
          {diagnostics.length ? (
            [...new Set(diagnostics)].map((message) => (
              <p key={message} className="break-words">
                {message}
              </p>
            ))
          ) : (
            <p>{t("studio.tools.editor.noRuntimeErrors")}</p>
          )}
        </details>
      ) : null}
      {run && scope.kind === "use" && run.lifecycleStatus === "completed" ? (
        <details
          className="max-h-[45%] shrink-0 overflow-auto border-t border-line bg-paper px-5 py-3"
          open
        >
          <summary className="cursor-pointer text-sm font-medium">
            {t("studio.tools.result")}
          </summary>
          <ToolResult
            run={run}
            workspaceId={scope.workspaceId}
            canDownload={canDownload}
          />
        </details>
      ) : null}
    </div>
  );
}
