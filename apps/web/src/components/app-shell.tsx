import {
  CheckOutlined,
  DownOutlined,
  RightOutlined,
  GlobalOutlined,
  SafetyCertificateOutlined,
  SwapOutlined,
  UserOutlined,
  LogoutOutlined,
  MenuOutlined,
  ArrowLeftOutlined,
  PictureOutlined,
  PlusOutlined,
  RobotOutlined,
  ReadOutlined,
  SearchOutlined,
  SettingOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import type { CurrentHumanContext } from "@kanvas/contracts/api";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Alert,
  Button,
  ConfigProvider,
  Drawer,
  Dropdown,
  Modal,
  Popover,
  Select,
  theme,
  type MenuProps,
} from "antd";
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

import { authClient } from "../auth/auth-client.js";
import {
  clearWorkspacePreference,
  lastWorkspacePreferenceKey,
} from "../auth/entry-recovery.js";
import { performSignOut } from "../auth/sign-out.js";
import { isProductLocale, selectProductLocale } from "../i18n/i18n.js";
import { supportedLocaleDefinitions } from "../i18n/resources.js";
import { cn } from "../lib/cn.js";
import { queryClient } from "../query-client.js";
import { canvasImportFileIssue } from "../features/editor/canvas-import-file-validation.js";
import { stageCanvasImportFiles } from "../features/editor/canvas-import-handoff.js";
import {
  appShellRouteTitleKey,
  appShellSurface,
  conversationReturnPath,
  filterWorkspaceCandidates,
  shouldSearchWorkspaces,
  type AppShellWorkspace,
} from "./app-shell-model.js";
import {
  initialAppShellOverlayState,
  reduceAppShellOverlay,
} from "./app-shell-overlay-state.js";
import { ResourceNavigation } from "./resource-navigation.js";
import { ConversationSidebar } from "./conversation-sidebar.js";
import { Brand } from "./brand.js";
import { KanvasAvatar } from "./kanvas-avatar.js";
import { KanvasInput } from "./kanvas-input.js";
import { routeOwnsInitialFocus } from "./page-focus.js";
import { canAccessSettings } from "./settings-shell.js";
import { SkipLink } from "./skip-link.js";
import { useToast } from "./toast.js";
import { useDocumentTitle } from "./use-document-title.js";

type Workspace = CurrentHumanContext["workspaces"][number];
type MenuClickEvent = Parameters<NonNullable<MenuProps["onClick"]>>[0];

interface AppShellProps {
  readonly children: ReactNode;
  readonly sidebar?: (onNavigate: () => void) => ReactNode;
  readonly headerContent?: ReactNode;
  readonly context: CurrentHumanContext;
  readonly fullBleed?: boolean;
  readonly hideHeader?: boolean;
  readonly pageTitle: string;
  readonly workspace: Workspace;
}

// Above the containing Dropdown, whose Ant Design offset is 50.
const workspaceSwitcherPopupOffset = 60;

const headerPanelClassName =
  "w-full bg-paper md:w-80 md:overflow-hidden md:rounded-[16px] md:border md:border-line/70 md:p-2 md:shadow-float";

const headerPanelIdentityClassName = "rounded-[12px] bg-mist px-3 py-3";
const desktopMediaQuery = "(min-width: 768px)";
const compactWorkspaceDrawerHeight = 236;

