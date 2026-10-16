import { describe, expect, it } from "vitest";

import {
  getProviderDefinition,
  providerDefinitions,
} from "../src/provider-definition/index.js";

describe("Provider definitions", () => {
  it("keeps every built-in Provider identity and executable default unique", () => {
    expect(new Set(providerDefinitions.map(({ slug }) => slug)).size).toBe(
      providerDefinitions.length,
    );
    expect(providerDefinitions.every(({ logoPath }) => Boolean(logoPath))).toBe(
      true,
    );
    const defaultBaseUrls = providerDefinitions
      .map(({ slug }) => getProviderDefinition(slug).defaultBaseUrl)
      .filter((value): value is string => typeof value === "string");
    expect(new Set(defaultBaseUrls).size).toBe(providerDefinitions.length - 1);
    expect(
      providerDefinitions.every(({ allowCustomBaseUrl }) => allowCustomBaseUrl),
    ).toBe(true);
    expect(getProviderDefinition("newapi").defaultBaseUrl).toBeUndefined();
    expect(getProviderDefinition("tokenhub")).toMatchObject({
      catalogPath: "/v1/models",
      regionCode: "us",
      agentTextTransports: [
        {
          apiSurface: "chat.completions.v1",
          protocolKind: "openai_chat",
        },
        { apiSurface: "responses.v1", protocolKind: "openai_responses" },
        {
          apiSurface: "generate-content.v1",
          protocolKind: "gemini_generate_content",
        },
        { apiSurface: "messages.v1", protocolKind: "anthropic_messages" },
      ],
    });
    expect(getProviderDefinition("openai").agentTextTransports).toEqual([
      { apiSurface: "responses.v1", protocolKind: "openai_responses" },
      { apiSurface: "chat.completions.v1", protocolKind: "openai_chat" },
    ]);
    expect(getProviderDefinition("gemini").agentTextTransports).toEqual([
      {
        apiSurface: "generate-content.v1",
        protocolKind: "gemini_generate_content",
      },
    ]);
    expect(getProviderDefinition("anthropic")).toMatchObject({
      adapterKind: "anthropic_native",
      catalogPath: "/models?limit=1000",
      modelsDevProviderKey: "anthropic",
      agentTextTransports: [
        { apiSurface: "messages.v1", protocolKind: "anthropic_messages" },
      ],
    });
  });
});
