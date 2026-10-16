import { ConfigProvider, Tag, type TagProps, type ThemeConfig } from "antd";

import { cn } from "../lib/cn.js";

export type StatusTagTone =
  "danger" | "info" | "inverse" | "neutral" | "positive" | "warning";

const statusColor = {
  danger: "error",
  info: "processing",
  neutral: undefined,
  positive: "success",
  warning: "warning",
} as const;

const inverseStatusTagTheme: ThemeConfig = {
  token: {
    colorBorder: "var(--inverse-control-border-rest)",
    colorText: "var(--on-primary)",
  },
  components: {
    Tag: {
      defaultBg: "var(--inverse-surface-fill)",
      defaultColor: "var(--on-primary)",
    },
  },
};

export function StatusTag({
  className,
  tone = "neutral",
  ...properties
}: Omit<TagProps, "color" | "variant"> & {
  readonly tone?: StatusTagTone;
}): React.JSX.Element {
  const tagColor = tone === "inverse" ? undefined : statusColor[tone];
  const tag = (
    <Tag
      {...properties}
      {...(tagColor === undefined ? {} : { color: tagColor })}
      className={cn("m-0", className)}
      variant="filled"
    />
  );
  return tone === "inverse" ? (
    <ConfigProvider theme={inverseStatusTagTheme}>{tag}</ConfigProvider>
  ) : (
    tag
  );
}
