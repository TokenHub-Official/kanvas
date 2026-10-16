import { SearchOutlined } from "@ant-design/icons";
import { Input } from "antd";
import type { ComponentPropsWithRef } from "react";

import { cn } from "../lib/cn.js";

type KanvasInputProps = ComponentPropsWithRef<typeof Input>;

const controlFocusClassName =
  "transition-[background-color,box-shadow] focus-within:bg-[var(--control-fill-active)] focus-within:shadow-[var(--control-focus-shadow)] focus-visible:bg-[var(--control-fill-active)] focus-visible:outline-none focus-visible:shadow-[var(--control-focus-shadow)]";

export function KanvasInput({
  className,
  ref,
  ...properties
}: KanvasInputProps) {
  return (
    <Input
      {...properties}
      className={cn(controlFocusClassName, className)}
      ref={ref}
      variant="filled"
    />
  );
}

type PasswordInputProps = ComponentPropsWithRef<typeof Input.Password>;
type TextAreaProps = ComponentPropsWithRef<typeof Input.TextArea>;

export function KanvasPasswordInput({
  className,
  ref,
  ...properties
}: PasswordInputProps) {
  return (
    <Input.Password
      {...properties}
      className={cn(controlFocusClassName, className)}
      ref={ref}
      variant="filled"
    />
  );
}

export function KanvasTextArea({
  className,
  ref,
  ...properties
}: TextAreaProps) {
  return (
    <Input.TextArea
      {...properties}
      className={cn(controlFocusClassName, className)}
      ref={ref}
      variant="filled"
    />
  );
}

export function KanvasSearchInput({
  className,
  ref,
  suffix,
  ...properties
}: KanvasInputProps) {
  return (
    <Input
      {...properties}
      className={cn(controlFocusClassName, className)}
      ref={ref}
      suffix={suffix ?? <SearchOutlined aria-hidden="true" />}
      type="search"
      variant="filled"
    />
  );
}
