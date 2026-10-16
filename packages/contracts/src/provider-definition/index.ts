export type ProviderDefinitionSlug =
  | "openai"
  | "anthropic"
  | "openrouter"
  | "xai"
  | "gemini"
  | "newapi"
  | "tokenhub";

export type ProviderAgentTextTransport =
  | {
      readonly apiSurface: "chat.completions.v1";
      readonly protocolKind: "openai_chat";
    }
  | {
      readonly apiSurface: "responses.v1";
      readonly protocolKind: "openai_responses";
    }
  | {
      readonly apiSurface: "generate-content.v1";
      readonly protocolKind: "gemini_generate_content";
    }
  | {
      readonly apiSurface: "messages.v1";
      readonly protocolKind: "anthropic_messages";
    };

export interface ProviderDefinition {
  readonly slug: ProviderDefinitionSlug;
  readonly displayName: string;
  readonly adapterKind:
    | "openai_native"
    | "openrouter_native"
    | "openai_compatible"
    | "gemini_native"
    | "anthropic_native";
  readonly defaultBaseUrl?: string;
  readonly allowCustomBaseUrl: boolean;
  readonly regionCode: "global" | "us" | "private";
  readonly catalogPath: string;
  readonly catalogDiscoveryMethod: string;
  readonly modelsDevProviderKey?: string;
  readonly logoPath?: string;
  readonly agentTextTransports: readonly ProviderAgentTextTransport[];
}

export const providerDefinitions = Object.freeze([
  Object.freeze({
    slug: "openai",
    displayName: "OpenAI",
    adapterKind: "openai_native",
    defaultBaseUrl: "https://api.openai.com/v1",
    allowCustomBaseUrl: true,
    regionCode: "global",
    catalogPath: "/models",
    catalogDiscoveryMethod: "openai.models.list",
    modelsDevProviderKey: "openai",
    logoPath: "/provider-logos/openai.svg",
    agentTextTransports: Object.freeze([
      Object.freeze({
        apiSurface: "responses.v1",
        protocolKind: "openai_responses",
      }),
      Object.freeze({
        apiSurface: "chat.completions.v1",
        protocolKind: "openai_chat",
      }),
    ]),
  }),
  Object.freeze({
    slug: "anthropic",
    displayName: "Anthropic · Claude",
    adapterKind: "anthropic_native",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    allowCustomBaseUrl: true,
    regionCode: "global",
    catalogPath: "/models?limit=1000",
    catalogDiscoveryMethod: "anthropic.models.list",
    modelsDevProviderKey: "anthropic",
    logoPath: "/provider-logos/anthropic.svg",
    agentTextTransports: Object.freeze([
      Object.freeze({
        apiSurface: "messages.v1",
        protocolKind: "anthropic_messages",
      }),
    ]),
  }),
  Object.freeze({
    slug: "openrouter",
    displayName: "OpenRouter",
    adapterKind: "openrouter_native",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    allowCustomBaseUrl: true,
    regionCode: "global",
    catalogPath: "/images/models",
    catalogDiscoveryMethod: "openrouter.images.models",
    modelsDevProviderKey: "openrouter",
    logoPath: "/provider-logos/openrouter.svg",
    agentTextTransports: Object.freeze([
      Object.freeze({
        apiSurface: "chat.completions.v1",
        protocolKind: "openai_chat",
      }),
    ]),
  }),
  Object.freeze({
    slug: "xai",
    displayName: "xAI",
    adapterKind: "openai_compatible",
    defaultBaseUrl: "https://api.x.ai/v1",
    allowCustomBaseUrl: true,
    regionCode: "global",
    catalogPath: "/image-generation-models",
    catalogDiscoveryMethod: "xai.image-generation-models",
    modelsDevProviderKey: "xai",
    logoPath: "/provider-logos/xai.svg",
    agentTextTransports: Object.freeze([
      Object.freeze({
        apiSurface: "chat.completions.v1",
        protocolKind: "openai_chat",
      }),
    ]),
  }),
  Object.freeze({
    slug: "gemini",
    displayName: "Google · Gemini",
    adapterKind: "gemini_native",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    allowCustomBaseUrl: true,
    regionCode: "global",
    catalogPath: "/models?pageSize=1000",
    catalogDiscoveryMethod: "gemini.models.list",
    modelsDevProviderKey: "google",
    logoPath: "/provider-logos/google.svg",
    agentTextTransports: Object.freeze([
      Object.freeze({
        apiSurface: "generate-content.v1",
        protocolKind: "gemini_generate_content",
      }),
    ]),
  }),
  Object.freeze({
    slug: "newapi",
    displayName: "NewAPI",
    adapterKind: "openai_compatible",
    allowCustomBaseUrl: true,
    regionCode: "private",
    catalogPath: "/models",
    catalogDiscoveryMethod: "newapi.models.list",
    logoPath: "/provider-logos/newapi.png",
    agentTextTransports: Object.freeze([
      Object.freeze({
        apiSurface: "chat.completions.v1",
        protocolKind: "openai_chat",
      }),
    ]),
  }),
  Object.freeze({
    slug: "tokenhub",
    displayName: "TokenHub",
    adapterKind: "openai_compatible",
    defaultBaseUrl: "https://us-api.tokenhub.com",
    allowCustomBaseUrl: true,
    regionCode: "us",
    catalogPath: "/v1/models",
    catalogDiscoveryMethod: "tokenhub.models.list",
    logoPath: "/provider-logos/tokenhub.svg",
    agentTextTransports: Object.freeze([
      Object.freeze({
        apiSurface: "chat.completions.v1",
        protocolKind: "openai_chat",
      }),
      Object.freeze({
        apiSurface: "responses.v1",
        protocolKind: "openai_responses",
      }),
      Object.freeze({
        apiSurface: "generate-content.v1",
        protocolKind: "gemini_generate_content",
      }),
      Object.freeze({
        apiSurface: "messages.v1",
        protocolKind: "anthropic_messages",
      }),
    ]),
  }),
] as const satisfies readonly ProviderDefinition[]);

const providerDefinitionMap = new Map<
  ProviderDefinitionSlug,
  ProviderDefinition
>(providerDefinitions.map((definition) => [definition.slug, definition]));

export function getProviderDefinition(
  slug: ProviderDefinitionSlug,
): ProviderDefinition {
  const definition = providerDefinitionMap.get(slug);
  if (!definition) {
    throw new TypeError(`Unsupported Provider definition ${slug}.`);
  }
  return definition;
}
