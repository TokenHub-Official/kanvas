import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import "../../i18n/i18n.js";
import { describe, expect, it } from "vitest";

import {
  AgentComposer,
  agentComposerCanSubmit,
  agentComposerHasFilePayload,
  agentComposerImageFiles,
  agentComposerKeyboardAction,
} from "./agent-composer.js";
import { filterAgentComposerReferences } from "./agent-composer-reference-picker.js";

describe("Agent Composer", () => {
  it("accepts an explicit send while attachments are uploading", () => {
    expect(
      agentComposerCanSubmit({
        attachmentBusy: true,
        queueMode: false,
        running: false,
        sendBlocked: false,
        value: "制作海报",
      }),
    ).toBe(true);
  });
  it("exposes full upload progress and blocks a failed attachment", () => {
    function markup(status: "uploading" | "error") {
      return renderToStaticMarkup(
        createElement(AgentComposer, {
          addAttachmentLabel: "Add",
          ariaLabel: "Message",
          errorLabel: "Upload failed; remove and retry",
          removeAttachmentLabel: "Remove",
          sendLabel: "Send",
          uploadingLabel: "Uploading image",
          placeholder: "Message",
          value: "Make a poster",
          onChange: () => {},
          onSend: () => {},
          attachments: [
            {
              id: "1",
              name: "poster.png",
              previewUrl: "",
              progress: 75,
              status,
            },
          ],
        }),
      );
    }
    const uploading = markup("uploading");
    expect(uploading).toContain('role="progressbar"');
    expect(uploading).toContain('aria-valuenow="75"');
    expect(uploading).toContain("Uploading image 75%");
    expect(
      uploading.match(/<button[^>]*aria-label="Send"[^>]*>/u)?.[0],
    ).not.toContain("disabled");
    const failed = markup("error");
    expect(failed.match(/<button[^>]*aria-label="Send"[^>]*>/u)?.[0]).toContain(
      "disabled",
    );
    expect(failed).toContain("Upload failed; remove and retry");
  });

  it("keeps Shift+Enter in the draft instead of sending it", () => {
    expect(
      agentComposerKeyboardAction({
        key: "Enter",
        keyCode: 13,
        composing: false,
        control: false,
        meta: false,
        shift: true,
      }),
    ).toBe("newline");
  });
  it("sends with Enter, inserts a newline with Mod+Enter, and preserves IME input", () => {
    expect(
      agentComposerKeyboardAction({
        key: "Enter",
        keyCode: 13,
        composing: false,
        control: false,
        meta: false,
      }),
    ).toBe("send");
    expect(
      agentComposerKeyboardAction({
        key: "Enter",
        keyCode: 13,
        composing: false,
        control: false,
        meta: true,
      }),
    ).toBe("newline");
    expect(
      agentComposerKeyboardAction({
        key: "Enter",
        keyCode: 229,
        composing: true,
        control: false,
        meta: false,
      }),
    ).toBe("none");
  });

  it("accepts only supported non-empty image files", () => {
    const files = [
      new File(["png"], "image.png", { type: "image/png" }),
      new File(["svg"], "image.svg", { type: "image/svg+xml" }),
      new File([], "empty.webp", { type: "image/webp" }),
    ];
    expect(agentComposerImageFiles(files).map((file) => file.name)).toEqual([
      "image.png",
    ]);
  });

  it("recognizes a browser file drag before file metadata is available", () => {
    expect(agentComposerHasFilePayload({ types: ["Files"] })).toBe(true);
    expect(agentComposerHasFilePayload({ types: ["text/plain"] })).toBe(false);
  });

  it("turns Enter into an explicit queued send while a reply is running", () => {
    expect(
      agentComposerCanSubmit({
        attachmentBusy: false,
        queueMode: true,
        running: true,
        sendBlocked: false,
        value: "下一条要求",
      }),
    ).toBe(true);
    expect(
      agentComposerCanSubmit({
        attachmentBusy: false,
        queueMode: false,
        running: true,
        sendBlocked: false,
        value: "下一条要求",
      }),
    ).toBe(false);
    expect(
      agentComposerCanSubmit({
        attachmentBusy: false,
        queueMode: true,
        running: true,
        sendBlocked: true,
        value: "下一条要求",
      }),
    ).toBe(false);
  });

  it("searches Composer references by user-facing title and description", () => {
    const items = [
      {
        kind: "canvas" as const,
        id: "canvas:1",
        title: "秋季新品画板",
        description: "3 个页面",
        resourceId: "01K00000000000000000000001",
        version: 2,
      },
      {
        kind: "brand" as const,
        id: "brand:1",
        title: "Kanvas Main",
        brandKitId: "01K00000000000000000000002",
        brandKitRevisionId: "01K00000000000000000000003",
      },
    ];
    expect(filterAgentComposerReferences(items, "新品")).toEqual([items[0]]);
    expect(filterAgentComposerReferences(items, "main")).toEqual([items[1]]);
  });
});
