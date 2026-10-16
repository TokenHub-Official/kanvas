import { HomeOutlined, ReloadOutlined } from "@ant-design/icons";
import {
  createRootRoute,
  Outlet,
  useRouterState,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useTranslation } from "react-i18next";

import serverCogIcon from "../assets/icons/ant-design/SettingOutlined.svg";
import signpostIcon from "../assets/icons/ant-design/CompassOutlined.svg";
import { DoodleIcon } from "../components/doodle-icon.js";
import { useRouteHeadingFocus } from "../components/page-focus.js";
import {
  PublicEntryShell,
  PublicResult,
} from "../components/public-entry-shell.js";
import { ToastProvider } from "../components/toast.js";
import { useDocumentTitle } from "../components/use-document-title.js";

function RootLayout(): React.JSX.Element {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  useRouteHeadingFocus(pathname);
  return (
    <ToastProvider>
      <Outlet />
    </ToastProvider>
  );
}

function RootError({ reset }: ErrorComponentProps): React.JSX.Element {
  const { t } = useTranslation();
  useDocumentTitle(t("publicEntry.state.pageUnavailableTitle"));
  return (
    <PublicEntryShell>
      <PublicResult
        description={t("publicEntry.state.pageUnavailableDescription")}
        icon={
          <DoodleIcon
            aspectRatio="170 / 133"
            className="h-[72px] w-auto"
            source={serverCogIcon}
          />
        }
        primaryAction={{
          icon: <ReloadOutlined />,
          iconPlacement: "start",
          label: t("publicEntry.state.reload"),
          onClick: reset,
        }}
        secondaryAction={{
          icon: <HomeOutlined />,
          iconPlacement: "start",
          label: t("common.returnHome"),
          onClick: () => {
            window.location.assign("/");
          },
        }}
        title={t("publicEntry.state.pageUnavailableTitle")}
        tone="danger"
        visualVariant="illustration"
      />
    </PublicEntryShell>
  );
}

function RootNotFound(): React.JSX.Element {
  const { t } = useTranslation();
  useDocumentTitle(t("publicEntry.state.notFoundTitle"));
  return (
    <PublicEntryShell>
      <PublicResult
        description={t("publicEntry.state.notFoundDescription")}
        icon={
          <DoodleIcon
            aspectRatio="159 / 180"
            className="h-[72px] w-auto"
            source={signpostIcon}
          />
        }
        primaryAction={{
          icon: <HomeOutlined />,
          iconPlacement: "start",
          label: t("common.returnHome"),
          onClick: () => {
            window.location.assign("/");
          },
        }}
        title={t("publicEntry.state.notFoundTitle")}
        visualVariant="illustration"
      />
    </PublicEntryShell>
  );
}

export const rootRoute = createRootRoute({
  component: RootLayout,
  errorComponent: RootError,
  notFoundComponent: RootNotFound,
});
