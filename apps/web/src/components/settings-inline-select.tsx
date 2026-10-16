import { CheckOutlined, DownOutlined } from "@ant-design/icons";
import { Dropdown, type MenuProps } from "antd";
import { useState, type MouseEvent, type ReactNode } from "react";

import { SettingsPopconfirm } from "./settings-popconfirm.js";

export interface SettingsInlineSelectOption<TValue extends string> {
  readonly disabled?: boolean;
  readonly label: ReactNode;
  readonly value: TValue;
}

const pillClassName =
  "inline-flex h-8 w-auto min-w-0 items-center justify-center rounded-full border-0 bg-primary-soft px-3 text-xs font-semibold text-primary";

export function SettingsValuePill({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  return (
    <span className={pillClassName}>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

export function SettingsInlineSelect<TValue extends string>({
  disabled,
  confirmation,
  label,
  onSelect,
  options,
  value,
}: {
  readonly disabled?: boolean;
  readonly confirmation?: {
    readonly cancelText: ReactNode;
    readonly okText: ReactNode;
    readonly title: (value: TValue) => ReactNode;
  };
  readonly label: string;
  readonly onSelect: (value: TValue) => void;
  readonly options: readonly SettingsInlineSelectOption<TValue>[];
  readonly value: TValue;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [pendingValue, setPendingValue] = useState<TValue>();

  function createMenuItem(
    option: SettingsInlineSelectOption<TValue>,
  ): NonNullable<MenuProps["items"]>[number] {
    function cancelPendingSelection(
      event: MouseEvent<HTMLElement> | undefined,
    ): void {
      event?.stopPropagation();
      setPendingValue(undefined);
    }

    function confirmPendingSelection(
      event: MouseEvent<HTMLElement> | undefined,
    ): void {
      event?.stopPropagation();
      setPendingValue(undefined);
      setOpen(false);
      onSelect(option.value);
    }

    return {
      ...(option.disabled === true ? { disabled: true } : {}),
      key: option.value,
      label: (
        <SettingsPopconfirm
          cancelText={confirmation?.cancelText}
          okText={confirmation?.okText}
          onCancel={cancelPendingSelection}
          onConfirm={confirmPendingSelection}
          open={confirmation !== undefined && pendingValue === option.value}
          placement="right"
          title={confirmation?.title(option.value) ?? ""}
          trigger={[]}
        >
          <span className="flex w-full min-w-32 items-center justify-between gap-6">
            <span>{option.label}</span>
            {option.value === value ? (
              <CheckOutlined aria-hidden="true" className="text-muted" />
            ) : null}
          </span>
        </SettingsPopconfirm>
      ),
    };
  }

  function updateDropdownVisibility(
    nextOpen: boolean,
    info: { source: "menu" | "trigger" },
  ): void {
    if (confirmation && info.source === "menu") {
      return;
    }
    if (!nextOpen) {
      setPendingValue(undefined);
    }
    setOpen(nextOpen);
  }

  const items: NonNullable<MenuProps["items"]> = options.map(createMenuItem);

  return (
    <Dropdown
      {...(disabled === undefined ? {} : { disabled })}
      destroyOnHidden
      menu={{
        classNames: {
          item: "text-left",
          itemContent: "w-full",
        },
        items,
        onClick: ({ key }) => {
          const selectedValue = key as TValue;
          if (confirmation) {
            setPendingValue(selectedValue);
            return;
          }
          setOpen(false);
          onSelect(selectedValue);
        },
      }}
      onOpenChange={updateDropdownVisibility}
      open={open}
      placement="bottomLeft"
      trigger={["click"]}
    >
      <button
        aria-label={label}
        className={`${pillClassName} justify-between cursor-pointer disabled:cursor-not-allowed disabled:opacity-55`}
        disabled={disabled}
        onClick={(event) => {
          event.stopPropagation();
        }}
        type="button"
      >
        <span className="min-w-0 truncate">
          {options.find((option) => option.value === value)?.label}
        </span>
        <DownOutlined aria-hidden="true" className="ml-2 text-[10px]" />
      </button>
    </Dropdown>
  );
}
