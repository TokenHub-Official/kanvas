import type { UserImportUploadSession } from "@kanvas/contracts/api";
import { httpStatus } from "../../api/http-status.js";

export type CanvasImportResumeAction = "commit" | "upload" | "wait";

export function canvasImportErrorOnStart(
  previousStatus: "uploading" | "processing" | "failed",
  currentError: string | undefined,
): string | undefined {
  return previousStatus === "failed" ? undefined : currentError;
}

export function canvasImportFailureMessage(
  error: unknown,
  uploadCompleted: boolean,
  online = typeof navigator === "undefined" ? true : navigator.onLine,
): string {
  const status =
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof error.status === "number"
      ? error.status
      : undefined;
  const isNetworkFailure =
    !online ||
    status === 0 ||
    (error instanceof TypeError &&
      error.message.toLocaleLowerCase("en-US") === "failed to fetch");
  if (status === httpStatus.forbidden) {
    return "当前权限已变化，图片未上传。图片仍保留在画板；恢复画板与素材编辑权限后可重试。";
  }
  if (isNetworkFailure && uploadCompleted) {
    return "上传结果暂时无法确认。图片仍保留在画板，请重试以恢复同一上传会话。";
  }
  if (isNetworkFailure) {
    return "图片上传已中断。图片仍保留在画板，请检查网络后重试。";
  }
  return error instanceof Error ? error.message : "图片上传失败。请重试。";
}

export function canvasImportShouldRestoreSavedStatus(
  currentStatus: string,
  pendingUploadCount: number,
  fingerprintMatchesSaved: boolean,
): boolean {
  return (
    currentStatus === "uploading" &&
    pendingUploadCount === 0 &&
    fingerprintMatchesSaved
  );
}

export function canvasImportResumeAction(
  state: UserImportUploadSession["state"],
  uploadCompleted: boolean,
): CanvasImportResumeAction {
  if (uploadCompleted || state === "verified" || state === "committed") {
    return "commit";
  }
  return state === "open" ? "upload" : "wait";
}
