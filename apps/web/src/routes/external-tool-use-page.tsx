import {
  ArrowLeftOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  QuestionCircleOutlined,
} from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { getRouteApi, Link } from "@tanstack/react-router";
import { Button, Drawer, Alert, Spin } from "antd";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { WorkspaceBoundary } from "../components/workspace-page.js";
import { AppShell } from "../components/app-shell.js";
import { toolLibrary } from "../features/external-tools/library-api.js";
import { RuntimeSurface } from "../features/external-tools/runtime-surface.js";
import { ToolArtwork } from "../features/external-tools/tool-artwork.js";
const route = getRouteApi("/w/$workspaceId/tools/$slug");
export function ExternalToolUsePage(): React.JSX.Element {
  const { workspaceId, slug } = route.useParams();
  const { t } = useTranslation();
  const tool = useQuery({
    queryKey: ["tool-usage", workspaceId, slug],
    queryFn: () => toolLibrary.usage(workspaceId, slug),
    retry: false,
  });
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [full, setFull] = useState(false);
  const [help, setHelp] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    function changed() {
      setFull(document.fullscreenElement === surfaceRef.current);
    }
    document.addEventListener("fullscreenchange", changed);
    return () => document.removeEventListener("fullscreenchange", changed);
  }, []);
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await surfaceRef.current?.requestFullscreen();
    } catch {
      setError(true);
    }
  }
  return (
    <WorkspaceBoundary workspaceId={workspaceId}>
      {({ context, workspace }) => (
        <AppShell
          context={context}
          workspace={workspace}
          pageTitle={tool.data?.displayName ?? t("studio.tools.title")}
          fullBleed
        >
          <div
            ref={surfaceRef}
            className="flex h-full min-h-0 flex-col bg-paper"
          >
            <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-4">
              <Link
                to="/w/$workspaceId/tools"
                params={{ workspaceId }}
                aria-label={t("studio.tools.back")}
                className="rounded-control p-2 text-ink hover:bg-mist"
              >
                <ArrowLeftOutlined />
              </Link>
              {tool.data && (tool.data.logoImageId || tool.data.symbol) ? (
                <div className="h-8 w-8 shrink-0 overflow-hidden rounded-control">
                  <ToolArtwork
                    symbol={tool.data.symbol}
                    imageId={tool.data.logoImageId}
                    workspaceId={workspaceId}
                  />
                </div>
              ) : null}
              <h1
                id="tool-page-title"
                className="m-0 min-w-0 flex-1 truncate text-base font-semibold"
              >
                {tool.data?.displayName ?? t("studio.tools.title")}
              </h1>
              {tool.data?.descriptionMarkdown ? (
                <Button
                  type="text"
                  icon={<QuestionCircleOutlined />}
                  aria-label={t("studio.tools.help")}
                  onClick={() => setHelp(true)}
                />
              ) : null}
              <Button
                type="text"
                icon={
                  full ? <FullscreenExitOutlined /> : <FullscreenOutlined />
                }
                onClick={() => {
                  void fullscreen();
                }}
              >
                {t(
                  full
                    ? "studio.tools.exitFullscreen"
                    : "studio.tools.fullscreen",
                )}
              </Button>
            </header>
            {error ? (
              <Alert
                type="info"
                title={t("studio.tools.fullscreenError")}
                closable
                onClose={() => setError(false)}
              />
            ) : null}
            <div className="min-h-0 flex-1">
              {tool.isPending ? (
                <div className="flex h-full items-center justify-center">
                  <Spin />
                </div>
              ) : null}
              {tool.isError ? (
                <div className="p-8">
                  <Alert type="warning" title={t("studio.tools.unavailable")} />
                </div>
              ) : null}
              {!tool.isPending && !tool.isError && tool.data ? (
                <RuntimeSurface
                  key={tool.data.id}
                  toolId={tool.data.id}
                  revisionId={tool.data.publishedRevisionId}
                  principalId={context.human.principalId}
                  csrfToken={context.csrfToken}
                  scope={{ kind: "use", workspaceId }}
                  canDownload={workspace.permissions.includes(
                    "artifact.download",
                  )}
                />
              ) : null}
            </div>
            <Drawer
              title={t("studio.tools.help")}
              open={help}
              onClose={() => setHelp(false)}
              getContainer={false}
            >
              <p className="whitespace-pre-wrap text-sm leading-7">
                {tool.data?.descriptionMarkdown}
              </p>
            </Drawer>
          </div>
        </AppShell>
      )}
    </WorkspaceBoundary>
  );
}
