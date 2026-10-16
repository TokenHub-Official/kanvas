import { SyncOutlined } from "@ant-design/icons";
import type { ProviderSettingSummary } from "@kanvas/contracts/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Drawer, Form, Modal, Table, Tag } from "antd";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { workspaceQueryKeys } from "../../api/query-keys.js";
import {
  fetchWorkspaceProviderModelCatalog,
  fetchWorkspaceProviderSettings,
  refreshWorkspaceProviderModelCatalog,
  renameWorkspaceProviderSetting,
  type WorkspaceApiContext,
} from "../../api/transport.js";
import { InlineNotice } from "../../components/feedback.js";
import {
  KanvasInput,
  KanvasSearchInput,
} from "../../components/kanvas-input.js";
import { useSettingsNotification } from "../../components/settings-notification.js";
import {
  AddProviderModelsError,
  addProviderModels,
  canAddProviderModel,
  type CatalogModel,
} from "./add-provider-models.js";
import {
  createProviderOperationKey,
  providerSettingsError,
} from "./provider-settings-runtime.js";

interface Props {
  readonly context: WorkspaceApiContext;
  readonly provider: ProviderSettingSummary;
  readonly onClose: () => void;
}

export function ProviderModelsDrawer({
  context,
  provider,
  onClose,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, string>>({});
  const [search, setSearch] = useState("");
  const [saved, setSaved] = useState(false);
  const key = workspaceQueryKeys.providerModelCatalog(
    context.workspaceId,
    provider.id,
  );
  const catalog = useQuery({
    queryKey: key,
    queryFn: () =>
      fetchWorkspaceProviderModelCatalog(context.workspaceId, provider.id),
    retry: false,
  });
  async function invalidate(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: key }),
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.models(context.workspaceId),
      }),
      queryClient.invalidateQueries({
        queryKey: workspaceQueryKeys.providerSettings(context.workspaceId),
      }),
    ]);
  }
  const refresh = useMutation({
    mutationFn: async () => {
      const settings = await fetchWorkspaceProviderSettings(
        context.workspaceId,
      );
      const current = settings.providers.find(
        (item) => item.id === provider.id,
      );
      if (!current) throw new AddProviderModelsError("unavailable");
      await refreshWorkspaceProviderModelCatalog(
        context,
        provider.id,
        { expectedVersion: current.version },
        createProviderOperationKey(),
      );
    },
    onSuccess: async () => {
      await invalidate();
      setSelected([]);
      setSaved(false);
    },
  });
  const save = useMutation({
    mutationFn: () =>
      addProviderModels(
        context,
        provider.id,
        selected.map((upstreamModelId) => {
          const model = catalog.data?.models.find(
            (item) => item.upstreamModelId === upstreamModelId,
          );
          return {
            upstreamModelId,
            canonicalSlug:
              mappings[upstreamModelId] ??
              model?.suggestedCanonicalSlug ??
              upstreamModelId.toLowerCase(),
          };
        }),
      ),
    onSuccess: async () => {
      setSelected([]);
      setSaved(true);
      await invalidate();
    },
    onError: () => invalidate(),
  });
  const addSelected = () => {
    refresh.reset();
    save.mutate();
  };
  const refreshCatalog = () => {
    save.reset();
    refresh.mutate();
  };
  const busy = save.isPending || refresh.isPending;
  const models = catalog.data?.models ?? [];
  const needle = search.trim().toLowerCase();
  const visible = models.filter(
    (model) =>
      !needle ||
      `${model.displayName} ${model.upstreamModelId}`
        .toLowerCase()
        .includes(needle),
  );
  const error = save.error ?? refresh.error ?? catalog.error;
  const errorText =
    error instanceof AddProviderModelsError
      ? t(`settings.providers.management.errors.${error.code}`)
      : providerSettingsError(error);

  return (
    <Drawer
      open
      onClose={() => {
        if (!busy) onClose();
      }}
      closable={{ disabled: busy }}
      mask={{ closable: !busy }}
      size="min(760px, 100vw)"
      title={t("settings.providers.management.modelsTitle", {
        name: provider.displayName,
      })}
      footer={
        <div className="flex justify-end gap-3">
          <Button disabled={busy} onClick={onClose}>
            {t("settings.providers.management.close")}
          </Button>
          <Button
            type="primary"
            disabled={busy || selected.length === 0}
            loading={save.isPending}
            onClick={addSelected}
          >
            {t("settings.providers.management.addSelected", {
              count: selected.length,
            })}
          </Button>
        </div>
      }
    >
      <div className="grid gap-4">
        <div className="flex items-center gap-3">
          <KanvasSearchInput
            aria-label={t("settings.providers.directory.create.searchModels")}
            placeholder={t("settings.providers.directory.create.searchModels")}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <Button
            disabled={busy || !provider.canRefreshModelCatalog}
            loading={refresh.isPending}
            icon={<SyncOutlined />}
            onClick={refreshCatalog}
          >
            {t("settings.providers.management.refresh")}
          </Button>
        </div>
        {!provider.canRefreshModelCatalog ? (
          <InlineNotice
            title={t("settings.providers.management.refreshUnavailable")}
            tone="warning"
          />
        ) : null}
        {error ? (
          <InlineNotice
            title={t("settings.providers.management.failed")}
            tone="danger"
          >
            {errorText}
            {save.isError ? (
              <p className="mb-0">
                {t("settings.providers.management.retryHint")}
              </p>
            ) : null}
            {catalog.isError ? (
              <Button onClick={() => void catalog.refetch()}>
                {t("settings.providers.management.retry")}
              </Button>
            ) : null}
          </InlineNotice>
        ) : null}
        {saved ? (
          <InlineNotice
            title={t("settings.providers.management.added")}
            tone="positive"
          >
            <p>{t("settings.providers.management.nextStep")}</p>
            <Button
              type="primary"
              href={`/w/${context.workspaceId}/settings/models`}
            >
              {t("settings.providers.management.configure")}
            </Button>
          </InlineNotice>
        ) : null}
        <Table<CatalogModel>
          rowKey="upstreamModelId"
          loading={catalog.isPending}
          dataSource={visible}
          pagination={{ pageSize: 10, showSizeChanger: true }}
          scroll={{ x: 580 }}
          locale={{
            emptyText: t(
              needle
                ? "settings.providers.directory.noMatches"
                : "settings.providers.management.empty",
            ),
          }}
          rowSelection={{
            selectedRowKeys: selected,
            preserveSelectedRowKeys: true,
            onChange: (keys) => {
              setSelected(keys.map(String));
              setSaved(false);
            },
            getCheckboxProps: (model) => ({
              disabled: busy || !canAddProviderModel(model),
              name: model.upstreamModelId,
              "aria-label": t("settings.providers.management.selectModel", {
                name: model.upstreamModelId,
              }),
            }),
          }}
          columns={[
            {
              title: t("settings.providers.management.model"),
              render: (_, model) => (
                <div>
                  <strong>{model.displayName}</strong>
                  <div className="text-xs text-muted">
                    {model.upstreamModelId}
                  </div>
                </div>
              ),
            },
            {
              title: t("settings.providers.management.identifier"),
              render: (_, model) =>
                canAddProviderModel(model) ? (
                  <KanvasInput
                    aria-label={t(
                      "settings.providers.management.identifierFor",
                      { name: model.upstreamModelId },
                    )}
                    disabled={busy}
                    value={
                      mappings[model.upstreamModelId] ??
                      model.suggestedCanonicalSlug ??
                      model.upstreamModelId.toLowerCase()
                    }
                    onChange={(event) =>
                      setMappings((current) => ({
                        ...current,
                        [model.upstreamModelId]: event.target.value,
                      }))
                    }
                  />
                ) : (
                  <Tag>
                    {t(
                      `settings.providers.management.status.${model.imported!.lifecycle}`,
                    )}
                  </Tag>
                ),
            },
          ]}
        />
      </div>
    </Drawer>
  );
}

