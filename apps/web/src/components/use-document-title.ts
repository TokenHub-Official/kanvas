import { useEffect } from "react";

const maximumPageTitleCharacters = 80;

export function productDocumentTitle(pageTitle?: string): string {
  const normalized = pageTitle?.trim().replace(/\s+/gu, " ");
  if (!normalized) {
    return "Kanvas";
  }

  const characters = [...normalized];
  const bounded =
    characters.length > maximumPageTitleCharacters
      ? `${characters.slice(0, maximumPageTitleCharacters - 1).join("")}…`
      : normalized;
  return `${bounded} · Kanvas`;
}

export function useDocumentTitle(pageTitle?: string): void {
  useEffect(() => {
    const previousTitle = document.title;
    const currentTitle = productDocumentTitle(pageTitle);
    document.title = currentTitle;
    return () => {
      if (document.title === currentTitle) document.title = previousTitle;
    };
  }, [pageTitle]);
}
