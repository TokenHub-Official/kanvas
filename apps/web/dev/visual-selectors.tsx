import type {
  AgentHubAgentAvatar,
  VisualIdentitySymbol,
} from "@kanvas/contracts/api";
// Development-only scenario entry; never imported by the production application.
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";
import { BrandLogoPickerModal } from "../src/features/brand/brand-logo-picker";
import { ToolIconEditor } from "../src/features/external-tools/tool-icon-editor";
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { Button, Select } from "antd";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  VisualAssetPickerDialog,
  type VisualAssetOption,
} from "../src/components/visual-asset-picker-dialog";
import { AgentAvatarEditor } from "../src/components/agent-avatar-editor";
import { KanvasI18nProvider } from "../src/i18n/kanvas-i18n-provider";
import { KanvasThemeProvider } from "../src/theme/kanvas-theme-provider";
import "../src/styles.css";

const nativeFetch = window.fetch.bind(window);
let apiMode = "正常",
  apiCount = 60,
  listAttempts = 0,
  detailAttempts = 0;
const previewAttempts = new Map<string, number>();
window.fetch = async (input, init) => {
  const url = new URL(
    input instanceof Request ? input.url : String(input),
    location.href,
  );
  if (url.pathname.startsWith("/api/")) {
    const asset = (index: number) => ({
      id: "asset-" + index,
      assetKey: "asset-" + index,
      name: "品牌素材 " + (index + 1),
      lifecycleStatus: "active",
      currentArtifact: {
        id: "artifact-" + index,
        artifactType: "image.logo",
        availabilityStatus: "available",
        mediaType: "image/svg+xml",
      },
    });
    if (url.pathname === "/api/v1/assets") {
      listAttempts++;
      const cursor = Number(url.searchParams.get("cursor") || 0);
      if (
        (apiMode === "加载失败" && listAttempts === 1) ||
        (apiMode === "分页失败" && cursor && listAttempts === 2)
      )
        return Response.json({ title: "模拟加载失败" }, { status: 503 });
      const all = Array.from({ length: apiCount }, (_, i) => asset(i)).filter(
        (item) => item.name.includes(url.searchParams.get("q") || ""),
      );
      return Response.json({
        items: all.slice(cursor, cursor + 48),
        truncated: all.length > cursor + 48,
        ...(all.length > cursor + 48
          ? { nextCursor: String(cursor + 48) }
          : {}),
      });
    }
    if (url.pathname.endsWith("/preview")) {
      const attempt = (previewAttempts.get(url.pathname) || 0) + 1;
      previewAttempts.set(url.pathname, attempt);
      if (apiMode === "单图失败" && attempt === 1)
        return new Response("invalid image", {
          headers: { "content-type": "image/png" },
        });
      return new Response(
        '<svg xmlns="http://www.w3.org/2000/svg" width="280" height="120"><rect x="25" y="25" width="70" height="70" rx="16" fill="#5b4b8a"/><text x="110" y="70" font-size="32" fill="#5b4b8a">Atlas</text></svg>',
        { headers: { "content-type": "image/svg+xml" } },
      );
    }
    if (url.pathname.startsWith("/api/v1/assets/")) {
      detailAttempts++;
      if (apiMode === "确认失败" && detailAttempts === 1)
        return Response.json({ title: "模拟素材失效" }, { status: 404 });
      return Response.json(asset(Number(url.pathname.split("-").at(-1))));
    }
    return Response.json({ title: "模拟上传失败" }, { status: 503 });
  }
  return nativeFetch(input, init);
};
const names = [
  "Northstar 横向品牌标识",
  "苔原工作室 · 透明图标",
  "极光咖啡 / 竖版标志",
  "NOVA 白色反白标识",
  "Very long product brand name — 国际市场专用版本（保留完整名称）",
  "ORBIT 圆形品牌标识",
];
function Artwork({ index }: { index: number }) {
  const kind = index % 6;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={kind === 2 ? "0 0 100 180" : "0 0 280 160"}
      className="absolute inset-0 size-full object-contain p-4"
      aria-hidden="true"
    >
      {kind === 0 ? (
        <>
          <path
            d="M36 50l10 24 26 6-26 7-10 24-9-24L2 80l25-6z"
            fill="#2f4775"
          />
          <text
            x="82"
            y="93"
            fontSize="28"
            fill="#2f4775"
            fontFamily="system-ui"
          >
            Northstar
          </text>
        </>
      ) : null}
      {kind === 1 ? (
        <>
          <path
            d="M140 20C52 50 75 132 140 140c-5-36 18-58 44-75-12 38-27 52-44 75 74-28 69-93 0-120"
            fill="#28756c"
          />
        </>
      ) : null}
      {kind === 2 ? (
        <>
          <circle cx="50" cy="48" r="31" fill="#bc784c" />
          <circle
            cx="50"
            cy="48"
            r="18"
            fill="none"
            stroke="white"
            strokeWidth="3"
          />
          <text x="50" y="111" textAnchor="middle" fontSize="19" fill="#674c3a">
            AURORA
          </text>
          <text x="50" y="137" textAnchor="middle" fontSize="12" fill="#674c3a">
            COFFEE
          </text>
        </>
      ) : null}
      {kind === 3 ? (
        <text
          x="140"
          y="99"
          textAnchor="middle"
          fontSize="54"
          fontWeight="700"
          fill="white"
          fontFamily="system-ui"
        >
          NOVA
        </text>
      ) : null}
      {kind === 4 ? (
        <>
          <rect x="42" y="43" width="57" height="57" rx="14" fill="#5b4b8a" />
          <text
            x="115"
            y="86"
            fontSize="32"
            fill="#5b4b8a"
            fontFamily="system-ui"
          >
            Atlas
          </text>
        </>
      ) : null}
      {kind === 5 ? (
        <>
          <ellipse
            cx="140"
            cy="80"
            rx="63"
            ry="42"
            transform="rotate(-25 140 80)"
            fill="none"
            stroke="#394054"
            strokeWidth="9"
          />
          <circle cx="140" cy="80" r="21" fill="#394054" />
        </>
      ) : null}
    </svg>
  );
}
function FaultArtwork() {
  const [failed, setFailed] = useState(true);
  return failed ? (
    <div className="absolute inset-0 grid place-content-center justify-items-center gap-2 text-xs text-muted">
      <span>预览加载失败</span>
      <Button size="small" onClick={() => setFailed(false)}>
        重试预览
      </Button>
    </div>
  ) : (
    <Artwork index={0} />
  );
}
function Scene() {
  const [count, setCount] = useState(12),
    [scenario, setScenario] = useState("正常"),
    [open, setOpen] = useState(false),
    [query, setQuery] = useState(""),
    [limit, setLimit] = useState(48),
    [loading, setLoading] = useState(false),
    [error, setError] = useState<string>(),
    [moreError, setMoreError] = useState(false),
    [moreLoading, setMoreLoading] = useState(false),
    [denied, setDenied] = useState<string>(),
    [result, setResult] = useState("尚未应用"),
    [avatar, setAvatar] = useState<AgentHubAgentAvatar>({
      kind: "emoji",
      value: "🐱",
      backgroundColor: "#EEF2FF",
    });
  const [brandOpen, setBrandOpen] = useState(false);
  const [toolOpen, setToolOpen] = useState(false);
  const [toolSymbol, setToolSymbol] = useState<VisualIdentitySymbol>({
    kind: "icon",
    value: "robot",
    backgroundColor: "#EEF2FF",
  });
  const options: VisualAssetOption[] = Array.from(
    { length: count },
    (_, index) => ({
      id: `asset-${index}`,
      name: `${names[index % 6]}${index >= 6 ? ` · ${index + 1}` : ""}`,
      thumbnail:
        scenario === "单图失败" && index === 0 ? (
          <FaultArtwork />
        ) : (
          <Artwork index={index} />
        ),
      preview: <Artwork index={index} />,
      ...(scenario === "不可用素材" && index === 1
        ? { unavailableReason: "图片已移除" }
        : {}),
    }),
  );
  const allVisible = options.filter((item) =>
    item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const items = loading || error ? [] : allVisible.slice(0, limit);
  let moreState: "loading" | "error" | "ready" = "ready";
  if (moreLoading) moreState = "loading";
  else if (moreError) moreState = "error";
  function show() {
    setQuery("");
    setLimit(48);
    setDenied(undefined);
    setMoreError(false);
    setError(scenario === "加载失败" ? "暂时无法加载图片" : undefined);
    setOpen(true);
    if (scenario === "加载中") {
      setLoading(true);
      setTimeout(() => setLoading(false), 4000);
    } else setLoading(false);
    if (scenario === "权限变化")
      setTimeout(() => setDenied("访问权限已变化，请重新选择可用图片"), 2200);
  }
  return (
    <main className="mx-auto max-w-5xl space-y-5 p-8">
      <h1 className="text-2xl font-semibold">通用选择器 · 场景验收</h1>
      <p className="text-sm text-muted">
        真实组件与产品主题，使用模拟素材和故障响应，不连接业务数据库。
      </p>
      <div className="flex flex-wrap gap-3">
        <Select
          aria-label="素材数量"
          value={count}
          options={[0, 1, 3, 12, 60].map((value) => ({
            value,
            label: `${value} 张素材`,
          }))}
          onChange={setCount}
        />
        <Select
          aria-label="验收场景"
          value={scenario}
          options={[
            "正常",
            "加载中",
            "加载失败",
            "单图失败",
            "分页失败",
            "不可用素材",
            "权限变化",
            "确认失败",
            "已选在后页",
          ].map((value) => ({ value, label: value }))}
          onChange={setScenario}
        />
        <Button onClick={show}>打开素材选择器</Button>
        <Button
          onClick={() => {
            apiMode = scenario;
            apiCount = count;
            listAttempts = 0;
            detailAttempts = 0;
            previewAttempts.clear();
            setBrandOpen(true);
          }}
        >
          打开品牌接入
        </Button>
        <Button onClick={() => setToolOpen(true)}>打开工具图标</Button>
      </div>
      <p role="status">{result}</p>
      <div className="flex items-center gap-4">
        <AgentAvatarEditor
          canUpload
          canReadAssets={false}
          csrfToken="fixture"
          workspaceId="fixture"
          value={avatar}
          onChange={setAvatar}
        />
        <span className="text-sm text-muted">头像／图标编辑器</span>
      </div>
      <BrandLogoPickerModal
        open={brandOpen}
        applyLabel="应用品牌 Logo"
        workspaceId={scenario + count}
        onCancel={() => setBrandOpen(false)}
        onSelect={(item) => setResult("品牌已应用：" + item.name)}
      />
      {toolOpen ? (
        <ToolIconEditor
          symbol={toolSymbol}
          hasImage={false}
          imagePreview={null}
          onCancel={() => setToolOpen(false)}
          onConfirm={(selection) => {
            if (selection.kind === "symbol") setToolSymbol(selection.value);
            setResult("工具图标已应用");
            return Promise.resolve(true);
          }}
        />
      ) : null}
      {open ? (
        <VisualAssetPickerDialog
          title="选择 Logo"
          applyLabel="使用此 Logo"
          initialSelection={
            scenario === "已选在后页" ? (options.at(-1) ?? null) : null
          }
          {...(denied ? { permissionError: denied } : {})}
          source={{
            items,
            query,
            onQueryChange: (value) => {
              setQuery(value);
              setLimit(48);
            },
            loading,
            ...(error ? { error } : {}),
            onRetry: () => setError(undefined),
            ...(allVisible.length > limit
              ? {
                  more: {
                    state: moreState,
                    onLoad: () => {
                      if (scenario === "分页失败" && !moreError) {
                        setMoreError(true);
                        return;
                      }
                      setMoreLoading(true);
                      setTimeout(() => {
                        setLimit(limit + 48);
                        setMoreLoading(false);
                        setMoreError(false);
                      }, 500);
                    },
                  },
                }
              : {}),
          }}
          onCancel={() => setOpen(false)}
          onApply={(item) => {
            if (scenario === "确认失败")
              throw Error("所选图片已不可用，请选择其他图片");
            setResult(`已应用：${item.name}`);
          }}
        />
      ) : null}
    </main>
  );
}
const scenarioRouter = createRouter({
  routeTree: createRootRoute({ component: Scene }),
  history: createMemoryHistory({ initialEntries: ["/"] }),
});
createRoot(document.getElementById("root")!).render(
  <KanvasI18nProvider>
    <KanvasThemeProvider>
      <QueryClientProvider client={new QueryClient()}>
        <RouterProvider router={scenarioRouter} />
      </QueryClientProvider>
    </KanvasThemeProvider>
  </KanvasI18nProvider>,
);
