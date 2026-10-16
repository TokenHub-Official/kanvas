import { useEffect } from "react";

let cancelPendingHeadingFocus: (() => void) | undefined;
let lastObservedRoutePath: string | undefined;
const PAGE_HEADING_FOCUS_TIMEOUT_MS = 10_000;

export function routePathNeedsHeadingFocus(
  previousPath: string,
  currentPath: string,
): boolean {
  return previousPath !== currentPath && !routeOwnsInitialFocus(currentPath);
}

export function routeOwnsInitialFocus(pathname: string): boolean {
  return /^\/w\/[^/]+\/agent(?:\/|$)/u.test(pathname);
}

export function focusPageHeading(
  root: Pick<Document, "querySelector">,
): boolean {
  const target = root.querySelector<HTMLElement>(
    '[data-page-focus-target]:not([data-page-focus-target="false"]), h1:not([data-page-focus-target="false"])',
  );
  if (!target) {
    return false;
  }
  if (!target.hasAttribute("tabindex")) {
    target.setAttribute("tabindex", "-1");
  }
  target.focus();
  return true;
}

export function schedulePageHeadingFocus(): void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    return;
  }

  cancelPendingHeadingFocus?.();
  const frame = window.requestAnimationFrame(() => {
    const settledFrame = window.requestAnimationFrame(() => {
      if (focusPageHeading(document)) {
        cancelPendingHeadingFocus = undefined;
        return;
      }

      const observer = new MutationObserver(() => {
        if (!focusPageHeading(document)) {
          return;
        }
        cancelPendingHeadingFocus?.();
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
      const timeout = window.setTimeout(() => {
        cancelPendingHeadingFocus?.();
      }, PAGE_HEADING_FOCUS_TIMEOUT_MS);
      cancelPendingHeadingFocus = () => {
        observer.disconnect();
        window.clearTimeout(timeout);
        cancelPendingHeadingFocus = undefined;
      };
    });
    cancelPendingHeadingFocus = () => {
      window.cancelAnimationFrame(settledFrame);
      cancelPendingHeadingFocus = undefined;
    };
  });
  cancelPendingHeadingFocus = () => {
    window.cancelAnimationFrame(frame);
    cancelPendingHeadingFocus = undefined;
  };
}

export function useRouteHeadingFocus(pathname: string): void {
  useEffect(() => {
    const previousPath = lastObservedRoutePath;
    lastObservedRoutePath = pathname;
    if (routeOwnsInitialFocus(pathname)) {
      cancelPendingHeadingFocus?.();
      return;
    }
    if (
      previousPath !== undefined &&
      routePathNeedsHeadingFocus(previousPath, pathname)
    ) {
      schedulePageHeadingFocus();
    }
  }, [pathname]);
}
