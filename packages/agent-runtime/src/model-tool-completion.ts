import type {
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
} from "@ai-sdk/provider";

/** A syntactically complete tool argument is not proof the model step completed. */
export function completedToolStream(
  result: LanguageModelV3StreamResult,
): LanguageModelV3StreamResult {
  const pending: LanguageModelV3StreamPart[] = [];
  let finish:
    Extract<LanguageModelV3StreamPart, { type: "finish" }> | undefined;
  let failed = false;
  return {
    ...result,
    stream: result.stream.pipeThrough(
      new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>(
        {
          transform(part, controller) {
            if (part.type === "finish") {
              finish = part;
            } else if (
              part.type === "tool-call" ||
              part.type === "tool-input-start" ||
              part.type === "tool-input-delta" ||
              part.type === "tool-input-end"
            ) {
              pending.push(part);
            } else {
              if (part.type === "error") failed = true;
              controller.enqueue(part);
            }
          },
          flush(controller) {
            if (!finish) {
              throw Object.assign(
                new Error("Model stream ended without a completion marker."),
                {
                  code: "agent.model_output_incomplete",
                },
              );
            }
            if (
              !failed &&
              (finish.finishReason.unified === "stop" ||
                finish.finishReason.unified === "tool-calls")
            ) {
              for (const part of pending) controller.enqueue(part);
            }
            controller.enqueue(finish);
          },
        },
      ),
    ),
  };
}
