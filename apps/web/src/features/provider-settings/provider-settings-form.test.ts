import { describe, expect, it } from "vitest";

import {
  clearProviderCreateFieldError,
  firstProviderCreateErrorField,
  parseProviderModelKeys,
  providerApiKeyError,
  providerBaseUrlError,
  providerModelIdentifierError,
  validateProviderCreateFields,
} from "./provider-settings-form.js";

const validValues = {
  preset: "newapi",
  displayName: "团队模型服务",
  baseUrl: "https://models.example.com/v1",
  apiKey: "sk-provider-test",
  modelKeys: "image-edit-v1,image-generate-v1",
} as const;

describe("provider settings form", () => {
  it("returns field errors in the visual interaction order", () => {
    const errors = validateProviderCreateFields({
      preset: "newapi",
      displayName: "",
      baseUrl: "",
      apiKey: "",
      modelKeys: "",
    });
    expect(errors).toMatchObject({
      displayName: "请输入服务名称。",
      baseUrl: "请输入模型服务地址。",
      apiKey: "请输入 API Key。",
    });
    expect(firstProviderCreateErrorField(errors)).toBe("displayName");
  });

  it("rejects unsafe URLs, malformed secrets and duplicate models locally", () => {
    expect(
      validateProviderCreateFields({
        ...validValues,
        baseUrl: "https://user:pass@models.example.com/v1?debug=1",
        apiKey: " secret ",
        modelKeys: "image-edit-v1, image-edit-v1",
      }),
    ).toMatchObject({
      baseUrl: "服务地址必须使用 HTTPS，且不能包含账号、查询参数或片段。",
      apiKey: "API Key 不能包含首尾空格。",
      modelKeys: "模型 ID 不能重复。",
    });
  });

  it("normalizes a bounded comma-separated model list", () => {
    expect(
      parseProviderModelKeys(" image-edit-v1, ,image-generate-v1 "),
    ).toEqual(["image-edit-v1", "image-generate-v1"]);
    expect(validateProviderCreateFields(validValues)).toEqual({});
    expect(
      validateProviderCreateFields({ ...validValues, modelKeys: "" }),
    ).toEqual({});
  });

  it("uses the same bounded secret rule for rotation", () => {
    expect(providerApiKeyError("")).toBe("请输入 API Key。");
    expect(providerApiKeyError("sk-valid")).toBeUndefined();
  });

  it("validates the NewAPI discovery URL before sending credentials", () => {
    expect(
      providerBaseUrlError("https://models.example.com/v1"),
    ).toBeUndefined();
    expect(
      providerBaseUrlError("https://user:pass@models.example.com/v1"),
    ).toBe("服务地址必须使用 HTTPS，且不能包含账号、查询参数或片段。");
  });

  it("accepts official mixed-case model identifiers and explains invalid input", () => {
    expect(providerModelIdentifierError("minimax/MiniMax-M3")).toBeUndefined();
    expect(providerModelIdentifierError("MiniMax M3")).toBe(
      "请使用英文字母、数字、点、下划线、斜杠或连字符，最多 160 个字符。",
    );
  });

  it("clears only the corrected field", () => {
    expect(
      clearProviderCreateFieldError(
        {
          displayName: "请输入服务名称。",
          apiKey: "请输入 API Key。",
        },
        "displayName",
      ),
    ).toEqual({
      apiKey: "请输入 API Key。",
    });
  });
});
