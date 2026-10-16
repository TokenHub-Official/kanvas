import { CheckOutlined } from "@ant-design/icons";
import { Select, type RefSelectProps, type SelectProps } from "antd";
import type { Ref } from "react";

type KanvasSelectProps = SelectProps & {
  readonly ref?: Ref<RefSelectProps>;
};

export function KanvasSelect({
  className,
  ref,
  ...properties
}: KanvasSelectProps) {
  return (
    <Select
      {...properties}
      {...(className === undefined ? {} : { className })}
      classNames={{
        popup: {
          root: "text-left",
        },
      }}
      menuItemSelectedIcon={<CheckOutlined aria-hidden="true" />}
      ref={ref}
      variant="filled"
    />
  );
}
