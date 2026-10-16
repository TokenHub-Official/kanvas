import { useEffect, useRef, useState, type ComponentProps } from "react";
import { useTranslation } from "react-i18next";

import { cn } from "../../lib/cn.js";
import { Plus, Trash2 } from "./canvas-icons-v1.js";
import { CanvasPageV1 } from "./canvas-node-renderer-v1.js";
import { stopCanvasChromeWheelV1 } from "./canvas-interaction-boundary-v1.js";

type CanvasPageStripPageV1 = ComponentProps<typeof CanvasPageV1>["page"];
type CanvasPageStripResourcesV1 = ComponentProps<
  typeof CanvasPageV1
>["resources"];

export function canvasPageNavigationTargetV1(
  pages: readonly CanvasPageStripPageV1[],
  activePageId: string,
  key: string,
): string | undefined {
  const activeIndex = pages.findIndex((page) => page.id === activePageId);
  if (activeIndex < 0 || pages.length === 0) return undefined;
  if (key === "Home") return pages[0]?.id;
  if (key === "End") return pages.at(-1)?.id;
  if (key === "ArrowLeft") return pages[Math.max(0, activeIndex - 1)]?.id;
  if (key === "ArrowRight") {
    return pages[Math.min(pages.length - 1, activeIndex + 1)]?.id;
  }
  return undefined;
}

export function canvasPageReorderDirectionV1(
  key: string,
  altKey: boolean,
  activeIndex: number,
  pageCount: number,
): "backward" | "forward" | undefined {
  if (!altKey) return undefined;
  if (key === "ArrowLeft" && activeIndex > 0) return "backward";
  if (key === "ArrowRight" && activeIndex < pageCount - 1) return "forward";
  return undefined;
}

