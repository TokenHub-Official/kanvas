import {
  Avatar,
  ConfigProvider,
  type AvatarProps,
  type ThemeConfig,
} from "antd";

const avatarThemes = {
  brand: {
    token: {
      colorTextLightSolid: "var(--primary)",
      colorTextPlaceholder: "var(--primary-soft)",
    },
  },
  ink: {
    token: {
      colorTextLightSolid: "var(--paper)",
      colorTextPlaceholder: "var(--ink)",
    },
  },
} satisfies Readonly<Record<"brand" | "ink", ThemeConfig>>;

export function KanvasAvatar({
  tone = "ink",
  ...properties
}: AvatarProps & {
  readonly tone?: keyof typeof avatarThemes;
}): React.JSX.Element {
  return (
    <ConfigProvider theme={avatarThemes[tone]}>
      <Avatar {...properties} />
    </ConfigProvider>
  );
}
