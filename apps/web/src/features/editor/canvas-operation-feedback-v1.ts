const internalImplementationPattern =
  /\b(?:api|app(?:lication)?id|artifact|attempt|binding|budget|capability|credential|deployment|idempotency|provider|queue|revision|route|runtime|schema|secret|settlement|transport|worker|workflow)\b|执行环境|内部路由|模型渠道|凭据|供应商/iu;

const unsafeMessagePattern =
  /(?:https?:\/\/|[A-Z0-9_]{8,}=|[{[]\s*["']?[A-Za-z0-9_-]+["']?\s*:)/u;
const OPERATION_FEEDBACK_MAX_LENGTH = 180;

export function canvasOperationUserMessageV1(
  error: unknown,
  fallback: string,
): string {
  if (!(error instanceof Error)) {
    return fallback;
  }
  const message = error.message.trim();
  if (
    message.length === 0 ||
    message.length > OPERATION_FEEDBACK_MAX_LENGTH ||
    internalImplementationPattern.test(message) ||
    unsafeMessagePattern.test(message)
  ) {
    return fallback;
  }
  return message;
}
