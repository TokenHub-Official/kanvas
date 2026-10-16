import { useEffect, type ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

import { i18n } from "./i18n.js";

export function KanvasI18nProvider({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  useEffect(() => {
    function updateDocumentLanguage(language: string): void {
      document.documentElement.lang = language;
    }

    updateDocumentLanguage(i18n.resolvedLanguage ?? "zh-CN");
    i18n.on("languageChanged", updateDocumentLanguage);
    return () => {
      i18n.off("languageChanged", updateDocumentLanguage);
    };
  }, []);

  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}
