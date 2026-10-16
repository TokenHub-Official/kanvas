import { ExclamationCircleFilled } from "@ant-design/icons";
import { Popconfirm, type PopconfirmProps } from "antd";

export function SettingsPopconfirm({
  children,
  icon = <ExclamationCircleFilled style={{ color: "var(--warning-bright)" }} />,
  placement = "top",
  ...properties
}: Omit<PopconfirmProps, "styles">): React.JSX.Element {
  return (
    <Popconfirm
      destroyOnHidden
      icon={icon}
      placement={placement}
      styles={{
        container: {
          padding: 14,
        },
        root: {
          maxWidth: 360,
        },
      }}
      {...properties}
    >
      {children}
    </Popconfirm>
  );
}
