import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterContextProvider,
} from "@tanstack/react-router";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionLink } from "./action-link.js";

describe("ActionLink", () => {
  it("renders one styled anchor without a nested button", () => {
    const router = createRouter({
      routeTree: createRootRoute(),
      history: createMemoryHistory({ initialEntries: ["/"] }),
    });
    const html = renderToStaticMarkup(
      <RouterContextProvider router={router}>
        <ActionLink
          color="primary"
          variant="solid"
          to="/w/$workspaceId/agents"
          params={{ workspaceId: "workspace" }}
        >
          管理 Agents
        </ActionLink>
      </RouterContextProvider>,
    );
    expect(html).toContain('href="/w/workspace/agents"');
    expect(html).toContain("ant-btn-color-primary");
    expect(html).toContain("ant-btn-variant-solid");
    expect(html).not.toContain("<button");
  });
});
