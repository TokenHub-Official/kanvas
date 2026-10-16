import { LockOutlined, ReadOutlined, TeamOutlined } from "@ant-design/icons";
import type { AgentHubSkillDetail } from "@kanvas/contracts/api";
import { Tabs } from "antd";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { AssetArtwork } from "./asset-artwork.js";
import type { SkillFileSource } from "../api/transport.js";
import {
  SkillContentBrowser,
  type SkillFileSelection,
} from "./skill-content-browser.js";

/** The same content can be hosted by a page, a dialog, or a conversation preview. */
export function SkillDetailContent({
  detail,
  workspaceId,
  canReadAssets,
  actions,
  feedback,
  selection,
  compact = false,
  renderExampleRequest,
  status,
  source,
}: {
  readonly detail: Pick<
    AgentHubSkillDetail,
    | "displayName"
    | "summary"
    | "coverAssetId"
    | "visibility"
    | "instructions"
    | "resources"
  > &
    Partial<Pick<AgentHubSkillDetail, "description" | "exampleRequests">>;
  readonly compact?: boolean;
  readonly status: ReactNode;
  readonly source: SkillFileSource;
  readonly workspaceId: string;
  readonly canReadAssets: boolean;
  readonly actions?: ReactNode;
  readonly feedback?: ReactNode;
  readonly selection?: SkillFileSelection;
  readonly renderExampleRequest?: (request: string, index: number) => ReactNode;
}): React.JSX.Element {
  const { t } = useTranslation();
  const [activeView, setActiveView] = useState(() =>
    source.kind === "published" && (!selection || selection.path === "SKILL.md")
      ? "overview"
      : "files",
  );
  const purpose = detail.description?.trim() || detail.summary;
  const exampleRequests = [...new Set(detail.exampleRequests ?? [])];
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <header className="shrink-0 border-b border-line/60 px-4 py-3">
        <div className="flex flex-wrap items-start gap-3">
          <AssetArtwork
            workspaceId={workspaceId}
            alt=""
            {...(canReadAssets && detail.coverAssetId
              ? { assetId: detail.coverAssetId }
              : {})}
            className="size-9 shrink-0 rounded-lg bg-primary/8 text-base text-primary"
          >
            <ReadOutlined aria-hidden="true" />
          </AssetArtwork>
          <div className="min-w-0 flex-1">
            <h2 className="m-0 break-words text-base leading-6 font-semibold text-ink">
              {detail.displayName}
            </h2>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted">
              {status}
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                {detail.visibility === "workspace" ? (
                  <TeamOutlined aria-hidden="true" />
                ) : (
                  <LockOutlined aria-hidden="true" />
                )}
                {t(`agent.hub.visibility.${detail.visibility}`)}
              </span>
            </div>
          </div>
          {actions ? (
            <div className="flex w-full shrink-0 flex-wrap items-center justify-end gap-2 sm:w-auto">
              {actions}
            </div>
          ) : null}
        </div>
        {source.kind !== "published" ? (
          <p className="mt-2 mb-0 text-sm leading-5 text-muted sm:pl-12">
            {detail.summary}
          </p>
        ) : null}
      </header>
      {feedback}
      <div className="min-h-0 flex-1 overflow-hidden">
        <Tabs
          activeKey={activeView}
          animated={false}
          classNames={{
            root: "flex h-full flex-col px-4",
            body: "h-full min-h-0 overflow-hidden",
            content: "h-full min-h-0",
          }}
          items={[
            {
              key: "overview",
              label: t("agent.hub.overview"),
              children: (
                <div className="h-full overflow-y-auto py-5">
                  <div className="mx-auto grid max-w-[760px] gap-7">
                    <section>
                      <h3 className="m-0 text-sm font-semibold text-ink">
                        {t("agent.hub.skillDescription")}
                      </h3>
                      <p className="mt-2 mb-0 whitespace-pre-wrap break-words text-sm leading-6 text-muted">
                        {purpose}
                      </p>
                    </section>
                    {exampleRequests.length > 0 ? (
                      <section>
                        <h3 className="m-0 text-sm font-semibold text-ink">
                          {t("agent.hub.exampleRequests")}
                        </h3>
                        <ul className="m-0 mt-3 grid list-none gap-2 p-0">
                          {exampleRequests.map((request, index) => (
                            <li key={request}>
                              {renderExampleRequest ? (
                                renderExampleRequest(request, index)
                              ) : (
                                <div className="rounded-control bg-mist px-3 py-2 text-sm leading-6 text-ink">
                                  {request}
                                </div>
                              )}
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}
                    <section>
                      <h3 className="m-0 text-sm font-semibold text-ink">
                        {t("agent.authoring.skillOverview.files")}
                      </h3>
                      <p className="mt-2 mb-0 text-sm leading-6 text-muted">
                        {t("agent.authoring.skillOverview.fileCount", {
                          count: detail.resources.length,
                        })}
                      </p>
                    </section>
                  </div>
                </div>
              ),
            },
            {
              key: "files",
              label: t("agent.authoring.skillFiles"),
              children: (
                <div className="h-full min-h-0 overflow-hidden">
                  <SkillContentBrowser
                    compact={compact}
                    workspaceId={workspaceId}
                    value={detail.instructions}
                    resources={detail.resources}
                    source={source}
                    {...(selection ? { selection } : {})}
                  />
                </div>
              ),
            },
          ]}
          onChange={setActiveView}
        />
      </div>
    </div>
  );
}
