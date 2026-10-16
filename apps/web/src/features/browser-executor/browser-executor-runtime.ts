import type {
  ClaimBrowserAttemptResponse,
  RegisterBrowserExecutorBody,
  RegisteredBrowserExecutor,
} from "@kanvas/contracts/api";

import { httpStatus } from "../../api/http-status.js";
import { ApiProblem, type WorkspaceApiContext } from "../../api/transport.js";
import {
  claimBrowserAttempt,
  drainBrowserExecutor,
  registerBrowserExecutor,
} from "./browser-executor-transport.js";

type ClaimedBrowserAttempt = NonNullable<
  ClaimBrowserAttemptResponse["assignment"]
>;

const IDLE_POLL_INTERVAL_MS = 1_500;
const RETRY_DELAY_MS = 3_000;

async function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timer);
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new DOMException(
                "Browser Executor delay was aborted.",
                "AbortError",
              ),
        );
      },
      { once: true },
    );
  });
}

export interface BrowserExecutorRuntime {
  readonly done: Promise<void>;
  readonly stop: () => void;
}

export type BrowserExecutorStartupStage = "probe" | "register";

export class BrowserExecutorStartupError extends Error {
  public readonly stage: BrowserExecutorStartupStage;

  public constructor(stage: BrowserExecutorStartupStage, cause: unknown) {
    super(`Browser Executor ${stage} failed.`, { cause });
    this.name = "BrowserExecutorStartupError";
    this.stage = stage;
  }
}

export function browserExecutorAuthorityLost(error: unknown): boolean {
  return (
    error instanceof ApiProblem &&
    (error.status === httpStatus.unauthorized ||
      error.status === httpStatus.forbidden)
  );
}

export function startBrowserExecutorRuntime(options: {
  readonly context: WorkspaceApiContext;
  readonly executeAssignment: (
    assignment: ClaimedBrowserAttempt,
    rootSignal: AbortSignal,
  ) => Promise<void>;
  readonly featureProbe: () => void;
  readonly onError?: (error: unknown) => void;
  readonly onReady?: () => void;
  readonly registrationBody: () => Promise<RegisterBrowserExecutorBody>;
  readonly runtimeLabel: string;
}): BrowserExecutorRuntime {
  const root = new AbortController();
  let sessionId: string | undefined;
  let authorityLost = false;
  const done = (async () => {
    let registrationBody: RegisterBrowserExecutorBody;
    try {
      options.featureProbe();
      registrationBody = await options.registrationBody();
    } catch (error) {
      throw new BrowserExecutorStartupError("probe", error);
    }
    let registered: RegisteredBrowserExecutor;
    try {
      registered = await registerBrowserExecutor(
        options.context,
        registrationBody,
        root.signal,
      );
    } catch (error) {
      throw new BrowserExecutorStartupError("register", error);
    }
    sessionId = registered.sessionId;
    options.onReady?.();
    while (!root.signal.aborted) {
      try {
        const claimed = await claimBrowserAttempt(
          options.context,
          registered.sessionId,
          root.signal,
        );
        options.onReady?.();
        if (claimed.assignment) {
          await options.executeAssignment(claimed.assignment, root.signal);
        } else {
          await delay(IDLE_POLL_INTERVAL_MS, root.signal);
        }
      } catch (error) {
        if (root.signal.aborted) {
          break;
        }
        options.onError?.(error);
        if (browserExecutorAuthorityLost(error)) {
          authorityLost = true;
          break;
        }
        await delay(RETRY_DELAY_MS, root.signal);
      }
    }
  })().finally(async () => {
    if (sessionId && !authorityLost) {
      await drainBrowserExecutor(options.context, sessionId).catch(
        () => undefined,
      );
    }
  });
  return Object.freeze({
    done,
    stop() {
      root.abort(
        new DOMException(`${options.runtimeLabel} stopped.`, "AbortError"),
      );
    },
  });
}
