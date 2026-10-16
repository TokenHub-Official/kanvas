import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { beforeAll, describe, expect, it } from "vitest";

import { i18n } from "../../i18n/i18n.js";
import {
  effectiveInvocationArtifactWorkflowField,
  EffectiveInvocationFieldControl,
} from "./effective-invocation-field-control.js";

describe("Effective invocation field control", () => {
  beforeAll(async () => {
    await i18n.changeLanguage("zh-CN");
  });

  it("renders Artifact, Artifact list and JSON controls from the effective schema", () => {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <div>
          <EffectiveInvocationFieldControl
            field={{
              key: "sourceArtifactId",
              label: "Source",
              required: true,
              valueType: "artifact",
            }}
            onChange={() => undefined}
            value={undefined}
          />
          <EffectiveInvocationFieldControl
            field={{
              key: "referenceArtifactIds",
              label: "References",
              required: false,
              valueType: "artifact_list",
              minItems: 1,
              maxItems: 14,
              uniqueItems: true,
            }}
            onChange={() => undefined}
            value={undefined}
          />
          <EffectiveInvocationFieldControl
            field={{
              key: "sourcePlacement",
              label: "Source placement",
              required: true,
              valueType: "json",
              jsonType: "object",
              maxLength: 32_000,
            }}
            onChange={() => undefined}
            value={{ x: 0, y: 0 }}
          />
        </div>
      </I18nextProvider>,
    );

    expect(markup).toContain('pattern="[0-7][0-9A-HJKMNP-TV-Z]{25}"');
    expect(markup).toContain("每行填写一个 Artifact ID，也可用逗号分隔");
    expect(markup.match(/<textarea/gu)).toHaveLength(2);
    expect(markup).toContain("{\n  &quot;x&quot;: 0,\n  &quot;y&quot;: 0\n}");
  });

  it("does not render constant fields", () => {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <EffectiveInvocationFieldControl
          field={{
            key: "schemaVersion",
            label: "Schema version",
            required: true,
            valueType: "constant",
            value: "kanvas.image/v1",
          }}
          onChange={() => undefined}
          value={undefined}
        />
      </I18nextProvider>,
    );

    expect(markup).toBe("");
  });

  it("renders the placeholder owned by the Workflow input field", () => {
    const markup = renderToStaticMarkup(
      <I18nextProvider i18n={i18n}>
        <EffectiveInvocationFieldControl
          field={{
            key: "prompt",
            label: "海报需求",
            placeholder: "描述主题、风格和配色",
            required: true,
            valueType: "string",
            maxLength: 2000,
          }}
          onChange={() => undefined}
          value={undefined}
        />
      </I18nextProvider>,
    );
    expect(markup).toContain('placeholder="描述主题、风格和配色"');
  });

  it("projects Artifact fields into the shared upload and URL control contract", () => {
    expect(
      effectiveInvocationArtifactWorkflowField({
        key: "backgroundArtifactId",
        label: "背景图",
        description: "最终背景",
        required: true,
        valueType: "artifact",
      }),
    ).toMatchObject({
      key: "backgroundArtifactId",
      title: "背景图",
      type: "string",
      schema: {
        "x-kanvas-file": {
          categories: ["image"],
          transfer: "both",
        },
      },
    });
  });
});
