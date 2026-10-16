import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { describe, expect, it, vi } from "vitest";

import { i18n } from "../../i18n/i18n.js";
import type { CanvasImageCapabilityTool } from "./canvas-capability-tools.js";
import { CanvasOperationParametersV1 } from "./canvas-operation-parameters-v1.js";

const tool: CanvasImageCapabilityTool = {
  capabilityKey: "image.background.remove",
  category: "图像处理",
  completionBehavior: "review_required",
  id: "01K00000000000000000000041:remove",
  operationId: "image.background.remove",
  interactionBehavior: "form",
  label: "去背景",
  order: 10,
  outputArtifactPath: ["result", "foregroundArtifactId"],
  outputModes: ["add_node", "replace_content"],
  parametersSchemaId: "kanvas.image-background-remove.v1",
  parameterFields: [
    {
      key: "refinement",
      label: "处理精度",
      control: "select",
      required: true,
      defaultValue: "standard",
      options: [
        {
          value: "standard",
          label: "标准",
        },
        {
          value: "fine",
          label: "精细",
        },
      ],
    },
    {
      key: "subjectHint",
      label: "主体提示",
      control: "text",
      required: false,
      maxLength: 240,
    },
  ],
  sourceParameterKey: "source",
  sourceValue: "artifact_id",
  contractRevisionId: "01K00000000000000000000042",
};

describe("Canvas Operation parameters V1", () => {
  it("renders published fields and their bounded controls", () => {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <CanvasOperationParametersV1
          busy={false}
          onSubmit={vi.fn()}
          tool={tool}
        />
      </I18nextProvider>,
    );

    expect(markup).toContain("处理精度");
    expect(markup).toContain("主体提示");
    expect(markup).toContain('role="combobox"');
    expect(markup).toContain('maxLength="240"');
    expect(markup).toMatch(/开始去背景|Start 去背景/u);
    expect(markup).not.toMatch(
      /Provider|Worker|Capability|Workflow|执行环境|权限、额度|模型费用/u,
    );
  });
});
