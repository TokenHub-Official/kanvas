import { modelReferenceFeedback } from "./model-reference-feedback.js";
import {
  ArrowRightOutlined,
  AudioOutlined,
  EditOutlined,
  FilePdfOutlined,
  FontSizeOutlined,
  PictureOutlined,
  PlusOutlined,
  ReloadOutlined,
  UnorderedListOutlined,
  VideoCameraOutlined,
} from "@ant-design/icons";
import type {
  CanonicalModelSummary,
  ModelReferenceDefaults,
  ProviderSettingSummary,
  PublishProviderModelBody,
} from "@kanvas/contracts/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  Button,
  Checkbox,
  Dropdown,
  Drawer,
  Form,
  Switch,
  Table,
  type TableColumnsType,
} from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import {
  ApiProblem,
  fetchWorkspaceCapabilityDefinitions,
  fetchWorkspaceAgentModelSettings,
  fetchWorkspaceModels,
  publishWorkspaceProviderModel,
  refreshWorkspaceProviderModelCatalog,
  importWorkspaceProviderModels,
  fetchWorkspaceProviderSettings,
  syncWorkspaceModelReference,
  updateWorkspaceAgentModelSettings,
} from "../../api/transport.js";
import { workspaceQueryKeys } from "../../api/query-keys.js";
import {
  EmptyState,
  InlineNotice,
  LoadingState,
} from "../../components/feedback.js";
import { KanvasInput, KanvasTextArea } from "../../components/kanvas-input.js";
import { KanvasSelect } from "../../components/kanvas-select.js";
import { useSettingsNotification } from "../../components/settings-notification.js";
import { StatusTag } from "../../components/status-tag.js";
import { validProviderPricingAmount } from "./provider-activation-pricing.js";
import { ProviderLogo } from "./provider-logo.js";
import { providerSettingsError } from "./provider-settings-runtime.js";

import {
  imageModelOperations,
  mergeImageModelParameters,
  type ImageModelOperations,
} from "./model-parameter-update.js";

type ProviderLink = CanonicalModelSummary["providers"][number];
type PricingMode = "fixed" | "metered" | "provider_reported";
type Modality = "text" | "image" | "audio" | "video" | "pdf";
type ReasoningLevel = "low" | "medium" | "high";
type AgentTextTransport = NonNullable<
  PublishProviderModelBody["agentTextTransport"]
>;

interface ModelEditorState {
  readonly imageOperations?: ImageModelOperations;
  readonly modelId: string;
  readonly providerModelId: string;
  readonly displayName: string;
  readonly family: string;
  readonly description: string;
  readonly inputModalities: readonly Modality[];
  readonly outputModalities: readonly Modality[];
  readonly contextWindow: string;
  readonly maximumInputTokens?: string;
  readonly maximumOutputTokens: string;
  readonly attachment?: boolean;
  readonly reasoning?: boolean;
  readonly reasoningLevels: readonly ReasoningLevel[];
  readonly webSearch: boolean;
  readonly toolCall?: boolean;
  readonly structuredOutput?: boolean;
  readonly temperature?: boolean;
  readonly agentTextTransport?: AgentTextTransport;
  readonly pricingMode: PricingMode;
  readonly fixedCharge: string;
  readonly inputPrice: string;
  readonly cacheReadPrice: string;
  readonly cacheWritePrice: string;
  readonly outputPrice: string;
  readonly maximumCharge: string;
}

function positiveTokenLimit(value: string): number | undefined {
  const parsed = Number(value);
  return /^\d+$/u.test(value) && Number.isSafeInteger(parsed) && parsed > 0
    ? parsed
    : undefined;
}
const httpServiceUnavailable = 503;
const modalities: readonly Modality[] = [
  "text",
  "image",
  "audio",
  "video",
  "pdf",
];

function agentTextTransportKey(transport: AgentTextTransport): string {
  return `${transport.apiSurface}:${transport.protocolKind}`;
}

function agentTextTransportLabel(transport: AgentTextTransport): string {
  switch (transport.protocolKind) {
    case "openai_chat":
      return "OpenAI Chat Completions";
    case "openai_responses":
      return "OpenAI Responses";
    case "gemini_generate_content":
      return "Gemini Generate Content";
    case "anthropic_messages":
      return "Anthropic Messages";
  }
}

function ModalityMark({
  modality,
  withLabel = false,
}: {
  readonly modality: Modality;
  readonly withLabel?: boolean;
}): React.JSX.Element {
  const { t } = useTranslation();
  let icon: React.JSX.Element;
  let iconTone: string;
  let boxTone: string;
  switch (modality) {
    case "text":
      icon = <FontSizeOutlined />;
      iconTone = "text-blue-600";
      boxTone = "border-blue-500/25 bg-blue-500/10";
      break;
    case "image":
      icon = <PictureOutlined />;
      iconTone = "text-violet-600";
      boxTone = "border-violet-500/25 bg-violet-500/10";
      break;
    case "audio":
      icon = <AudioOutlined />;
      iconTone = "text-emerald-600";
      boxTone = "border-emerald-500/25 bg-emerald-500/10";
      break;
    case "video":
      icon = <VideoCameraOutlined />;
      iconTone = "text-fuchsia-600";
      boxTone = "border-fuchsia-500/25 bg-fuchsia-500/10";
      break;
    case "pdf":
      icon = <FilePdfOutlined />;
      iconTone = "text-red-600";
      boxTone = "border-red-500/25 bg-red-500/10";
      break;
  }
  const label = t(`settings.models.modalities.${modality}`);
  if (withLabel) {
    return (
      <span
        aria-label={label}
        className="inline-flex items-center gap-1.5 text-sm text-ink"
        title={label}
      >
        <span aria-hidden="true" className={iconTone}>
          {icon}
        </span>
        <span>{label}</span>
      </span>
    );
  }
  return (
    <span
      aria-label={label}
      className={`inline-flex size-7 shrink-0 items-center justify-center rounded-[7px] border text-sm ${boxTone} ${iconTone}`}
      title={label}
    >
      <span aria-hidden="true">{icon}</span>
    </span>
  );
}

function ModelModalityFlow({
  model,
}: {
  readonly model: CanonicalModelSummary;
}): React.JSX.Element | string {
  const { t } = useTranslation();
  if (!model.profile) return "-";
  return (
    <div
      aria-label={t("settings.models.modalityFlow", {
        inputs: model.profile.inputModalities
          .map((modality) => t(`settings.models.modalities.${modality}`))
          .join(", "),
        outputs: model.profile.outputModalities
          .map((modality) => t(`settings.models.modalities.${modality}`))
          .join(", "),
      })}
      className="flex items-center gap-1.5"
    >
      <div className="flex gap-1">
        {model.profile.inputModalities.map((modality) => (
          <ModalityMark key={modality} modality={modality} />
        ))}
      </div>
      <ArrowRightOutlined aria-hidden="true" className="mx-1 text-muted" />
      <div className="flex gap-1">
        {model.profile.outputModalities.map((modality) => (
          <ModalityMark key={modality} modality={modality} />
        ))}
      </div>
    </div>
  );
}

export function modelOperations(
  editor: ModelEditorState,
  provider: ProviderLink,
) {
  const text =
    provider.supportedOperations.includes("text.generate") ||
    (provider.supportedOperations.length === 0 &&
      provider.supportedAgentTextTransports.length > 0 &&
      editor.outputModalities.includes("text"));
  const textParameters = [
    ...(editor.reasoning && editor.reasoningLevels.length > 0
      ? [
          {
            key: "reasoningEffort",
            label: "Reasoning effort",
            required: false,
            valueType: "enum" as const,
            values: [...editor.reasoningLevels],
          },
        ]
      : []),
    ...(editor.webSearch &&
    editor.agentTextTransport?.protocolKind !== "openai_chat"
      ? [
          {
            key: "webSearch",
            label: "Web search",
            required: false,
            valueType: "boolean" as const,
          },
        ]
      : []),
  ];
  return {
    ...(text ? { "text.generate": { parameters: textParameters } } : {}),
    ...(editor.imageOperations ?? imageModelOperations(provider.operations)),
  };
}

