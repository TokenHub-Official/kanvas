import { AppstoreOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { toolLibrary } from "./library-api.js";
import type { VisualIdentitySymbol } from "@kanvas/contracts/api";
import { VisualIdentityMark } from "../../components/visual-identity-symbol.js";
export function ToolArtwork({
  imageId,
  workspaceId,
  cover = false,
  compact = false,
  symbol,
}: {
  imageId: string | null;
  workspaceId?: string;
  cover?: boolean;
  compact?: boolean;
  symbol?: VisualIdentitySymbol | null | undefined;
}): React.JSX.Element {
  const image = useQuery({
    queryKey: ["tool-image", workspaceId ?? "admin", imageId],
    queryFn: () => toolLibrary.image(imageId!, workspaceId),
    enabled: Boolean(imageId) && (!symbol || cover),
    staleTime: 60_000,
    retry: false,
  });
  if (symbol && !cover)
    return (
      <span className="block h-full w-full [container-type:inline-size]">
        <VisualIdentityMark
          value={symbol}
          alt=""
          className="h-full w-full rounded-[inherit] text-[clamp(16px,52cqw,80px)]"
        />
      </span>
    );
  return image.data ? (
    <img
      alt=""
      draggable={false}
      src={`data:image/png;base64,${image.data.contentBase64}`}
      className={
        cover
          ? "h-full w-full object-cover"
          : `h-full w-full object-contain ${compact ? "" : "p-[18%]"}`
      }
    />
  ) : (
    <div
      className={`flex h-full w-full items-center justify-center bg-mist text-primary ${compact ? "text-xl" : "text-5xl"}`}
    >
      <AppstoreOutlined />
    </div>
  );
}