export function RenameProviderDialog({
  context,
  provider,
  onClose,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const toast = useSettingsNotification();
  const [name, setName] = useState(provider.displayName);
  const [expectedVersion, setExpectedVersion] = useState(provider.version);
  const save = useMutation({
    mutationFn: () =>
      renameWorkspaceProviderSetting(context, provider.id, {
        expectedVersion,
        displayName: name.trim(),
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeys.providerSettings(context.workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeys.models(context.workspaceId),
        }),
        queryClient.invalidateQueries({
          queryKey: workspaceQueryKeys.usageSummary(context.workspaceId),
        }),
      ]);
      toast.notify({
        title: t("settings.providers.management.renamed"),
        tone: "positive",
      });
      onClose();
    },
    onError: async () => {
      const queryKey = workspaceQueryKeys.providerSettings(context.workspaceId);
      await queryClient.invalidateQueries({ queryKey });
      const refreshed =
        queryClient.getQueryData<
          Awaited<ReturnType<typeof fetchWorkspaceProviderSettings>>
        >(queryKey);
      const current = refreshed?.providers.find(
        (item) => item.id === provider.id,
      );
      if (current) setExpectedVersion(current.version);
    },
  });
  return (
    <Modal
      open
      title={t("settings.providers.management.rename")}
      onCancel={() => {
        if (!save.isPending) onClose();
      }}
      onOk={() => save.mutate()}
      confirmLoading={save.isPending}
      closable={!save.isPending}
      mask={{ closable: !save.isPending }}
      cancelButtonProps={{ disabled: save.isPending }}
      okButtonProps={{
        disabled: !name.trim() || name.trim() === provider.displayName,
      }}
      okText={t("settings.providers.management.save")}
    >
      <Form layout="vertical">
        <Form.Item label={t("settings.providers.create.name")} required>
          <KanvasInput
            autoFocus
            maxLength={160}
            disabled={save.isPending}
            aria-label={t("settings.providers.create.name")}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </Form.Item>
      </Form>
      {save.error ? (
        <InlineNotice
          title={t("settings.providers.management.failed")}
          tone="danger"
        >
          {providerSettingsError(save.error)}
        </InlineNotice>
      ) : null}
    </Modal>
  );
}
