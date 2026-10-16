import { createLink } from "@tanstack/react-router";
import { Button } from "antd";

// Router reserves `type`; use Ant Design color/variant for action emphasis.
export const ActionLink = createLink(Button);
