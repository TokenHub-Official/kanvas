import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import {
  libraryPreviewQueryOptions,
  libraryTextQueryOptions,
} from "./library-preview-query.js";

afterEach(() => vi.unstubAllGlobals());
it("keeps visited content across file switches without downloading again", async () => {
  const fetcher = vi.fn(() =>
    Promise.resolve(
      new Response("facts", { headers: { "content-type": "text/plain" } }),
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient();
  const options = libraryPreviewQueryOptions(
    "workspace",
    "original",
    "unsupported",
  );
  const observer = new QueryObserver(client, options);
  const unsubscribe = observer.subscribe(() => {});
  await client.fetchQuery(options);
  unsubscribe();
  await new Promise((resolve) => setTimeout(resolve, 10));
  await client.fetchQuery(
    libraryPreviewQueryOptions("workspace", "other", "unsupported"),
  );
  await client.fetchQuery(options);
  expect(fetcher).toHaveBeenCalledTimes(2);
  await client.fetchQuery(
    libraryPreviewQueryOptions("workspace", "replacement", "unsupported"),
  );
  await client.fetchQuery(
    libraryPreviewQueryOptions("other-workspace", "original", "unsupported"),
  );
  expect(fetcher).toHaveBeenCalledTimes(4);
  client.clear();
});
it("reuses extracted text during switches and revalidates after invalidation", async () => {
  const fetcher = vi.fn(() =>
    Promise.resolve(
      new Response(JSON.stringify({ text: "page", pageRanges: [] }), {
        headers: { "content-type": "application/json" },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient();
  const options = libraryTextQueryOptions("workspace", "library", "pdf", true);
  await client.fetchQuery(options);
  await client.fetchQuery(options);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await client.invalidateQueries({ queryKey: options.queryKey });
  await client.fetchQuery(options);
  expect(fetcher).toHaveBeenCalledTimes(2);
  client.clear();
});

it("revalidates expired content and propagates revoked access instead of a successful cache hit", async () => {
  const fetcher = vi.fn(() =>
    Promise.resolve(
      new Response("facts", { headers: { "content-type": "text/plain" } }),
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  const client = new QueryClient();
  const options = libraryPreviewQueryOptions(
    "workspace",
    "original",
    "unsupported",
  );
  try {
    const data = await client.fetchQuery(options);
    client.setQueryData(options.queryKey, data, {
      updatedAt: Date.now() - 31_000,
    });
    fetcher.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: "artifact_download.denied",
          title: "Unavailable",
          status: 403,
        }),
        {
          status: 403,
          headers: { "content-type": "application/problem+json" },
        },
      ),
    );
    await expect(client.fetchQuery(options)).rejects.toMatchObject({
      status: 403,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.getQueryState(options.queryKey)?.status).toBe("error");
  } finally {
    client.clear();
  }
});