function pricing(editor: ModelEditorState, provider: ProviderLink) {
  const maximumChargeAmount = editor.maximumCharge.trim() || "1";
  if (editor.pricingMode === "fixed") {
    return {
      providerModelId: provider.upstreamModelId,
      billingMode: "fixed" as const,
      fixedChargeAmount: editor.fixedCharge,
    };
  }
  if (editor.pricingMode === "provider_reported") {
    return {
      providerModelId: provider.upstreamModelId,
      billingMode: "provider_reported" as const,
      maximumChargeAmount,
    };
  }
  return {
    providerModelId: provider.upstreamModelId,
    billingMode: "metered" as const,
    rates: [
      {
        metricKey:
          editor.cacheReadPrice.trim() || editor.cacheWritePrice.trim()
            ? "input_tokens_no_cache"
            : "input_tokens",
        unitCode: "token",
        quantity: "1000000",
        amount: editor.inputPrice,
      },
      ...(editor.cacheReadPrice.trim()
        ? [
            {
              metricKey: "cache_read_tokens",
              unitCode: "token",
              quantity: "1000000",
              amount: editor.cacheReadPrice,
            },
          ]
        : []),
      ...(editor.cacheWritePrice.trim()
        ? [
            {
              metricKey: "cache_write_tokens",
              unitCode: "token",
              quantity: "1000000",
              amount: editor.cacheWritePrice,
            },
          ]
        : []),
      {
        metricKey: "output_tokens",
        unitCode: "token",
        quantity: "1000000",
        amount: editor.outputPrice,
      },
    ],
    maximumChargeAmount,
  } satisfies PublishProviderModelBody["pricing"];
}

export function editorFrom(model: CanonicalModelSummary): ModelEditorState {
  const profile = model.profile;
  const provider =
    model.providers.find((item) => item.lifecycle === "active") ??
    model.providers[0];
  const agentTextTransport =
    provider?.agentTextTransport ?? provider?.supportedAgentTextTransports[0];
  const textParameters = profile?.operations["text.generate"]?.parameters ?? [];
  const reasoningParameter = textParameters.find(
    (parameter) => parameter.key === "reasoningEffort",
  );
  const reasoningLevels =
    reasoningParameter?.valueType === "enum"
      ? reasoningParameter.values.filter(
          (value): value is ReasoningLevel =>
            value === "low" || value === "medium" || value === "high",
        )
      : [];
  return {
    modelId: model.id,
    imageOperations: imageModelOperations(
      profile?.operations ??
        Object.fromEntries(
          Object.entries(provider?.operations ?? {}).filter(([key]) =>
            provider?.supportedOperations.some(
              (operation) => operation === key,
            ),
          ),
        ),
    ),
    providerModelId: provider?.id ?? "",
    displayName:
      profile?.displayName ?? model.slug.split("/").at(-1) ?? model.slug,
    family: profile?.family ?? model.slug.split("/").at(-1) ?? model.slug,
    description: profile?.description ?? model.slug,
    inputModalities:
      profile?.inputModalities ??
      (provider?.supportedOperations.includes("image.edit")
        ? ["text", "image"]
        : ["text"]),
    outputModalities:
      profile?.outputModalities ??
      (provider?.supportedOperations.some(
        (operation) =>
          operation === "image.generate" || operation === "image.edit",
      )
        ? ["image"]
        : ["text"]),
    contextWindow: String(profile?.contextWindow ?? ""),
    ...(profile?.maximumInputTokens === undefined
      ? {}
      : { maximumInputTokens: String(profile.maximumInputTokens) }),
    maximumOutputTokens: String(profile?.maximumOutputTokens ?? ""),
    ...(profile?.attachment === undefined
      ? {}
      : { attachment: profile.attachment }),
    ...(profile?.reasoning === undefined
      ? {}
      : { reasoning: profile.reasoning }),
    reasoningLevels,
    webSearch: textParameters.some(
      (parameter) => parameter.key === "webSearch",
    ),
    ...(profile?.toolCall === undefined ? {} : { toolCall: profile.toolCall }),
    ...(profile?.structuredOutput === undefined
      ? {}
      : { structuredOutput: profile.structuredOutput }),
    ...(profile?.temperature === undefined
      ? {}
      : { temperature: profile.temperature }),
    ...(agentTextTransport ? { agentTextTransport } : {}),
    pricingMode:
      provider?.providerPreset === "tokenhub" &&
      provider.providerReportedPricingAvailable
        ? "provider_reported"
        : "metered",
    fixedCharge: provider?.maximumCharge?.amount ?? "0.01",
    inputPrice: "1",
    cacheReadPrice: "",
    cacheWritePrice: "",
    outputPrice: "3",
    maximumCharge: provider?.maximumCharge?.amount ?? "",
  };
}