export function CanvasPageStripV1({
  activePageId,
  canEdit,
  onActivatePage,
  onAddPage,
  onDeletePage,
  onMoveActivePageBackward,
  onMoveActivePageForward,
  onReorderPage,
  pages,
  resources,
}: {
  readonly activePageId: string;
  readonly canEdit: boolean;
  readonly onActivatePage: (pageId: string) => void;
  readonly onAddPage: () => void;
  readonly onDeletePage: (pageId: string) => void;
  readonly onMoveActivePageBackward: () => void;
  readonly onMoveActivePageForward: () => void;
  readonly onReorderPage: (pageId: string, targetIndex: number) => void;
  readonly pages: readonly CanvasPageStripPageV1[];
  readonly resources: CanvasPageStripResourcesV1;
}) {
  const { t } = useTranslation();
  const activeButtonRef = useRef<HTMLButtonElement | null>(null);
  const focusActiveAfterChangeRef = useRef(false);
  const [draggedPageId, setDraggedPageId] = useState<string>();
  const [dropTargetIndex, setDropTargetIndex] = useState<number>();

  useEffect(() => {
    activeButtonRef.current?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
    if (focusActiveAfterChangeRef.current) {
      focusActiveAfterChangeRef.current = false;
      activeButtonRef.current?.focus({ preventScroll: true });
    }
  }, [activePageId, pages.length]);

  function activateFromKeyboard(pageId: string) {
    if (pageId === activePageId) return;
    focusActiveAfterChangeRef.current = true;
    onActivatePage(pageId);
  }

  function resetDragState() {
    setDraggedPageId(undefined);
    setDropTargetIndex(undefined);
  }

  return (
    <div
      aria-label={t("canvas.editor.pages")}
      className="canvas-v1-page-strip pointer-events-auto flex min-w-0 items-start gap-1 overflow-x-auto rounded-xl border border-[var(--canvas-panel-line)] bg-[rgb(251_251_252_/_96%)] p-1.5 shadow-[0_6px_18px_rgb(16_18_28_/_10%)] [overscroll-behavior-inline:contain] [scrollbar-color:#c8c9d0_transparent] [scrollbar-width:thin] backdrop-blur-lg"
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDropTargetIndex(undefined);
        }
      }}
      onWheel={stopCanvasChromeWheelV1}
      role="toolbar"
    >
      {pages.map((candidate, index) => {
        const active = candidate.id === activePageId;
        const pageLabel = `${t("canvas.editor.pageNumber", {
          number: index + 1,
        })} · ${candidate.name}`;
        return (
          <div
            className={cn(
              "group/page-item relative flex-none rounded-[9px]",
              dropTargetIndex === index &&
                draggedPageId !== candidate.id &&
                "ring-2 ring-[#3048f5] ring-offset-1",
            )}
            data-active={active ? "true" : undefined}
            data-page-strip-item={candidate.id}
            key={candidate.id}
            onDragOver={(event) => {
              if (!canEdit || !draggedPageId) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setDropTargetIndex(index);
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (canEdit && draggedPageId && draggedPageId !== candidate.id) {
                onReorderPage(draggedPageId, index);
              }
              resetDragState();
            }}
          >
            <button
              aria-current={active ? "page" : undefined}
              aria-label={pageLabel}
              className={cn(
                "group/page grid w-20 grid-rows-[42px_16px] gap-0.5 rounded-lg border p-0.5 text-[10px] outline-none transition-[border-color,background-color,box-shadow,transform] duration-150 ease-out active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-[#8795ff] focus-visible:ring-offset-1",
                active
                  ? "border-[#3048f5] bg-[#f5f6ff] shadow-[0_1px_3px_rgb(48_72_245_/_18%)]"
                  : "border-transparent bg-transparent hover:border-[#d2d3da] hover:bg-[#f3f3f5]",
                canEdit && "cursor-grab active:cursor-grabbing",
              )}
              draggable={canEdit}
              onClick={() => onActivatePage(candidate.id)}
              onDragEnd={resetDragState}
              onDragStart={(event) => {
                setDraggedPageId(candidate.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", candidate.id);
              }}
              onKeyDown={(event) => {
                const reorderDirection = canEdit
                  ? canvasPageReorderDirectionV1(
                      event.key,
                      event.altKey,
                      index,
                      pages.length,
                    )
                  : undefined;
                if (reorderDirection) {
                  event.preventDefault();
                  if (reorderDirection === "backward") {
                    onMoveActivePageBackward();
                  } else {
                    onMoveActivePageForward();
                  }
                  return;
                }
                const targetPageId = canvasPageNavigationTargetV1(
                  pages,
                  activePageId,
                  event.key,
                );
                if (!targetPageId) return;
                event.preventDefault();
                activateFromKeyboard(targetPageId);
              }}
              ref={active ? activeButtonRef : undefined}
              title={pageLabel}
              type="button"
            >
              <span className="relative grid h-[42px] w-[72px] place-items-center overflow-hidden rounded-[5px] border border-[rgb(21_21_21_/_8%)] bg-[#e7e7eb] [&_svg]:h-auto [&_svg]:max-h-full [&_svg]:w-auto [&_svg]:max-w-full">
                <CanvasPageV1
                  clipToPage
                  page={candidate}
                  resources={resources}
                />
                <span className="absolute bottom-0.5 left-0.5 z-[2] min-w-4 rounded bg-[rgb(21_21_21_/_76%)] px-0.5 py-px text-center text-[9px] font-semibold leading-none tabular-nums text-white shadow-sm">
                  {index + 1}
                </span>
              </span>
              <span className="mx-auto max-w-[72px] truncate text-center text-[9px] leading-4 text-[#555660] group-aria-[current=page]/page:font-semibold group-aria-[current=page]/page:text-[#252630]">
                {candidate.name}
              </span>
            </button>

            {canEdit && pages.length > 1 ? (
              <button
                aria-label={`${t("canvas.editor.deletePage")} · ${candidate.name}`}
                className="pointer-events-none absolute top-1 right-1 z-[3] grid size-5 place-items-center rounded border border-[rgb(21_21_21_/_10%)] bg-[rgb(255_255_255_/_94%)] p-0 text-[10px] text-[#4f5059] opacity-0 shadow-[0_2px_6px_rgb(16_18_28_/_14%)] backdrop-blur transition-[background-color,color,opacity,transform] duration-150 ease-out group-hover/page-item:pointer-events-auto group-hover/page-item:opacity-100 hover:bg-[#fff1f0] hover:text-[#c9362b] active:scale-[0.94] focus-visible:pointer-events-auto focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[#8795ff]"
                onClick={() => {
                  focusActiveAfterChangeRef.current = true;
                  onDeletePage(candidate.id);
                }}
                title={t("canvas.editor.deletePage")}
                type="button"
              >
                <Trash2 aria-hidden="true" />
              </button>
            ) : null}
          </div>
        );
      })}

      <button
        aria-label={t("canvas.editor.addPage")}
        className="canvas-v1-add-page grid w-20 flex-none grid-rows-[42px_16px] gap-0.5 rounded-lg border border-transparent bg-transparent p-0.5 text-[#62636d] outline-none transition-[border-color,background-color,color,transform] duration-150 ease-out hover:border-[#d2d3da] hover:bg-[#f3f3f5] hover:text-[#252630] active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-[#8795ff] focus-visible:ring-offset-1"
        disabled={!canEdit}
        onClick={() => {
          focusActiveAfterChangeRef.current = true;
          onAddPage();
        }}
        type="button"
      >
        <span className="grid h-[42px] w-[72px] place-items-center rounded-[5px] border border-dashed border-[#aeb0ba] bg-white [&_svg]:size-4">
          <Plus aria-hidden="true" />
        </span>
        <span className="truncate text-center text-[9px] leading-4">
          {t("canvas.editor.addPage")}
        </span>
      </button>
    </div>
  );
}
