import { StyleProvider } from "@ant-design/cssinjs";
import { App as AntApp, ConfigProvider } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { kanvasTheme } from "./kanvas-theme.js";

export function KanvasThemeProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const { i18n } = useTranslation();
  const antLocale = i18n.resolvedLanguage === "en-US" ? enUS : zhCN;

  return (
    <StyleProvider layer>
      <ConfigProvider
        button={{ autoInsertSpace: false }}
        locale={antLocale}
        theme={kanvasTheme}
        variant="filled"
      >
        <AntApp
          message={{ maxCount: 3, top: 24 }}
          notification={{ placement: "bottomRight", maxCount: 3, bottom: 24 }}
        >
          {children}
        </AntApp>
      </ConfigProvider>
    </StyleProvider>
  );
}
