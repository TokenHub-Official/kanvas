import { readProblem } from "../../api/transport.js";
import { toolRequest } from "./library-api.js";
export function createSiteCoverUploader(csrfToken: string) {
  const attempts = new WeakMap<
    File,
    { key: string; session?: string; transferred?: boolean }
  >();
  return async (file: File, signal: AbortSignal): Promise<string> => {
    const attempt = attempts.get(file) ?? {
      key: `site-cover:${crypto.randomUUID()}`,
    };
    attempts.set(file, attempt);
    if (!attempt.session) {
      const response = await toolRequest<{ uploadSessionId: string }>(
        "/api/v1/instance/cover-upload-sessions",
        {
          csrfToken,
          key: attempt.key,
          body: {
            name: file.name,
            expectedSize: file.size,
            expectedMediaType: file.type,
          },
        },
      );
      attempt.session = response.uploadSessionId;
    }
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    if (!attempt.transferred) {
      const response = await fetch(
        `/api/v1/instance/cover-upload-sessions/${attempt.session}/content`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": file.type, "x-kanvas-csrf": csrfToken },
          body: file,
          signal,
        },
      );
      if (!response.ok) throw await readProblem(response);
      attempt.transferred = true;
    }
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    const result = await toolRequest<{ imageId: string }>(
      `/api/v1/instance/cover-upload-sessions/${attempt.session}/commit`,
      { csrfToken, body: {} },
    );
    return result.imageId;
  };
}