function subscribeDesktop(onChange: () => void): () => void {
  const media = window.matchMedia(desktopMediaQuery);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

let lastAppShellPath: string | undefined;
let pendingAppShellFocusPath: string | undefined;

export function AppShell({
  children,
  sidebar,
  headerContent,
  context,
  fullBleed = false,
  hideHeader = false,
  pageTitle,
  workspace,
}: AppShellProps): React.JSX.Element {
  const { i18n, t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const mainContentRef = useRef<HTMLElement>(null);
  const createImageInputRef = useRef<HTMLInputElement>(null);
  const signOutInFlightRef = useRef(false);
  const [signingOut, setSigningOut] = useState(false);
  const [overlays, updateOverlays] = useReducer(
    reduceAppShellOverlay,
    initialAppShellOverlayState,
  );
  const {
    accountMenuOpen,
    createDialogOpen,
    createImportError,
    workspaceDrawerOpen,
    workspaceMenuOpen,
    workspaceQuery,
  } = overlays;
  useDocumentTitle(pageTitle);
  const path = useRouterState({
    select: (state) => state.location.pathname,
  });
  const basePath = `/w/${workspace.id}`;
  const routeTitleKey = appShellRouteTitleKey(path, basePath);
  const shellTitle = routeTitleKey
    ? t(`common.appShell.nav.${routeTitleKey}`)
    : pageTitle;
  const [navigationPath, setNavigationPath] = useState<string>();
  function closeNavigation(): void {
    setNavigationPath(undefined);
  }
  const desktop = useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(desktopMediaQuery).matches,
    () => true,
  );
  const navigationOpen = navigationPath === path;
  const surface = appShellSurface(path, basePath);
  const usesConversationNavigation =
    surface === "conversation" ||
    path === `${basePath}/tools` ||
    path.startsWith(`${basePath}/tools/`);
  const showSidebar =
    usesConversationNavigation ||
    (surface === "resources" && (!fullBleed || hideHeader));
  const conversationPreferenceKey = `kanvas:last-conversation:${workspace.id}`;
  const [previousConversation] = useState(() => {
    try {
      return sessionStorage.getItem(conversationPreferenceKey);
    } catch {
      return null;
    }
  });
  const returnToConversation = conversationReturnPath(
    previousConversation,
    basePath,
  );
  useEffect(() => {
    if (surface !== "conversation") return;
    try {
      sessionStorage.setItem(conversationPreferenceKey, path);
    } catch {
      /* Optional navigation preference. */
    }
  }, [surface, path, conversationPreferenceKey]);
  const shellSidebar = usesConversationNavigation ? (
    (sidebar?.(() => setNavigationPath(undefined)) ?? (
      <ConversationSidebar
        context={context}
        workspace={workspace}
        onNavigate={closeNavigation}
      />
    ))
  ) : (
    <ResourceNavigation
      workspaceId={workspace.id}
      permissions={workspace.permissions}
      path={path}
      returnTo={returnToConversation}
      onNavigate={closeNavigation}
    />
  );

  const canCreate =
    workspace.permissions.includes("canvas.write") &&
    workspace.permissions.includes("asset.write");
  const canStartConversation = workspace.permissions.includes("agent.run");
  const canCreateAgent =
    workspace.permissions.includes("agent.manage") &&
    workspace.permissions.includes("agent.publish");
  const canCreateSkill = workspace.permissions.includes("skill.manage");
  const canOpenCreateMenu =
    canCreate || canStartConversation || canCreateAgent || canCreateSkill;
  const initials = context.human.displayName
    .split(/\s+/u)
    .map((value) => value[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const filteredWorkspaces = useMemo(
    () => filterWorkspaceCandidates(context.workspaces, workspaceQuery),
    [context.workspaces, workspaceQuery],
  );
  const showWorkspaceSearch = shouldSearchWorkspaces(context.workspaces.length);

  useEffect(() => {
    window.localStorage.setItem(lastWorkspacePreferenceKey, workspace.id);
  }, [workspace.id]);

  useEffect(() => {
    const desktopMedia = window.matchMedia(desktopMediaQuery);
    const closePanelsAcrossBreakpoint = (): void => {
      updateOverlays({
        type: "breakpoint_changed",
        desktop: desktopMedia.matches,
      });
    };
    desktopMedia.addEventListener("change", closePanelsAcrossBreakpoint);
    return () =>
      desktopMedia.removeEventListener("change", closePanelsAcrossBreakpoint);
  }, []);

  useEffect(() => {
    const previousPath = lastAppShellPath;
    lastAppShellPath = path;
    if (routeOwnsInitialFocus(path)) {
      pendingAppShellFocusPath = undefined;
      return;
    }
    if (previousPath !== undefined && previousPath !== path) {
      pendingAppShellFocusPath = path;
    }
    if (pendingAppShellFocusPath !== path) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      mainContentRef.current?.focus({
        preventScroll: /^\/w\/[^/]+\/(?:agents|skills)(?:\/|$)/u.test(path),
      });
      if (pendingAppShellFocusPath === path) {
        pendingAppShellFocusPath = undefined;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [path]);

  function closeWorkspaceMenus(): void {
    updateOverlays({ type: "close_workspace_panels" });
  }

  function openSettings(): void {
    closeWorkspaceMenus();
    void navigate({
      params: { workspaceId: workspace.id },
      to: "/w/$workspaceId/settings",
    });
  }

  function selectWorkspace(workspaceId: string): void {
    closeWorkspaceMenus();
    if (workspaceId === workspace.id) {
      return;
    }
    void navigate({
      params: { workspaceId },
      to: "/w/$workspaceId",
    });
  }

  function signOut(): void {
    if (signOutInFlightRef.current) {
      return;
    }
    setSigningOut(true);
    void performSignOut({
      lock: signOutInFlightRef,
      onFailure: () => {
        setSigningOut(false);
        toast.notify({
          title: t("common.appShell.account.signOutErrorTitle"),
          description: t("common.appShell.account.signOutErrorDescription"),
          tone: "danger",
        });
      },
      onRevoked: () => {
        queryClient.clear();
        clearWorkspacePreference(window.localStorage);
        window.location.assign("/login");
      },
      revoke: async () => {
        const result = await authClient.signOut();
        if (result.error) {
          throw new Error("Session revocation failed.");
        }
      },
    });
  }

  function openBlankCanvas(): void {
    updateOverlays({ type: "create_closed" });
    void navigate({
      params: {
        canvasDraftId: "new",
        workspaceId: workspace.id,
      },
      search: { importImage: false },
      to: "/w/$workspaceId/boards/$canvasDraftId",
    });
  }

  function importImages(files: readonly File[]): void {
    const issue = canvasImportFileIssue(files);
    if (issue) {
      updateOverlays({
        type: "create_import_failed",
        error: t(`studio.create.fileErrors.${issue}`),
      });
      return;
    }
    const importToken = stageCanvasImportFiles(files);
    updateOverlays({ type: "create_import_succeeded" });
    void navigate({
      params: {
        canvasDraftId: "new",
        workspaceId: workspace.id,
      },
      search: { importImage: true, importToken },
      to: "/w/$workspaceId/boards/$canvasDraftId",
    });
  }

  function updateWorkspaceMenuVisibility(open: boolean): void {
    updateOverlays({ type: "workspace_menu_changed", open });
  }

  function updateAccountMenuVisibility(open: boolean): void {
    if (!open && signOutInFlightRef.current) {
      return;
    }
    updateOverlays({ type: "account_menu_changed", open });
  }

  function selectCreateImages(event: ChangeEvent<HTMLInputElement>): void {
    const files = [...(event.target.files ?? [])];
    event.target.value = "";
    if (files.length > 0) {
      importImages(files);
    }
  }

  function updateWorkspaceQuery(query: string): void {
    updateOverlays({ type: "workspace_query_changed", query });
  }

  function openCreateDialog(): void {
    updateOverlays({ type: "create_opened" });
  }

  function closeCreateDialog(): void {
    updateOverlays({ type: "create_closed" });
  }

  function openWorkspaceDrawer(): void {
    updateOverlays({ type: "drawer_opened" });
  }

  function clearCreateImportError(): void {
    updateOverlays({ type: "create_error_cleared" });
  }

  const workspacePanel = (
    <WorkspaceMenuPanel
      canOpenSettings={canAccessSettings(workspace)}
      currentWorkspace={workspace}
      filteredWorkspaces={filteredWorkspaces}
      onOpenSettings={openSettings}
      onQueryChange={updateWorkspaceQuery}
      onSelectWorkspace={selectWorkspace}
      query={workspaceQuery}
      showSearch={showWorkspaceSearch}
      signingOut={signingOut}
      totalWorkspaces={context.workspaces.length}
    />
  );
  const currentLocale = isProductLocale(i18n.resolvedLanguage)
    ? i18n.resolvedLanguage
    : supportedLocaleDefinitions[0].locale;
  const accountItems: MenuProps["items"] = [
    {
      key: "linked-accounts",
      icon: <UserOutlined />,
      label: t("publicEntry.settings.personal"),
    },
    ...(context.instanceAdministrator
      ? [
          {
            key: "instance-access",
            icon: <SafetyCertificateOutlined />,
            label: t("instanceAccess.title"),
          },
        ]
      : []),
    { type: "divider" },
    {
      danger: true,
      disabled: signingOut,
      icon: <LogoutOutlined />,
      key: "sign-out",
      label: signingOut
        ? t("common.appShell.account.signingOut")
        : t("common.appShell.account.signOut"),
    },
  ];

  function selectAccountMenuItem({ key }: MenuClickEvent): void {
    if (isProductLocale(key)) {
      selectProductLocale(key);
      return;
    }
    if (key === "linked-accounts") {
      void navigate({ to: "/account" });
    }
    if (key === "instance-access") {
      void navigate({ to: "/admin/access" });
    }
    if (key === "sign-out") {
      signOut();
    }
  }

  return (
    <div
      className={cn(
        "min-h-screen bg-mist",
        showSidebar && "md:grid md:grid-cols-[260px_minmax(0,1fr)]",
      )}
      data-app-shell
    >
      <SkipLink targetId="kanvas-main-content" />

      {showSidebar ? (
        <aside className="sticky top-0 hidden h-dvh min-h-0 flex-col border-r border-line bg-mist md:flex">
          <Link
            aria-label={
              usesConversationNavigation
                ? t("common.appShell.returnToWorkbench")
                : "Kanvas"
            }
            className="flex h-[62px] shrink-0 items-center px-5"
            params={{ workspaceId: workspace.id }}
            to="/w/$workspaceId"
          >
            <Brand compact markSize="large" />
          </Link>
          <div className="min-h-0 flex-1">{desktop ? shellSidebar : null}</div>
        </aside>
      ) : null}

      <div className="min-w-0">
        {!hideHeader ? (
          <header className="sticky top-0 z-15 flex min-h-15.5 items-center justify-between gap-2 border-b border-line/70 bg-mist/90 px-3 py-2 backdrop-blur-xl md:gap-5 md:px-6 lg:px-7">
            {showSidebar ? (
              <Button
                className="md:hidden"
                onClick={() => setNavigationPath(path)}
                aria-label={t(
                  usesConversationNavigation
                    ? "agent.navigation.openHistory"
                    : "agent.navigation.manage",
                )}
                icon={<MenuOutlined />}
              />
            ) : (
              <Link
                to={returnToConversation}
                aria-label={t("common.appShell.returnToWorkbench")}
                className="flex shrink-0 items-center gap-2 rounded-control px-2 py-2 text-sm text-ink no-underline hover:bg-paper"
              >
                <ArrowLeftOutlined />
                {t("common.appShell.returnToWorkbench")}
              </Link>
            )}
            {headerContent ?? (
              <h1
                className="m-0 min-w-0 flex-1 truncate text-[15px] font-bold tracking-[-0.015em] text-ink"
                data-page-focus-target="false"
                id="app-shell-page-title"
              >
                {shellTitle}
              </h1>
            )}

            <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
              {surface !== "conversation" ? (
                <Button
                  type="text"
                  disabled={!canOpenCreateMenu}
                  onClick={openCreateDialog}
                  aria-label={t("common.appShell.nav.create")}
                  icon={<PlusOutlined />}
                />
              ) : null}
              <Dropdown
                destroyOnHidden
                menu={{ items: [] }}
                onOpenChange={updateWorkspaceMenuVisibility}
                open={workspaceMenuOpen}
                popupRender={() => workspacePanel}
                trigger={["click"]}
              >
                <Button
                  aria-expanded={workspaceMenuOpen}
                  aria-haspopup="menu"
                  aria-label={t("common.appShell.workspace.trigger", {
                    name: workspace.name,
                  })}
                  className="hidden h-11 items-center gap-2 rounded-[12px] px-2 md:flex md:min-w-44"
                  color={workspaceMenuOpen ? "primary" : "default"}
                  disabled={signingOut}
                  variant={workspaceMenuOpen ? "filled" : "text"}
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-[10px] bg-paper text-primary">
                    <TeamOutlined className="text-base" />
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <strong className="block max-w-32 truncate text-xs">
                      {workspace.name}
                    </strong>
                    <span className="mt-0.5 block max-w-32 truncate text-xs leading-none text-muted">
                      {t(`common.appShell.roles.${workspace.membership.role}`)}
                    </span>
                  </span>
                  <DownOutlined
                    className={cn(
                      "text-[10px] text-muted transition-transform duration-200",
                      workspaceMenuOpen && "rotate-180",
                    )}
                  />
                </Button>
              </Dropdown>

              <Button
                aria-label={t("common.appShell.workspace.trigger", {
                  name: workspace.name,
                })}
                className="shrink-0 md:hidden"
                color={workspaceDrawerOpen ? "primary" : "default"}
                disabled={signingOut}
                onClick={openWorkspaceDrawer}
                variant={workspaceDrawerOpen ? "filled" : "text"}
              >
                <TeamOutlined className="shrink-0 text-primary" />
                <span className="hidden max-w-24 truncate text-xs font-semibold sm:inline">
                  {workspace.name}
                </span>
                <DownOutlined
                  className={cn(
                    "shrink-0 text-xs text-muted transition-transform duration-200",
                    workspaceDrawerOpen && "rotate-180",
                  )}
                />
              </Button>

              <Dropdown
                destroyOnHidden
                menu={{
                  className: "border-0 bg-transparent p-0 shadow-none",
                  items: accountItems,
                  onClick: selectAccountMenuItem,
                  selectable: false,
                }}
                onOpenChange={updateAccountMenuVisibility}
                open={accountMenuOpen}
                popupRender={(menu) => (
                  <div
                    className={cn(
                      headerPanelClassName,
                      "w-80 max-w-[calc(100vw-24px)]",
                    )}
                  >
                    <div className={headerPanelIdentityClassName}>
                      <div className="flex min-w-0 items-center gap-3">
                        <KanvasAvatar className="shrink-0" size={36}>
                          <strong className="text-xs">{initials || "K"}</strong>
                        </KanvasAvatar>
                        <span className="min-w-0 flex-1">
                          <strong className="block truncate text-sm text-ink">
                            {context.human.displayName}
                          </strong>
                          {context.human.verifiedEmail ? (
                            <span className="mt-0.5 block truncate text-xs text-muted">
                              {context.human.verifiedEmail}
                            </span>
                          ) : null}
                        </span>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2 border-t border-line px-3 py-3">
                      <GlobalOutlined
                        aria-hidden="true"
                        className="w-4 shrink-0 text-muted"
                      />
                      <span className="flex-1 text-sm text-ink">
                        {t("common.appShell.account.language")}
                      </span>
                      <Select
                        aria-label={t("common.appShell.account.language")}
                        className="w-36"
                        size="small"
                        value={currentLocale}
                        options={supportedLocaleDefinitions.map(
                          ({ labelKey, locale }) => ({
                            label: t(labelKey),
                            value: locale,
                          }),
                        )}
                        onChange={(locale) => {
                          if (isProductLocale(locale))
                            selectProductLocale(locale);
                        }}
                      />
                    </div>
                    <div className="border-t border-line pt-2">{menu}</div>
                  </div>
                )}
                trigger={["click"]}
              >
                <Button
                  aria-expanded={accountMenuOpen}
                  aria-haspopup="menu"
                  aria-label={t("common.appShell.account.open", {
                    name: context.human.displayName,
                  })}
                  className="size-11 rounded-full p-0"
                  color={accountMenuOpen ? "primary" : "default"}
                  disabled={signingOut}
                  variant={accountMenuOpen ? "filled" : "text"}
                >
                  <KanvasAvatar size={36}>
                    <strong className="text-xs">{initials || "K"}</strong>
                  </KanvasAvatar>
                </Button>
              </Dropdown>
            </div>
          </header>
        ) : null}

        <main
          aria-labelledby="app-shell-page-title"
          className={cn(
            "min-h-[calc(100vh-62px)] min-w-0 focus:outline-none",
            fullBleed && "min-h-0",
            fullBleed && !hideHeader && "h-[calc(100dvh-62px)]",
            fullBleed && hideHeader && "h-dvh",
            !fullBleed && "px-4 pt-5 pb-8 md:px-7 md:pb-12 lg:px-8",
          )}
          data-page-focus-target={surface === "conversation" ? "false" : true}
          id="kanvas-main-content"
          ref={mainContentRef}
          tabIndex={-1}
        >
          {children}
        </main>
      </div>

      <Drawer
        title={t(
          usesConversationNavigation
            ? "agent.threads"
            : "agent.navigation.manage",
        )}
        open={navigationOpen && showSidebar}
        onClose={closeNavigation}
        placement="left"
        size={300}
        destroyOnHidden
        styles={{ body: { padding: 0 } }}
      >
        {!desktop && showSidebar ? shellSidebar : null}
      </Drawer>

      <Drawer
        className="md:hidden"
        destroyOnHidden
        onClose={closeWorkspaceMenus}
        open={workspaceDrawerOpen}
        placement="bottom"
        size={
          context.workspaces.length > 1 ? "70dvh" : compactWorkspaceDrawerHeight
        }
        styles={{
          body: {
            maxHeight: "calc(80dvh - 64px)",
            overflow: "auto",
            padding: 12,
          },
        }}
        title={t("common.appShell.workspace.drawerTitle")}
      >
        {workspacePanel}
      </Drawer>

      <Modal
        centered
        closable={{
          "aria-label": t("common.dialog.close"),
        }}
        destroyOnHidden
        footer={null}
        onCancel={closeCreateDialog}
        open={createDialogOpen}
        title={t("common.appShell.createDialog.title")}
        width={460}
      >
        <div className="grid gap-2 pt-2">
          {canStartConversation ? (
            <Link
              className="flex items-center gap-3 rounded-control bg-primary px-4 py-3 text-sm font-medium text-white no-underline hover:bg-primary-deep"
              params={{ workspaceId: workspace.id }}
              to="/w/$workspaceId/agent"
              onClick={closeCreateDialog}
            >
              <RobotOutlined aria-hidden="true" />
              {t("agent.newThread")}
            </Link>
          ) : null}
          {canCreateAgent ? (
            <Link
              className="flex items-center gap-3 rounded-control px-4 py-3 text-sm text-ink no-underline hover:bg-mist"
              params={{ workspaceId: workspace.id }}
              to="/w/$workspaceId/agents/new"
              onClick={closeCreateDialog}
            >
              <RobotOutlined aria-hidden="true" />
              {t("agent.hub.createAgent")}
            </Link>
          ) : null}
          {canCreateSkill ? (
            <Link
              className="flex items-center gap-3 rounded-control px-4 py-3 text-sm text-ink no-underline hover:bg-mist"
              params={{ workspaceId: workspace.id }}
              to="/w/$workspaceId/skills/new"
              onClick={closeCreateDialog}
            >
              <ReadOutlined aria-hidden="true" />
              {t("agent.hub.createSkill")}
            </Link>
          ) : null}
        </div>
        {canCreate ? (
          <>
            <input
              accept="image/jpeg,image/png,image/webp"
              hidden
              multiple
              onChange={selectCreateImages}
              ref={createImageInputRef}
              type="file"
            />
            <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3">
              <Button
                className="h-12 rounded-control text-sm"
                icon={<PictureOutlined className="text-xl" />}
                onClick={() => createImageInputRef.current?.click()}
                size="large"
              >
                {t("common.appShell.createDialog.openImage")}
              </Button>
              <Button
                className="h-12 rounded-control text-sm"
                icon={<PlusOutlined className="text-xl" />}
                onClick={openBlankCanvas}
                size="large"
              >
                {t("common.appShell.createDialog.blankCanvas")}
              </Button>
            </div>
            {createImportError ? (
              <Alert
                className="mt-3"
                closable={{
                  onClose: clearCreateImportError,
                }}
                showIcon
                title={createImportError}
                type="error"
              />
            ) : null}
          </>
        ) : null}
        {!canOpenCreateMenu ? (
          <Alert
            showIcon
            title={t("common.appShell.createDialog.readOnly")}
            type="info"
          />
        ) : null}
      </Modal>
    </div>
  );
}

function WorkspaceMenuPanel({
  canOpenSettings,
  currentWorkspace,
  filteredWorkspaces,
  onOpenSettings,
  onQueryChange,
  onSelectWorkspace,
  query,
  showSearch,
  signingOut,
  totalWorkspaces,
}: {
  readonly canOpenSettings: boolean;
  readonly currentWorkspace: AppShellWorkspace;
  readonly filteredWorkspaces: readonly AppShellWorkspace[];
  readonly onOpenSettings: () => void;
  readonly onQueryChange: (value: string) => void;
  readonly onSelectWorkspace: (workspaceId: string) => void;
  readonly query: string;
  readonly showSearch: boolean;
  readonly signingOut: boolean;
  readonly totalWorkspaces: number;
}): React.JSX.Element {
  const { t } = useTranslation();
  const { token } = theme.useToken();

  return (
    <div className={headerPanelClassName}>
      <div className={headerPanelIdentityClassName}>
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-9 shrink-0 place-items-center rounded-[10px] bg-paper text-primary">
            <TeamOutlined />
          </span>
          <span className="min-w-0 flex-1">
            <strong className="block truncate text-sm text-ink">
              {currentWorkspace.name}
            </strong>
            <span className="mt-0.5 block truncate text-xs text-muted">
              {currentWorkspace.organization.name}
              <span aria-hidden="true"> · </span>
              {t(`common.appShell.roles.${currentWorkspace.membership.role}`)}
            </span>
          </span>
        </div>
      </div>

      {canOpenSettings ? (
        <div className="mt-2 border-t border-line pt-2">
          <Button
            block
            className="h-10 justify-start rounded-[10px] px-3 font-medium"
            disabled={signingOut}
            icon={<SettingOutlined className="text-muted" />}
            onClick={onOpenSettings}
            type="text"
          >
            {t("common.appShell.workspace.settings")}
          </Button>
        </div>
      ) : null}

      {totalWorkspaces > 1 ? (
        <div className="mt-2 border-t border-line pt-2">
          <ConfigProvider
            theme={{
              components: {
                Popover: {
                  zIndexPopup:
                    token.zIndexPopupBase + workspaceSwitcherPopupOffset,
                },
              },
            }}
          >
            <Popover
              arrow={false}
              destroyOnHidden
              placement="leftTop"
              trigger={["click"]}
              content={
                <div className="w-72 max-w-[calc(100vw-48px)]">
                  {showSearch ? (
                    <div className="px-2 pb-2">
                      <KanvasInput
                        allowClear
                        aria-label={t("common.appShell.workspace.searchLabel")}
                        onChange={(event) =>
                          onQueryChange(event.currentTarget.value)
                        }
                        placeholder={t(
                          "common.appShell.workspace.searchPlaceholder",
                        )}
                        prefix={<SearchOutlined />}
                        value={query}
                      />
                    </div>
                  ) : null}
                  {filteredWorkspaces.length > 0 ? (
                    <div className="max-h-72 overflow-y-auto">
                      <ConfigProvider
                        theme={{
                          components: {
                            Button: { controlHeight: 56, borderRadius: 10 },
                          },
                        }}
                      >
                        <div
                          className="grid gap-1"
                          aria-label={t("common.appShell.workspace.switch")}
                        >
                          {filteredWorkspaces.map((candidate) => {
                            const selected =
                              candidate.id === currentWorkspace.id;
                            return (
                              <Button
                                block
                                key={candidate.id}
                                disabled={signingOut}
                                aria-pressed={selected}
                                color={selected ? "primary" : "default"}
                                variant={selected ? "filled" : "text"}
                                onClick={() => onSelectWorkspace(candidate.id)}
                              >
                                <span className="flex w-full min-w-0 items-center gap-3 text-left">
                                  <span
                                    className="grid size-4 shrink-0 place-items-center"
                                    aria-hidden="true"
                                  >
                                    {selected ? (
                                      <CheckOutlined />
                                    ) : (
                                      <TeamOutlined />
                                    )}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <strong className="block truncate text-sm font-medium leading-5">
                                      {candidate.name}
                                    </strong>
                                    <span className="block truncate text-xs font-normal leading-5 text-muted">
                                      {candidate.organization.name} ·{" "}
                                      {t(
                                        `common.appShell.roles.${candidate.membership.role}`,
                                      )}
                                    </span>
                                  </span>
                                </span>
                              </Button>
                            );
                          })}
                        </div>
                      </ConfigProvider>
                    </div>
                  ) : (
                    <p
                      className="m-0 px-3 py-5 text-center text-xs text-muted"
                      role="status"
                    >
                      {t("common.appShell.workspace.noResults")}
                    </p>
                  )}
                </div>
              }
            >
              <Button
                block
                className="h-10 justify-between px-3"
                disabled={signingOut}
                type="text"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <SwapOutlined aria-hidden="true" className="w-4 text-muted" />
                  <span>{t("common.appShell.workspace.switch")}</span>
                </span>
                <RightOutlined aria-hidden="true" />
              </Button>
            </Popover>
          </ConfigProvider>
        </div>
      ) : null}
    </div>
  );
}
