import {
  DeleteOutlined,
  LinkOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useMutation } from "@tanstack/react-query";
import { Alert, Button, Input, Segmented, Tag, Upload } from "antd";
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ulid } from "ulid";

import {
  allocateUserImport,
  commitUserImport,
  uploadUserImport,
} from "../../api/transport.js";
import {
  workflowAuthoringFieldKind,
  workflowFileConfiguration,
} from "./workflow-authoring-field-schema-v1.js";
import type { WorkflowSchemaField } from "./workflow-authoring-model.js";

const supportedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export interface WorkflowTestFileUploadDependencies {
  readonly allocate: typeof allocateUserImport;
  readonly upload: typeof uploadUserImport;
  readonly commit: typeof commitUserImport;
}

const defaultDependencies: WorkflowTestFileUploadDependencies = {
  allocate: allocateUserImport,
  upload: uploadUserImport,
  commit: commitUserImport,
};

export async function uploadWorkflowTestFile(options: {
  readonly csrfToken: string;
  readonly dependencies?: WorkflowTestFileUploadDependencies;
  readonly file: File;
  readonly onProgress?: (progress: number) => void;
  readonly workspaceId: string;
}): Promise<string> {
  if (!supportedImageTypes.has(options.file.type)) {
    throw new TypeError(
      "Workflow test upload only supports PNG, JPEG and WebP.",
    );
  }
  const dependencies = options.dependencies ?? defaultDependencies;
  const context = {
    csrfToken: options.csrfToken,
    workspaceId: options.workspaceId,
  };
  const allocation = await dependencies.allocate(
    context,
    {
      expectedMediaType: options.file.type as
        "image/jpeg" | "image/png" | "image/webp",
      expectedSize: String(options.file.size),
    },
    ulid(),
  );
  if (allocation.state !== "committed") {
    await dependencies.upload(
      context,
      allocation.uploadSessionId,
      options.file,
      {
        onProgress: ({ loadedBytes, totalBytes }) => {
          options.onProgress?.(
            totalBytes > 0 ? Math.round((loadedBytes / totalBytes) * 100) : 0,
          );
        },
      },
    );
  }
  const committed = await dependencies.commit(
    context,
    allocation.uploadSessionId,
    {
      artifactType: "image.source",
      dataClassification: "internal",
      displayFilename: options.file.name,
      metadata: { importedFrom: "workflow-candidate-test" },
      asset: {
        name: options.file.name,
        assetType: "image.source",
      },
    },
  );
  return committed.artifactId;
}

function stringValues(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  return typeof value === "string" && value ? [value] : [];
}

export function WorkflowTestFileControl({
  csrfToken,
  field,
  onBusyChange,
  onChange,
  value,
  workspaceId,
}: {
  readonly csrfToken: string;
  readonly field: WorkflowSchemaField;
  readonly onBusyChange: (busy: boolean) => void;
  readonly onChange: (value: unknown) => void;
  readonly value: unknown;
  readonly workspaceId: string;
}): React.JSX.Element {
  const { t } = useTranslation();
  const schema = field.schema ?? {};
  const file = workflowFileConfiguration(schema);
  const multiple = workflowAuthoringFieldKind(schema) === "file_list";
  const [mode, setMode] = useState<"upload" | "url">(
    file.transfer === "url" ? "url" : "upload",
  );
  const [progress, setProgress] = useState(0);
  const [uploadedNames, setUploadedNames] = useState<
    Readonly<Record<string, string>>
  >({});
  const values = stringValues(value);
  const upload = useMutation({
    mutationFn: (selected: File) =>
      uploadWorkflowTestFile({
        csrfToken,
        file: selected,
        onProgress: setProgress,
        workspaceId,
      }),
    onMutate: () => {
      setProgress(0);
      onBusyChange(true);
    },
    onSuccess: (artifactId, selected) => {
      setUploadedNames((current) => ({
        ...current,
        [artifactId]: selected.name,
      }));
      onChange(multiple ? [...values, artifactId] : artifactId);
    },
    onSettled: () => {
      onBusyChange(false);
    },
  });

  const modes = [
    ...(file.transfer === "upload" || file.transfer === "both"
      ? [
          {
            label: t("workflows.candidate.fileUpload"),
            value: "upload" as const,
          },
        ]
      : []),
    ...(file.transfer === "url" || file.transfer === "both"
      ? [
          {
            label: t("workflows.candidate.fileLink"),
            value: "url" as const,
          },
        ]
      : []),
  ];
  let control: ReactNode;
  if (mode === "upload") {
    control = (
      <div className="grid gap-2">
        <Upload
          accept="image/jpeg,image/png,image/webp"
          beforeUpload={(selected) => {
            upload.mutate(selected);
            return Upload.LIST_IGNORE;
          }}
          disabled={upload.isPending}
          multiple={multiple}
          showUploadList={false}
        >
          <Button
            block
            icon={<UploadOutlined aria-hidden="true" />}
            loading={upload.isPending}
          >
            {upload.isPending
              ? t("workflows.candidate.fileUploading", { progress })
              : t("workflows.candidate.chooseLocalFile")}
          </Button>
        </Upload>
        {values.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {values.map((artifactId) => (
              <Tag
                closable
                closeIcon={<DeleteOutlined aria-hidden="true" />}
                key={artifactId}
                onClose={() => {
                  const next = values.filter((item) => item !== artifactId);
                  onChange(multiple ? next : undefined);
                }}
              >
                {uploadedNames[artifactId] ??
                  t("workflows.candidate.uploadedFile")}
              </Tag>
            ))}
          </div>
        ) : null}
        {upload.isError ? (
          <Alert
            description={t("workflows.candidate.fileUploadFailed")}
            showIcon
            type="error"
          />
        ) : null}
      </div>
    );
  } else if (multiple) {
    control = (
      <Input.TextArea
        autoSize={{ minRows: 2, maxRows: 5 }}
        onChange={(event) =>
          onChange(
            event.currentTarget.value
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean),
          )
        }
        placeholder={t("workflows.candidate.fileLinkListPlaceholder")}
        value={values.join("\n")}
        variant="filled"
      />
    );
  } else {
    control = (
      <Input
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={t("workflows.candidate.fileLinkPlaceholder")}
        prefix={<LinkOutlined aria-hidden="true" />}
        value={values[0] ?? ""}
        variant="filled"
      />
    );
  }

  return (
    <div className="grid gap-2 rounded-xl bg-mist p-3">
      {modes.length > 1 ? (
        <Segmented
          block
          onChange={(nextMode) => setMode(nextMode)}
          options={modes}
          value={mode}
        />
      ) : null}
      {control}
    </div>
  );
}