export function ModelControlPlanePanel({
  canManageApplications,
  csrfToken,
  providers,
  workspaceId,
}: {
  readonly canManageApplications: boolean;
  readonly csrfToken: string;
  readonly providers: readonly ProviderSettingSummary[];
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useSettingsNotification();
  const queryClient = useQueryClient();
  const context = { csrfToken, workspaceId };
  const modelsKey = workspaceQueryKeys.models(workspaceId);
  const capabilityDefinitionsKey =
    workspaceQueryKeys.capabilityDefinitions(workspaceId);
  const models = useQuery({
    queryKey: modelsKey,
    queryFn: () => fetchWorkspaceModels(workspaceId),
    retry: false,
  });
  const capabilitySources = useQuery({
    queryKey: capabilityDefinitionsKey,
    queryFn: () => fetchWorkspaceCapabilityDefinitions(workspaceId),
    retry: false,
  });
  const agentSettingsKey = workspaceQueryKeys.agentModelSettings(workspaceId);
  const agentSettings = useQuery({
    enabled: canManageApplications,
    queryKey: agentSettingsKey,
    queryFn: () => fetchWorkspaceAgentModelSettings(context),
    retry: false,
  });
  const [editor, setEditor] = useState<ModelEditorState>();
  const [referenceNotice, setReferenceNotice] = useState<{
    modelId: string;
    providerModelId: string;
    summary: string;
    details: readonly string[];
    failed: boolean;
  }>();
  const [parameterPreview, setParameterPreview] = useState<{
    modelId: string;
    providerModelId: string;
    before: ImageModelOperations;
    merged: ImageModelOperations;
    preserved: string[];
  }>();
  const updateParameters = useMutation({
    mutationFn: async () => {
      if (!editor) throw new Error("Model editor is not open.");
      const selected = models.data?.models.find(
        (model) => model.id === editor.modelId,
      );
      const provider = selected?.providers.find(
        (item) => item.id === editor.providerModelId,
      );
      if (!provider) throw new Error("Selected model is unavailable.");
      const settings = await fetchWorkspaceProviderSettings(workspaceId);
      const connection = settings.providers.find(
        (item) => item.id === provider.providerSettingId,
      );
      if (!connection) throw new Error("Selected Provider is unavailable.");
      await refreshWorkspaceProviderModelCatalog(
        context,
        connection.id,
        { expectedVersion: connection.version },
        crypto.randomUUID(),
      );
      await importWorkspaceProviderModels(context, connection.id, {
        upstreamModelIds: [provider.upstreamModelId],
      });
      const refreshed = await fetchWorkspaceModels(workspaceId);
      const incoming = refreshed.models
        .find((model) => model.id === editor.modelId)
        ?.providers.find((item) => item.id === provider.id);
      if (!incoming) throw new Error("Updated model is unavailable.");
      return {
        modelId: editor.modelId,
        providerModelId: provider.id,
        base: imageModelOperations(provider.operations),
        incoming: imageModelOperations(incoming.operations),
        refreshed,
      };
    },
    onSuccess: (result) => {
      queryClient.setQueryData(modelsKey, result.refreshed);
      if (
        !editor ||
        editor.modelId !== result.modelId ||
        editor.providerModelId !== result.providerModelId
      )
        return;
      const before = editor.imageOperations ?? result.base;
      const update = mergeImageModelParameters(
        result.base,
        before,
        result.incoming,
      );
      if (!update.changed && update.preserved.length === 0) {
        toast.notify({
          title: t("settings.models.parameters.upToDate"),
          tone: "positive",
        });
        return;
      }
      setParameterPreview({
        modelId: result.modelId,
        providerModelId: result.providerModelId,
        before,
        merged: update.merged,
        preserved: update.preserved,
      });
    },
    onError: async (error) => {
      await queryClient.invalidateQueries({ queryKey: modelsKey });
      toast.notify({
        title: t("settings.models.parameters.failed"),
        description: providerSettingsError(error),
        tone: "danger",
      });
    },
  });
  const [selectedDefaultModelId, setSelectedDefaultModelId] =
    useState<string>();
  const [selectedFastModelId, setSelectedFastModelId] = useState<string>();
  const [selectedReasoningLevel, setSelectedReasoningLevel] = useState<
    "off" | "low" | "medium" | "high"
  >();
  const [selectedWebSearchMode, setSelectedWebSearchMode] = useState<
    "off" | "auto" | "required"
  >();
  const [selectedActionConfirmation, setSelectedActionConfirmation] =
    useState<boolean>();
  const selectActionConfirmation = (checked: boolean): void => {
    setSelectedActionConfirmation(checked);
  };
  const selectDefaultModel = (value: unknown): void => {
    setSelectedDefaultModelId(String(value));
  };
  const selectFastModel = (value: unknown): void => {
    setSelectedFastModelId(String(value));
  };
  const selectReasoningLevel = (value: unknown): void => {
    setSelectedReasoningLevel(value as "off" | "low" | "medium" | "high");
  };

  const applyReference = (
    current: ModelEditorState,
    reference: ModelReferenceDefaults,
  ): ModelEditorState => {
    const cost = reference.cost;
    return {
      ...current,
      displayName: reference.displayName ?? current.displayName,
      family: reference.family ?? current.family,
      description: reference.description ?? current.description,
      inputModalities: reference.inputModalities?.length
        ? reference.inputModalities
        : current.inputModalities,
      outputModalities: reference.outputModalities?.length
        ? reference.outputModalities
        : current.outputModalities,
      contextWindow: String(reference.contextWindow ?? current.contextWindow),
      ...(reference.maximumInputTokens === undefined
        ? {}
        : { maximumInputTokens: String(reference.maximumInputTokens) }),
      maximumOutputTokens: String(
        reference.maximumOutputTokens ?? current.maximumOutputTokens,
      ),
      ...(reference.attachment === undefined
        ? {}
        : { attachment: reference.attachment }),
      ...(reference.reasoning === undefined
        ? {}
        : { reasoning: reference.reasoning }),
      ...(reference.toolCall === undefined
        ? {}
        : { toolCall: reference.toolCall }),
      ...(reference.structuredOutput === undefined
        ? {}
        : { structuredOutput: reference.structuredOutput }),
      ...(reference.temperature === undefined
        ? {}
        : { temperature: reference.temperature }),
      inputPrice: cost?.input ? String(cost.input) : current.inputPrice,
      cacheReadPrice:
        cost?.cacheRead === undefined
          ? current.cacheReadPrice
          : String(cost.cacheRead),
      cacheWritePrice:
        cost?.cacheWrite === undefined
          ? current.cacheWritePrice
          : String(cost.cacheWrite),
      outputPrice: cost?.output ? String(cost.output) : current.outputPrice,
    };
  };

  const openEditor = async (model: CanonicalModelSummary) => {
    setReferenceNotice(undefined);
    const next = editorFrom(model);
    setEditor(next);
    if (model.profile) return;
    try {
      const result = await syncWorkspaceModelReference(context, model.id, {
        providerModelId: next.providerModelId,
      });
      if (result.defaults) setEditor(applyReference(next, result.defaults));
    } catch {
      // Existing Provider values remain editable when reference data is unavailable.
    }
  };
  const selectToolCallSupport = (value: unknown) => {
    setEditor((current) => {
      if (!current) return current;
      const { toolCall, ...rest } = current;
      void toolCall;
      return value === "unknown"
        ? rest
        : { ...rest, toolCall: value === "supported" };
    });
  };
  const openFirstSelectableModel = () => {
    const model = selectableModels[0];
    if (model) void openEditor(model);
  };
  const selectEditorModel = (value: unknown) => {
    const model = selectableModels.find((candidate) => candidate.id === value);
    if (model) void openEditor(model);
  };

  const syncReference = useMutation({
    mutationFn: async () => {
      if (!editor) {
        throw new Error(t("settings.models.validation.editorNotOpen"));
      }
      const model = models.data?.models.find(
        (candidate) => candidate.id === editor.modelId,
      );
      if (!model) throw new Error(t("settings.models.validation.model"));
      const result = await syncWorkspaceModelReference(context, model.id, {
        providerModelId: editor.providerModelId,
        force: true,
      });
      const next = result.defaults
        ? applyReference(editor, result.defaults)
        : undefined;
      const changed = next
        ? Object.keys(next).filter(
            (key) =>
              JSON.stringify(next[key as keyof ModelEditorState]) !==
              JSON.stringify(editor[key as keyof ModelEditorState]),
          ).length
        : 0;
      return { result, next, changed };
    },
    onSuccess: ({ result, next, changed }) => {
      if (next) setEditor(next);
      const feedback = modelReferenceFeedback(
        result,
        changed,
        next?.outputModalities.includes("text") ??
          editor?.outputModalities.includes("text") ??
          false,
      );
      const details: string[] = [];
      if (result.warnings.includes("pricing_conflict"))
        details.push(t("settings.models.reference.pricingConflict"));
      if (result.warnings.includes("metadata_conflict"))
        details.push(t("settings.models.reference.metadataConflict"));
      if (feedback.missing.length && result.status !== "not_found")
        details.push(
          t("settings.models.reference.missingFields", {
            fields: feedback.missing
              .map((key) => t(`settings.models.fields.${key}`))
              .join(", "),
          }),
        );
      if (result.stale) details.push(t("settings.models.reference.stale"));
      const summary =
        result.status === "not_found"
          ? t("settings.models.reference.notFound")
          : t(
              changed > 0
                ? "settings.models.reference.draftSummary"
                : "settings.models.reference.noChanges",
              { count: changed },
            );
      if (result.status === "not_found")
        details.push(t("settings.models.reference.unavailable"));
      if (editor)
        setReferenceNotice({
          modelId: editor.modelId,
          providerModelId: editor.providerModelId,
          summary,
          details,
          failed: false,
        });
    },
    onMutate: () => setReferenceNotice(undefined),
    onError: (error) => {
      if (editor)
        setReferenceNotice({
          modelId: editor.modelId,
          providerModelId: editor.providerModelId,
          summary: t("settings.models.reference.syncFailed"),
          details: [
            error instanceof ApiProblem &&
            error.status === httpServiceUnavailable
              ? t("settings.models.reference.sourceUnavailable")
              : providerSettingsError(error),
          ],
          failed: true,
        });
    },
  });

  const save = useMutation({
    mutationFn: async () => {
      if (!editor) {
        throw new Error(t("settings.models.validation.editorNotOpen"));
      }
      const model = models.data?.models.find(
        (candidate) => candidate.id === editor.modelId,
      );
      if (!model) throw new Error(t("settings.models.validation.model"));
      const provider = model.providers.find(
        (candidate) => candidate.id === editor.providerModelId,
      );
      if (!provider) {
        throw new Error(t("settings.models.validation.provider"));
      }
      if (
        editor.pricingMode === "provider_reported" &&
        !provider.providerReportedPricingAvailable
      ) {
        throw new Error(t("settings.models.validation.pricingMode"));
      }
      const contextWindow = positiveTokenLimit(editor.contextWindow);
      const maximumOutputTokens = positiveTokenLimit(
        editor.maximumOutputTokens,
      );
      const maximumInputTokens =
        editor.maximumInputTokens === undefined ||
        editor.maximumInputTokens === ""
          ? undefined
          : positiveTokenLimit(editor.maximumInputTokens);
      if (
        (editor.outputModalities.includes("text") &&
          (!contextWindow || !maximumOutputTokens)) ||
        (editor.contextWindow && !contextWindow) ||
        (editor.maximumOutputTokens && !maximumOutputTokens) ||
        (editor.maximumInputTokens && !maximumInputTokens)
      ) {
        throw new Error(t("settings.models.validation.tokenLimits"));
      }
      return publishWorkspaceProviderModel(
        context,
        provider.providerSettingId,
        provider.id,
        {
          expectedVersion: provider.version,
          profile: {
            expectedVersion: model.version,
            displayName: editor.displayName.trim(),
            family: editor.family.trim(),
            description: editor.description.trim(),
            inputModalities: [...editor.inputModalities],
            outputModalities: [...editor.outputModalities],
            ...(contextWindow === undefined ? {} : { contextWindow }),
            ...(maximumInputTokens === undefined ? {} : { maximumInputTokens }),
            ...(maximumOutputTokens === undefined
              ? {}
              : { maximumOutputTokens }),
            ...(editor.attachment === undefined
              ? {}
              : { attachment: editor.attachment }),
            ...(editor.reasoning === undefined
              ? {}
              : { reasoning: editor.reasoning }),
            ...(editor.toolCall === undefined
              ? {}
              : { toolCall: editor.toolCall }),
            ...(editor.structuredOutput === undefined
              ? {}
              : { structuredOutput: editor.structuredOutput }),
            ...(editor.temperature === undefined
              ? {}
              : { temperature: editor.temperature }),
            operations: modelOperations(editor, provider),
          },
          ...(editor.outputModalities.includes("text") &&
          editor.agentTextTransport
            ? { agentTextTransport: editor.agentTextTransport }
            : {}),
          pricing: pricing(editor, provider),
        },
      );
    },
    onSuccess: async () => {
      setEditor(undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: modelsKey }),
        queryClient.invalidateQueries({ queryKey: capabilityDefinitionsKey }),
        queryClient.invalidateQueries({ queryKey: agentSettingsKey }),
      ]);
      toast.notify({
        title: t("settings.models.toast.savedTitle"),
        description: t("settings.models.toast.savedDescription"),
        tone: "positive",
      });
    },
    onError: (error) =>
      toast.notify({
        title: t("settings.models.toast.saveErrorTitle"),
        description: providerSettingsError(error),
        tone: "danger",
      }),
  });

  const updateAgentModels = useMutation({
    mutationFn: () => {
      if (!agentSettings.data) {
        throw new Error(t("settings.models.agentSettings.unavailable"));
      }
      const defaultModelId =
        selectedDefaultModelId ?? agentSettings.data.currentDefaultModelId;
      const fastModelId =
        selectedFastModelId ?? agentSettings.data.currentFastModelId;
      if (!defaultModelId || !fastModelId) {
        throw new Error(t("settings.models.agentSettings.chooseModels"));
      }
      return updateWorkspaceAgentModelSettings(context, {
        expectedVersion: agentSettings.data.version,
        defaultModelId,
        fastModelId,
        reasoningLevel:
          selectedReasoningLevel ?? agentSettings.data.reasoningLevel,
        webSearchMode:
          selectedWebSearchMode ?? agentSettings.data.webSearchMode,
        actionConfirmationRequired:
          selectedActionConfirmation ??
          agentSettings.data.actionConfirmationRequired,
      });
    },
    onSuccess: async () => {
      setSelectedDefaultModelId(undefined);
      setSelectedFastModelId(undefined);
      setSelectedReasoningLevel(undefined);
      setSelectedWebSearchMode(undefined);
      setSelectedActionConfirmation(undefined);
      await queryClient.invalidateQueries({ queryKey: agentSettingsKey });
      toast.notify({
        title: t("settings.models.agentSettings.toast.updated"),
        tone: "positive",
      });
    },
    onError: (error) =>
      toast.notify({
        title: t("settings.models.agentSettings.toast.failed"),
        description: providerSettingsError(error),
        tone: "danger",
      }),
  });
  const saveAgentSettings = (): void => {
    updateAgentModels.mutate();
  };

  const columns: TableColumnsType<CanonicalModelSummary> = [
    {
      title: t("settings.models.columns.model"),
      width: 280,
      render: (_, model) => {
        const agent = agentSettings.data?.options.find(
          (option) => option.id === model.id,
        );
        return (
          <div>
            <strong className="block text-sm">
              {model.profile?.displayName ?? model.slug}
            </strong>
            <span className="text-xs text-muted">{model.slug}</span>
            {agent?.ready === false ? (
              <span className="mt-1 block text-xs leading-5 text-warning">
                {(agent.unavailableReasons?.length
                  ? agent.unavailableReasons
                  : ["unknown"]
                )
                  .map((reason) =>
                    t(`settings.models.agentSettings.shortReasons.${reason}`, {
                      defaultValue: t(
                        "settings.models.agentSettings.shortReasons.unknown",
                      ),
                    }),
                  )
                  .join(" · ")}
              </span>
            ) : null}
          </div>
        );
      },
    },
    {
      title: t("settings.models.columns.provider"),
      width: 300,
      render: (_, model) => (
        <div className="flex flex-wrap gap-1.5">
          {model.providers.map((provider) => (
            <StatusTag
              key={provider.id}
              tone={provider.lifecycle === "active" ? "positive" : "neutral"}
            >
              <span className="inline-flex items-center gap-1.5">
                <ProviderLogo preset={provider.providerPreset} size={14} />
                {provider.providerName} / {provider.upstreamModelId}
              </span>
            </StatusTag>
          ))}
        </div>
      ),
    },
    {
      title: t("settings.models.columns.modalities"),
      width: 240,
      render: (_, model) => <ModelModalityFlow model={model} />,
    },
    {
      title: t("settings.models.columns.context"),
      width: 120,
      render: (_, model) =>
        model.profile?.contextWindow?.toLocaleString() ?? "-",
    },
    {
      title: t("settings.models.columns.status"),
      width: 180,
      render: (_, model) => {
        const ready = model.providers.some(
          (provider) => provider.lifecycle === "active",
        );
        const agent = agentSettings.data?.options.find(
          (option) => option.id === model.id,
        );
        const agentNeedsSetup = agent?.ready === false;
        let statusKey = ready
          ? "settings.models.status.ready"
          : "settings.models.status.awaitingProvider";
        if (agentNeedsSetup)
          statusKey = "settings.models.agentSettings.needsSetup";
        return (
          <div className="grid justify-items-start gap-1.5">
            <StatusTag
              tone={ready && !agentNeedsSetup ? "positive" : "warning"}
            >
              {t(statusKey)}
            </StatusTag>
          </div>
        );
      },
    },
    {
      title: t("settings.models.columns.actions"),
      align: "right",
      fixed: "right",
      width: 180,
      render: (_, model) => {
        const providerModelIds = new Set(
          model.providers.map((provider) => provider.upstreamModelId),
        );
        const routes = (capabilitySources.data?.providerRoutes ?? []).filter(
          (route) =>
            route.availabilityReason === "ready" &&
            providerModelIds.has(route.providerModelId),
        );
        return (
          <div className="flex justify-end gap-2">
            {routes.length > 0 ? (
              <Dropdown
                menu={{
                  items: routes.map((route) => ({
                    key: route.routePolicyRevisionId,
                    label: t(
                      `settings.models.operations.${route.modelOperation?.replaceAll(".", "_") ?? "other"}`,
                    ),
                  })),
                  onClick: ({ key }) =>
                    void navigate({
                      to: "/w/$workspaceId/settings/capabilities",
                      params: { workspaceId },
                      search: { source: `model_service:${key}` },
                    }),
                }}
                trigger={["click"]}
              >
                <Button size="small">
                  {t("settings.models.actions.createCapability")}
                </Button>
              </Dropdown>
            ) : null}
            <Button
              icon={<EditOutlined />}
              onClick={() => void openEditor(model)}
              size="small"
            >
              {t(
                agentSettings.data?.options.some(
                  (option) => option.id === model.id && !option.ready,
                )
                  ? "settings.models.agentSettings.configureModel"
                  : "settings.models.actions.edit",
              )}
            </Button>
          </div>
        );
      },
    },
  ];

  if (models.isPending) {
    return <LoadingState label={t("settings.models.loading")} />;
  }
  if (models.isError || !models.data) {
    return (
      <InlineNotice title={t("settings.models.loadErrorTitle")} tone="danger">
        {providerSettingsError(models.error)}
      </InlineNotice>
    );
  }

  const selectableModels = models.data.models.filter(
    (model) => model.providers.length > 0 && !model.profile,
  );
  const configuredModels = models.data.models.filter((model) => model.profile);
  const hasProviders = providers.length > 0;
  const hasReadyAgentModelOptions =
    agentSettings.data?.options.some((option) => option.ready) ?? false;
  const selectedModel = editor
    ? models.data.models.find((model) => model.id === editor.modelId)
    : undefined;
  const selectedProvider = selectedModel?.providers.find(
    (provider) => provider.id === editor?.providerModelId,
  );
  let pricingValid = false;
  let pricingFields: React.JSX.Element | undefined;
  if (editor?.pricingMode === "fixed") {
    pricingValid = validProviderPricingAmount(editor.fixedCharge);
    pricingFields = (
      <Form.Item label={t("settings.models.pricing.fields.fixedCharge")}>
        <KanvasInput
          inputMode="decimal"
          onChange={(event) =>
            setEditor({ ...editor, fixedCharge: event.target.value })
          }
          value={editor.fixedCharge}
        />
      </Form.Item>
    );
  } else if (editor?.pricingMode === "metered") {
    pricingValid =
      validProviderPricingAmount(editor.inputPrice) &&
      validProviderPricingAmount(editor.outputPrice) &&
      (!editor.cacheReadPrice.trim() ||
        validProviderPricingAmount(editor.cacheReadPrice)) &&
      (!editor.cacheWritePrice.trim() ||
        validProviderPricingAmount(editor.cacheWritePrice)) &&
      (!editor.maximumCharge.trim() ||
        validProviderPricingAmount(editor.maximumCharge));
    pricingFields = (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Form.Item label={t("settings.models.pricing.fields.input")}>
          <KanvasInput
            inputMode="decimal"
            onChange={(event) =>
              setEditor({ ...editor, inputPrice: event.target.value })
            }
            value={editor.inputPrice}
          />
        </Form.Item>
        <Form.Item label={t("settings.models.pricing.fields.cacheRead")}>
          <KanvasInput
            inputMode="decimal"
            onChange={(event) =>
              setEditor({ ...editor, cacheReadPrice: event.target.value })
            }
            value={editor.cacheReadPrice}
          />
        </Form.Item>
        <Form.Item label={t("settings.models.pricing.fields.cacheWrite")}>
          <KanvasInput
            inputMode="decimal"
            onChange={(event) =>
              setEditor({ ...editor, cacheWritePrice: event.target.value })
            }
            value={editor.cacheWritePrice}
          />
        </Form.Item>
        <Form.Item label={t("settings.models.pricing.fields.output")}>
          <KanvasInput
            inputMode="decimal"
            onChange={(event) =>
              setEditor({ ...editor, outputPrice: event.target.value })
            }
            value={editor.outputPrice}
          />
        </Form.Item>
        <Form.Item label={t("settings.models.pricing.fields.maximumCharge")}>
          <KanvasInput
            inputMode="decimal"
            onChange={(event) =>
              setEditor({ ...editor, maximumCharge: event.target.value })
            }
            value={editor.maximumCharge}
          />
        </Form.Item>
      </div>
    );
  } else if (editor) {
    pricingValid =
      !editor.maximumCharge.trim() ||
      validProviderPricingAmount(editor.maximumCharge);
    pricingFields = (
      <Form.Item label={t("settings.models.pricing.fields.maximumChargeUsd")}>
        <KanvasInput
          inputMode="decimal"
          onChange={(event) =>
            setEditor({ ...editor, maximumCharge: event.target.value })
          }
          value={editor.maximumCharge}
        />
      </Form.Item>
    );
  }
  const activeReferenceNotice =
    referenceNotice?.modelId === editor?.modelId &&
    referenceNotice?.providerModelId === editor?.providerModelId
      ? referenceNotice
      : undefined;
  const agentSettingsChanged = Boolean(
    agentSettings.data &&
    ((selectedDefaultModelId !== undefined &&
      selectedDefaultModelId !== agentSettings.data.currentDefaultModelId) ||
      (selectedFastModelId !== undefined &&
        selectedFastModelId !== agentSettings.data.currentFastModelId) ||
      (selectedReasoningLevel !== undefined &&
        selectedReasoningLevel !== agentSettings.data.reasoningLevel) ||
      (selectedWebSearchMode !== undefined &&
        selectedWebSearchMode !== agentSettings.data.webSearchMode) ||
      (selectedActionConfirmation !== undefined &&
        selectedActionConfirmation !==
          agentSettings.data.actionConfirmationRequired)),
  );

  return (
    <section className="grid min-w-0 gap-5">
      {agentSettings.data ? (
        <section className="rounded-[16px] border border-ink/8 bg-paper p-4">
          <h3 className="m-0 text-sm font-semibold">
            {t("settings.models.agentSettings.title")}
          </h3>
          {!hasReadyAgentModelOptions ? (
            <p className="mb-0 mt-1 text-xs leading-5 text-muted">
              {t("settings.models.agentSettings.noAvailableModels")}{" "}
              <a
                className="text-primary underline underline-offset-2"
                href="#configured-models"
              >
                {t("settings.models.agentSettings.viewModels")}
              </a>
            </p>
          ) : null}
          <div className="mt-3 grid items-end gap-4 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_12rem_12rem_12rem_auto]">
            <label className="grid min-w-0 gap-1.5 text-xs font-semibold">
              {t("settings.models.agentSettings.defaultModel")}
              <KanvasSelect
                disabled={agentSettings.data.options.length === 0}
                onChange={selectDefaultModel}
                options={agentSettings.data.options.map((option) => ({
                  disabled: !option.ready,
                  label: option.ready
                    ? option.modelName
                    : `${option.modelName} · ${t(option.unavailableReasons?.includes("tool_call") ? "settings.models.agentSettings.toolCallUnconfirmed" : "settings.models.agentSettings.unavailableOption")}`,
                  value: option.id,
                }))}
                value={
                  selectedDefaultModelId ??
                  agentSettings.data.currentDefaultModelId
                }
                placeholder={t(
                  "settings.models.agentSettings.noAvailableModelsPlaceholder",
                )}
              />
            </label>
            <label className="grid min-w-0 gap-1.5 text-xs font-semibold">
              {t("settings.models.agentSettings.fastModel")}
              <KanvasSelect
                disabled={agentSettings.data.options.length === 0}
                onChange={selectFastModel}
                options={agentSettings.data.options.map((option) => ({
                  disabled: !option.ready,
                  label: option.ready
                    ? option.modelName
                    : `${option.modelName} · ${t(option.unavailableReasons?.includes("tool_call") ? "settings.models.agentSettings.toolCallUnconfirmed" : "settings.models.agentSettings.unavailableOption")}`,
                  value: option.id,
                }))}
                value={
                  selectedFastModelId ?? agentSettings.data.currentFastModelId
                }
                placeholder={t(
                  "settings.models.agentSettings.noAvailableModelsPlaceholder",
                )}
              />
            </label>
            <label className="grid min-w-0 gap-1.5 text-xs font-semibold">
              {t("settings.models.agentSettings.reasoningLevel")}
              <KanvasSelect
                onChange={selectReasoningLevel}
                options={[
                  {
                    label: t("settings.models.reasoningLevels.off"),
                    value: "off",
                  },
                  {
                    label: t("settings.models.reasoningLevels.low"),
                    value: "low",
                  },
                  {
                    label: t("settings.models.reasoningLevels.medium"),
                    value: "medium",
                  },
                  {
                    label: t("settings.models.reasoningLevels.high"),
                    value: "high",
                  },
                ]}
                value={
                  selectedReasoningLevel ?? agentSettings.data.reasoningLevel
                }
              />
            </label>
            <label className="grid min-w-0 gap-1.5 text-xs font-semibold">
              {t("settings.models.agentSettings.webSearch")}
              <KanvasSelect
                onChange={(value) =>
                  setSelectedWebSearchMode(value as "off" | "auto" | "required")
                }
                options={[
                  {
                    label: t("settings.models.webSearchModes.off"),
                    value: "off",
                  },
                  {
                    label: t("settings.models.webSearchModes.auto"),
                    value: "auto",
                  },
                  {
                    label: t("settings.models.webSearchModes.required"),
                    value: "required",
                  },
                ]}
                value={
                  selectedWebSearchMode ?? agentSettings.data.webSearchMode
                }
              />
            </label>
            <label className="grid min-w-0 gap-1.5 text-xs font-semibold">
              {t("settings.models.agentSettings.confirmActions")}
              <div className="flex min-h-10 items-center gap-2">
                <Switch
                  aria-label={t("settings.models.agentSettings.confirmActions")}
                  checked={
                    selectedActionConfirmation ??
                    agentSettings.data.actionConfirmationRequired
                  }
                  onChange={selectActionConfirmation}
                />
                <span className="text-sm font-normal text-muted">
                  {t(
                    (selectedActionConfirmation ??
                      agentSettings.data.actionConfirmationRequired)
                      ? "settings.models.agentSettings.confirmOn"
                      : "settings.models.agentSettings.confirmOff",
                  )}
                </span>
              </div>
            </label>
            <Button
              className="justify-self-end self-end"
              disabled={!hasReadyAgentModelOptions || !agentSettingsChanged}
              loading={updateAgentModels.isPending}
              onClick={saveAgentSettings}
              type="primary"
            >
              {t("settings.models.agentSettings.save")}
            </Button>
          </div>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3
          id="configured-models"
          className="m-0 scroll-mt-5 text-sm font-semibold"
        >
          {t("settings.models.configuredTitle")}
        </h3>
        {hasProviders ? (
          <div className="flex flex-wrap gap-2">
            <Button
              href={`/w/${workspaceId}/settings/models/available`}
              icon={<UnorderedListOutlined />}
            >
              {t("settings.models.actions.viewAvailable")}
            </Button>
            <Button
              disabled={selectableModels.length === 0}
              icon={<PlusOutlined />}
              onClick={openFirstSelectableModel}
              type="primary"
            >
              {t("settings.models.add")}
            </Button>
          </div>
        ) : null}
      </div>

      {configuredModels.length > 0 ? (
        <Table
          className="min-w-0"
          columns={columns}
          dataSource={configuredModels}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          rowKey="id"
          scroll={{ x: 1300 }}
        />
      ) : (
        <EmptyState
          {...(!hasProviders
            ? {
                action: () =>
                  void navigate({
                    params: { workspaceId },
                    to: "/w/$workspaceId/settings/providers",
                  }),
                actionLabel: t("settings.providers.connect"),
              }
            : {})}
          title={t(
            hasProviders
              ? "settings.models.emptyTitle"
              : "settings.models.providerRequiredTitle",
          )}
        >
          {t(
            hasProviders
              ? "settings.models.emptyDescription"
              : "settings.models.providerRequiredDescription",
          )}
        </EmptyState>
      )}

      <Drawer
        destroyOnHidden
        footer={
          editor ? (
            <div className="grid gap-3">
              {activeReferenceNotice ? (
                <div
                  role={activeReferenceNotice.failed ? "alert" : "status"}
                  aria-live="polite"
                  className="text-xs leading-5"
                >
                  <p
                    className={`m-0 ${activeReferenceNotice.failed ? "text-danger" : "text-muted"}`}
                  >
                    {activeReferenceNotice.summary}
                  </p>
                  {activeReferenceNotice.details.length ? (
                    <details
                      className="mt-1 text-muted"
                      open={activeReferenceNotice.failed || undefined}
                    >
                      <summary className="w-fit cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-primary">
                        {t("settings.models.reference.reviewDetails")}
                      </summary>
                      <ul className="mb-0 mt-1 max-h-28 list-disc overflow-auto pl-4">
                        {activeReferenceNotice.details.map((detail) => (
                          <li key={detail}>{detail}</li>
                        ))}
                      </ul>
                    </details>
                  ) : null}
                </div>
              ) : null}
              <div className="flex flex-wrap justify-end gap-3">
                {editor.outputModalities.includes("image") ? (
                  <Button
                    disabled={
                      save.isPending ||
                      syncReference.isPending ||
                      updateParameters.isPending
                    }
                    loading={updateParameters.isPending}
                    onClick={() => {
                      setParameterPreview(undefined);
                      updateParameters.mutate();
                    }}
                  >
                    {t("settings.models.parameters.update")}
                  </Button>
                ) : null}
                {selectedModel?.profile ? (
                  <Button
                    disabled={save.isPending}
                    icon={<ReloadOutlined />}
                    loading={syncReference.isPending}
                    onClick={() => syncReference.mutate()}
                  >
                    {t("settings.models.reference.syncLatest")}
                  </Button>
                ) : null}
                <Button
                  disabled={
                    save.isPending ||
                    syncReference.isPending ||
                    updateParameters.isPending
                  }
                  onClick={() => setEditor(undefined)}
                >
                  {t("settings.models.cancel")}
                </Button>
                <Button
                  disabled={
                    syncReference.isPending ||
                    updateParameters.isPending ||
                    (parameterPreview?.modelId === editor.modelId &&
                      parameterPreview.providerModelId ===
                        editor.providerModelId) ||
                    !editor.displayName.trim() ||
                    !editor.family.trim() ||
                    !editor.description.trim() ||
                    !editor.providerModelId ||
                    (editor.outputModalities.includes("text") &&
                      !editor.agentTextTransport) ||
                    (editor.pricingMode === "provider_reported" &&
                      !selectedProvider?.providerReportedPricingAvailable) ||
                    (editor.outputModalities.includes("text") &&
                      (!positiveTokenLimit(editor.contextWindow) ||
                        !positiveTokenLimit(editor.maximumOutputTokens))) ||
                    Boolean(
                      editor.contextWindow &&
                      !positiveTokenLimit(editor.contextWindow),
                    ) ||
                    Boolean(
                      editor.maximumOutputTokens &&
                      !positiveTokenLimit(editor.maximumOutputTokens),
                    ) ||
                    Boolean(
                      editor.maximumInputTokens &&
                      !positiveTokenLimit(editor.maximumInputTokens),
                    ) ||
                    !pricingValid
                  }
                  loading={save.isPending}
                  onClick={() => save.mutate()}
                  type="primary"
                >
                  {t("settings.models.save")}
                </Button>
              </div>
            </div>
          ) : null
        }
        mask={{ closable: !save.isPending && !syncReference.isPending }}
        onClose={() => setEditor(undefined)}
        open={Boolean(editor)}
        size={720}
        title={
          selectedModel?.profile
            ? t("settings.models.editTitle")
            : t("settings.models.addTitle")
        }
      >
        {editor ? (
          <div className="grid gap-5">
            <Form layout="vertical">
              <Form.Item label={t("settings.models.fields.model")} required>
                <KanvasSelect
                  disabled={Boolean(selectedModel?.profile)}
                  onChange={selectEditorModel}
                  options={(selectedModel?.profile
                    ? [selectedModel]
                    : selectableModels
                  ).map((model) => ({
                    label: model.slug,
                    value: model.id,
                  }))}
                  optionFilterProp="label"
                  showSearch
                  value={editor.modelId}
                />
              </Form.Item>
              <Form.Item label={t("settings.models.fields.provider")} required>
                <KanvasSelect
                  labelRender={(option) => {
                    const provider = selectedModel?.providers.find(
                      (candidate) => candidate.id === option.value,
                    );
                    return provider ? (
                      <span className="inline-flex items-center gap-2">
                        <ProviderLogo
                          preset={provider.providerPreset}
                          size={16}
                        />
                        {option.label}
                      </span>
                    ) : (
                      option.label
                    );
                  }}
                  onChange={(value) => {
                    const providerModelId = String(value);
                    const provider = selectedModel?.providers.find(
                      (candidate) => candidate.id === providerModelId,
                    );
                    const agentTextTransport =
                      provider?.agentTextTransport ??
                      provider?.supportedAgentTextTransports[0];
                    if (!provider || !agentTextTransport) return;
                    setEditor((current) =>
                      current
                        ? {
                            ...current,
                            providerModelId,
                            imageOperations: imageModelOperations(
                              provider.operations,
                            ),
                            agentTextTransport,
                            pricingMode:
                              current.pricingMode === "provider_reported" &&
                              !provider.providerReportedPricingAvailable
                                ? "metered"
                                : current.pricingMode,
                          }
                        : current,
                    );
                  }}
                  optionRender={(option) => {
                    const provider = selectedModel?.providers.find(
                      (candidate) => candidate.id === option.value,
                    );
                    return (
                      <span className="inline-flex items-center gap-2">
                        {provider ? (
                          <ProviderLogo
                            preset={provider.providerPreset}
                            size={16}
                          />
                        ) : null}
                        {option.label}
                      </span>
                    );
                  }}
                  options={(selectedModel?.providers ?? []).map((provider) => ({
                    label: `${provider.providerName} / ${provider.upstreamModelId}`,
                    value: provider.id,
                  }))}
                  value={editor.providerModelId}
                />
              </Form.Item>
              {editor.outputModalities.includes("text") && selectedProvider ? (
                <Form.Item
                  label={t("settings.models.fields.agentTextTransport")}
                  required
                >
                  <KanvasSelect
                    onChange={(value) => {
                      const selected =
                        selectedProvider.supportedAgentTextTransports.find(
                          (transport) =>
                            agentTextTransportKey(transport) === value,
                        );
                      if (selected) {
                        setEditor({
                          ...editor,
                          agentTextTransport: selected,
                          ...(selected.protocolKind === "openai_chat"
                            ? { webSearch: false }
                            : {}),
                        });
                      }
                    }}
                    options={selectedProvider.supportedAgentTextTransports.map(
                      (transport) => ({
                        label: agentTextTransportLabel(transport),
                        value: agentTextTransportKey(transport),
                      }),
                    )}
                    value={
                      editor.agentTextTransport
                        ? agentTextTransportKey(editor.agentTextTransport)
                        : undefined
                    }
                  />
                </Form.Item>
              ) : null}
              {editor.outputModalities.includes("text") && editor.reasoning ? (
                <Form.Item label={t("settings.models.fields.reasoningSupport")}>
                  <div className="flex min-h-8 items-center gap-5">
                    {(
                      [
                        ["low", t("settings.models.reasoningLevels.low")],
                        ["medium", t("settings.models.reasoningLevels.medium")],
                        ["high", t("settings.models.reasoningLevels.high")],
                      ] as const
                    ).map(([value, label]) => (
                      <Checkbox
                        checked={editor.reasoningLevels.includes(value)}
                        key={value}
                        onChange={(event) =>
                          setEditor({
                            ...editor,
                            reasoningLevels: event.target.checked
                              ? [...editor.reasoningLevels, value]
                              : editor.reasoningLevels.filter(
                                  (level) => level !== value,
                                ),
                          })
                        }
                      >
                        {label}
                      </Checkbox>
                    ))}
                  </div>
                </Form.Item>
              ) : null}
              {editor.outputModalities.includes("text") &&
              editor.agentTextTransport?.protocolKind !== "openai_chat" ? (
                <Form.Item label={t("settings.models.fields.webSearchSupport")}>
                  <Switch
                    checked={editor.webSearch}
                    checkedChildren={t("settings.models.support.supported")}
                    onChange={(checked) =>
                      setEditor({ ...editor, webSearch: checked })
                    }
                    unCheckedChildren={t("settings.models.support.unsupported")}
                  />
                </Form.Item>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <Form.Item
                  label={t("settings.models.fields.displayName")}
                  required
                >
                  <KanvasInput
                    onChange={(event) =>
                      setEditor({ ...editor, displayName: event.target.value })
                    }
                    value={editor.displayName}
                  />
                </Form.Item>
                <Form.Item label={t("settings.models.fields.family")} required>
                  <KanvasInput
                    onChange={(event) =>
                      setEditor({ ...editor, family: event.target.value })
                    }
                    value={editor.family}
                  />
                </Form.Item>
                <Form.Item label={t("settings.models.fields.inputModalities")}>
                  <KanvasSelect
                    className="[&_.ant-select-selection-item]:!border-0 [&_.ant-select-selection-item]:!bg-transparent [&_.ant-select-selection-item]:!px-1"
                    mode="multiple"
                    onChange={(value) =>
                      setEditor({
                        ...editor,
                        inputModalities: value as Modality[],
                      })
                    }
                    options={modalities.map((value) => ({
                      label: <ModalityMark modality={value} withLabel />,
                      value,
                    }))}
                    value={[...editor.inputModalities]}
                  />
                </Form.Item>
                <Form.Item label={t("settings.models.fields.outputModalities")}>
                  <KanvasSelect
                    className="[&_.ant-select-selection-item]:!border-0 [&_.ant-select-selection-item]:!bg-transparent [&_.ant-select-selection-item]:!px-1"
                    mode="multiple"
                    onChange={(value) =>
                      setEditor({
                        ...editor,
                        outputModalities: value as Modality[],
                      })
                    }
                    options={modalities.map((value) => ({
                      label: <ModalityMark modality={value} withLabel />,
                      value,
                    }))}
                    value={[...editor.outputModalities]}
                  />
                </Form.Item>
                {editor.outputModalities.includes("text") ? (
                  <>
                    <Form.Item
                      label={t("settings.models.fields.contextWindow")}
                      required={editor.outputModalities.includes("text")}
                      extra={
                        editor.outputModalities.includes("text") &&
                        !positiveTokenLimit(editor.contextWindow)
                          ? t("settings.models.validation.tokenLimits")
                          : undefined
                      }
                    >
                      <KanvasInput
                        inputMode="numeric"
                        onChange={(event) =>
                          setEditor({
                            ...editor,
                            contextWindow: event.target.value,
                          })
                        }
                        value={editor.contextWindow}
                      />
                    </Form.Item>
                    <Form.Item
                      label={t("settings.models.fields.maximumOutputTokens")}
                      required={editor.outputModalities.includes("text")}
                      extra={
                        editor.outputModalities.includes("text") &&
                        !positiveTokenLimit(editor.maximumOutputTokens)
                          ? t("settings.models.validation.tokenLimits")
                          : undefined
                      }
                    >
                      <KanvasInput
                        inputMode="numeric"
                        onChange={(event) =>
                          setEditor({
                            ...editor,
                            maximumOutputTokens: event.target.value,
                          })
                        }
                        value={editor.maximumOutputTokens}
                      />
                    </Form.Item>
                  </>
                ) : null}
              </div>
              {editor.outputModalities.includes("text") ? (
                <Form.Item
                  label={t("settings.models.fields.toolCall")}
                  extra={t("settings.models.toolCallHelp")}
                >
                  <KanvasSelect
                    aria-label={t("settings.models.fields.toolCall")}
                    value={
                      editor.toolCall === undefined
                        ? "unknown"
                        : String(editor.toolCall ? "supported" : "unsupported")
                    }
                    onChange={selectToolCallSupport}
                    options={[
                      {
                        value: "unknown",
                        label: t("settings.models.toolCallStates.unknown"),
                      },
                      {
                        value: "supported",
                        label: t("settings.models.toolCallStates.supported"),
                      },
                      {
                        value: "unsupported",
                        label: t("settings.models.toolCallStates.unsupported"),
                      },
                    ]}
                  />
                </Form.Item>
              ) : null}
              <Form.Item
                label={t("settings.models.fields.description")}
                required
              >
                <KanvasTextArea
                  onChange={(event) =>
                    setEditor({ ...editor, description: event.target.value })
                  }
                  rows={3}
                  value={editor.description}
                />
              </Form.Item>

              {parameterPreview?.modelId === editor.modelId &&
              parameterPreview.providerModelId === editor.providerModelId ? (
                <section
                  className="mb-4 grid gap-3"
                  aria-label={t("settings.models.parameters.review")}
                >
                  <h3 className="font-semibold">
                    {t("settings.models.parameters.review")}
                  </h3>
                  <div className="grid gap-3 text-xs sm:grid-cols-2">
                    <div>
                      {t("settings.models.parameters.current")}
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap">
                        {JSON.stringify(parameterPreview.before, null, 2)}
                      </pre>
                    </div>
                    <div>
                      {t("settings.models.parameters.next")}
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap">
                        {JSON.stringify(parameterPreview.merged, null, 2)}
                      </pre>
                    </div>
                  </div>
                  {parameterPreview.preserved.length ? (
                    <p className="text-sm">
                      {t("settings.models.parameters.preserved", {
                        fields: parameterPreview.preserved.join(", "),
                      })}
                    </p>
                  ) : null}
                  <p className="text-sm">
                    {t("settings.models.parameters.draftOnly")}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => {
                        setEditor({
                          ...editor,
                          imageOperations: parameterPreview.merged,
                        });
                        setParameterPreview(undefined);
                      }}
                    >
                      {t("settings.models.parameters.apply")}
                    </Button>
                    <Button onClick={() => setParameterPreview(undefined)}>
                      {t("settings.models.parameters.keep")}
                    </Button>
                  </div>
                </section>
              ) : null}
              <h3 className="mb-4 mt-2 text-base font-semibold">
                {t("settings.models.pricing.sectionTitle")}
              </h3>
              <Form.Item label={t("settings.models.pricing.mode")} required>
                <KanvasSelect
                  onChange={(value) =>
                    setEditor({ ...editor, pricingMode: value as PricingMode })
                  }
                  options={[
                    {
                      label: t("settings.models.pricing.metered"),
                      value: "metered",
                    },
                    {
                      label: t("settings.models.pricing.fixed"),
                      value: "fixed",
                    },
                    ...(selectedProvider?.providerReportedPricingAvailable
                      ? [
                          {
                            label: t(
                              "settings.models.pricing.providerReported",
                            ),
                            value: "provider_reported",
                          },
                        ]
                      : []),
                  ]}
                  value={editor.pricingMode}
                />
              </Form.Item>
              {pricingFields}
            </Form>
          </div>
        ) : null}
      </Drawer>
    </section>
  );
}

export function AvailableModelsPanel({
  workspaceId,
}: {
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const models = useQuery({
    queryKey: workspaceQueryKeys.models(workspaceId),
    queryFn: () => fetchWorkspaceModels(workspaceId),
    retry: false,
  });
  const columns: TableColumnsType<CanonicalModelSummary> = [
    {
      title: t("settings.models.columns.model"),
      width: 320,
      render: (_, model) => (
        <div>
          <strong className="block text-sm">
            {model.profile?.displayName ?? model.slug}
          </strong>
          <span className="text-xs text-muted">{model.slug}</span>
        </div>
      ),
    },
    {
      title: t("settings.models.available.providerModels"),
      render: (_, model) => (
        <div className="flex flex-wrap gap-1.5">
          {model.providers.map((provider) => (
            <StatusTag key={provider.id}>
              <span className="inline-flex items-center gap-1.5">
                <ProviderLogo preset={provider.providerPreset} size={14} />
                {provider.providerName} / {provider.upstreamModelId}
              </span>
            </StatusTag>
          ))}
        </div>
      ),
    },
  ];

  if (models.isPending) {
    return <LoadingState label={t("settings.models.available.loading")} />;
  }
  if (models.isError || !models.data) {
    return (
      <InlineNotice
        title={t("settings.models.available.loadErrorTitle")}
        tone="danger"
      >
        {providerSettingsError(models.error)}
      </InlineNotice>
    );
  }
  return models.data.models.length > 0 ? (
    <Table
      columns={columns}
      dataSource={models.data.models}
      pagination={{ pageSize: 10, showSizeChanger: true }}
      rowKey="id"
      scroll={{ x: 760 }}
    />
  ) : (
    <EmptyState title={t("settings.models.available.emptyTitle")}>
      {t("settings.models.available.emptyDescription")}
    </EmptyState>
  );
}
