import { ArrowLeftOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

import blankCanvasIllustration from "../assets/icons/ant-design/LayoutOutlined.svg";
import { DoodleIcon } from "../components/doodle-icon.js";
import { productDocumentTitle } from "../components/use-document-title.js";

export const boardEditorMediaQuery = "(min-width: 768px)";

export const boardDesktopRequiredTitleId = "board-desktop-required-title";
export const boardDesktopStageId = "canvas-design-stage";

export function boardViewportFocusTargetId(desktopViewport: boolean): string {
  return desktopViewport ? boardDesktopStageId : boardDesktopRequiredTitleId;
}

export function focusBoardViewportSurface(desktopViewport: boolean): void {
  document
    .getElementById(boardViewportFocusTargetId(desktopViewport))
    ?.focus({ preventScroll: true });
}

type BoardViewportAccess = {
  readonly desktopContentLoaded: boolean;
  readonly desktopViewport: boolean;
};

function initialBoardViewportAccess(): BoardViewportAccess {
  const desktopViewport =
    typeof window !== "undefined" &&
    window.matchMedia(boardEditorMediaQuery).matches;
  return {
    desktopContentLoaded: desktopViewport,
    desktopViewport,
  };
}

export function useBoardDesktopAccess(): BoardViewportAccess {
  const [access, setAccess] = useState(initialBoardViewportAccess);

  useEffect(() => {
    const desktopMedia = window.matchMedia(boardEditorMediaQuery);
    const updateViewportAccess = (): void => {
      setAccess((current) => ({
        desktopContentLoaded:
          current.desktopContentLoaded || desktopMedia.matches,
        desktopViewport: desktopMedia.matches,
      }));
    };
    desktopMedia.addEventListener("change", updateViewportAccess);
    return () =>
      desktopMedia.removeEventListener("change", updateViewportAccess);
  }, []);

  return access;
}

export function BoardDesktopRequired({
  onBack,
}: {
  readonly onBack: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const documentTitle = t("canvas.desktopGate.documentTitle");
  useEffect(() => {
    const previousTitle = document.title;
    document.title = productDocumentTitle(documentTitle);
    return () => {
      document.title = previousTitle;
    };
  }, [documentTitle]);

  return (
    <main className="relative grid min-h-[100dvh] overflow-x-hidden bg-mist px-5 py-8 text-ink sm:px-8 sm:py-12">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full border border-primary/12"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-28 -left-20 size-56 rounded-full bg-primary-soft/70"
      />
      <section
        aria-labelledby={boardDesktopRequiredTitleId}
        className="relative z-1 mx-auto grid w-full max-w-[560px] place-items-center self-center text-center"
      >
        <div
          aria-hidden="true"
          className="relative mb-8 grid h-[190px] w-full max-w-[330px] place-items-end overflow-hidden rounded-[28px] bg-primary px-8 pt-7 text-on-primary shadow-[0_24px_64px_rgb(32_29_52_/_14%)]"
        >
          <span className="absolute top-6 right-6 size-24 rounded-full border border-white/16" />
          <span className="absolute right-0 bottom-0 h-1.5 w-2/3 bg-focus-acid" />
          <DoodleIcon
            aspectRatio="241 / 211"
            className="relative h-[166px] w-auto text-white drop-shadow-[0_18px_28px_rgb(11_22_113_/_24%)]"
            source={blankCanvasIllustration}
          />
        </div>
        <h1
          className="m-0 text-[clamp(28px,7vw,40px)] leading-[1.08] font-bold tracking-[-0.04em]"
          data-page-focus-target
          id={boardDesktopRequiredTitleId}
          tabIndex={-1}
        >
          {t("canvas.desktopGate.title")}
        </h1>
        <p className="mt-4 max-w-[46ch] text-ui-body leading-6 text-muted">
          {t("canvas.desktopGate.description")}
        </p>
        <Button
          className="!mt-7"
          icon={<ArrowLeftOutlined aria-hidden="true" />}
          onClick={onBack}
          size="large"
          type="primary"
        >
          {t("canvas.backToStudio")}
        </Button>
      </section>
    </main>
  );
}

export function BoardViewportDecision({
  children,
  desktopContentLoaded,
  desktopViewport,
  onBack,
}: {
  readonly children: ReactNode;
  readonly desktopContentLoaded: boolean;
  readonly desktopViewport: boolean;
  readonly onBack: () => void;
}): React.JSX.Element {
  return (
    <>
      {desktopContentLoaded ? (
        <div className="h-[100dvh] w-full" hidden={!desktopViewport}>
          {children}
        </div>
      ) : null}
      {!desktopViewport ? <BoardDesktopRequired onBack={onBack} /> : null}
    </>
  );
}

export function BoardViewportGate({
  children,
  onBack,
}: {
  readonly children: ReactNode;
  readonly onBack: () => void;
}): React.JSX.Element {
  const access = useBoardDesktopAccess();
  const previousDesktopViewportRef = useRef(access.desktopViewport);

  useEffect(() => {
    if (previousDesktopViewportRef.current === access.desktopViewport) {
      return;
    }
    previousDesktopViewportRef.current = access.desktopViewport;
    focusBoardViewportSurface(access.desktopViewport);
  }, [access.desktopViewport]);

  return (
    <BoardViewportDecision
      desktopContentLoaded={access.desktopContentLoaded}
      desktopViewport={access.desktopViewport}
      onBack={onBack}
    >
      {children}
    </BoardViewportDecision>
  );
}
