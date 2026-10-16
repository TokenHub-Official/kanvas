import type { EditorCatalogReferenceV1 } from "@kanvas/contracts/editor";
import { LeftOutlined, SearchOutlined } from "@ant-design/icons";
import type {
  AriaAttributes,
  ComponentType,
  DragEvent,
  ReactNode,
} from "react";

import type { EditorNodeInsertionPayload } from "./editor-node-insertion.js";

export type CanvasIconSpec = ComponentType<{
  readonly "aria-hidden"?: AriaAttributes["aria-hidden"];
  readonly className?: string;
}>;

export const backIconSpec = LeftOutlined;
export const searchIconSpec = SearchOutlined;

export function CanvasPanelIcon({
  className,
  icon,
}: {
  readonly className?: string;
  readonly icon: CanvasIconSpec;
}): React.JSX.Element {
  const Icon = icon;
  return <Icon aria-hidden="true" {...(className ? { className } : {})} />;
}

export function CanvasPanelSection({
  children,
  title,
}: {
  readonly children: ReactNode;
  readonly title: string;
}) {
  return (
    <section className="grid gap-2.5 [&+&]:mt-[22px]">
      <h3 className="m-0 text-xs font-bold text-[#45464f]">{title}</h3>
      {children}
    </section>
  );
}

export function canvasCatalogReferenceV1(
  catalogId: string,
  definitionId: string,
  revision: string,
): EditorCatalogReferenceV1 {
  return {
    catalogId,
    definitionId,
    revision,
  };
}

export function canvasCatalogDragPropsV1(
  payload: EditorNodeInsertionPayload,
  onStart: (payload: EditorNodeInsertionPayload) => void,
  onEnd: () => void,
) {
  return {
    draggable: true,
    onDragStart: (event: DragEvent<HTMLButtonElement>) => {
      event.dataTransfer.effectAllowed = "copy";
      event.dataTransfer.setData(
        "application/x-kanvas-catalog-node",
        payload.kind,
      );
      onStart(payload);
    },
    onDragEnd: onEnd,
  } as const;
}
