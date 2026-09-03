import type { ModelSelection, OrchestrationThread } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";

export interface CacheCountdownEstimate {
  readonly expiresAt: number;
  readonly durationMs: number;
  readonly basis: "usage" | "completion";
}

type CacheThread = Pick<
  OrchestrationThread,
  "latestTurn" | "session" | "modelSelection" | "activities"
>;

// These are deliberately estimates: CLI transports do not report cache expiry or
// the request's retention policy. Keep unknown runtimes/models out of the clock.
// https://developers.openai.com/api/docs/guides/prompt-caching#cache-lifetime
// https://code.claude.com/docs/en/prompt-caching#cache-lifetime
function estimateCacheDuration(provider: string | null | undefined, model: string): number | null {
  if (
    provider === "claudeAgent" &&
    /^(?:claude-|opus(?:$|[.-])|sonnet(?:$|[.-])|haiku(?:$|[.-]))/i.test(model)
  )
    return 5 * 60_000;
  if (provider !== "codex") return null;
  if (/^gpt-5\.[56](?:-|$)/i.test(model)) return 30 * 60_000;
  if (/^gpt-5(?:\.[0-4])?(?:-|$)/i.test(model)) return 5 * 60_000;
  return null;
}

/** Restores the estimate from persisted turn data, without restarting it on arrival. */
export function deriveCacheCountdown(
  thread: CacheThread | null | undefined,
  selectedModel?: ModelSelection | null,
): CacheCountdownEstimate | null {
  const turn = thread?.latestTurn;
  if (!thread || !turn || turn.state !== "completed" || !turn.completedAt) return null;
  if (thread.session?.status === "running" || thread.session?.status === "starting") return null;
  if (
    selectedModel &&
    (selectedModel.instanceId !== thread.modelSelection.instanceId ||
      selectedModel.model !== thread.modelSelection.model)
  )
    return null;
  if (
    thread.session?.providerInstanceId &&
    thread.session.providerInstanceId !== thread.modelSelection.instanceId
  )
    return null;

  const durationMs = estimateCacheDuration(
    thread.session?.providerName,
    thread.modelSelection.model,
  );
  const completedAt = Date.parse(turn.completedAt);
  const startedAt = Date.parse(turn.startedAt ?? turn.requestedAt);
  if (
    durationMs === null ||
    !Number.isFinite(completedAt) ||
    !Number.isFinite(startedAt) ||
    completedAt < startedAt
  )
    return null;

  let lastUsageAt: number | null = null;
  for (const activity of thread.activities) {
    if (
      activity.kind !== "context-window.updated" ||
      (activity.turnId !== null && activity.turnId !== turn.turnId)
    )
      continue;
    const timestamp = Date.parse(activity.createdAt);
    if (!Number.isFinite(timestamp) || timestamp < startedAt || timestamp > completedAt) continue;
    const payload = activity.payload;
    if (
      !payload ||
      typeof payload !== "object" ||
      !("usedTokens" in payload) ||
      typeof payload.usedTokens !== "number" ||
      !Number.isFinite(payload.usedTokens) ||
      payload.usedTokens <= 0
    )
      continue;
    lastUsageAt = Math.max(lastUsageAt ?? timestamp, timestamp);
  }

  return {
    expiresAt: (lastUsageAt ?? completedAt) + durationMs,
    durationMs,
    basis: lastUsageAt === null ? "completion" : "usage",
  };
}

export function getCacheCountdownState(estimate: CacheCountdownEstimate, now: number) {
  const remainingMs = Math.max(0, Math.min(estimate.durationMs, estimate.expiresAt - now));
  const seconds = Math.ceil(remainingMs / 1_000);
  const time = `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
  return {
    remainingMs,
    fraction: remainingMs / estimate.durationMs,
    ending: remainingMs > 0 && remainingMs <= 60_000,
    label: remainingMs > 0 ? `Estimated cache remaining ${time}` : "Estimated cache window ended",
  };
}

export function describeCacheCountdown(estimate: CacheCountdownEstimate): string {
  const basis = estimate.basis === "usage" ? "the last usage update" : "reply completion";
  return `A ${estimate.durationMs / 60_000}-minute estimate from ${basis}. Actual retention depends on the provider and sign-in method and may be longer. A cache hit is not guaranteed. Chat history is kept.`;
}

const countdownTicks = Effect.fn("cacheCountdown.ticks")(function* (
  estimate: CacheCountdownEstimate,
  onTick: (state: ReturnType<typeof getCacheCountdownState>) => void,
) {
  while (true) {
    const state = getCacheCountdownState(estimate, yield* Clock.currentTimeMillis);
    yield* Effect.sync(() => onTick(state));
    if (state.remainingMs <= 0) return;
    yield* Effect.sleep(Math.min(1_000, state.remainingMs));
  }
});

/** Runs only while a client is visible; the caller stops and restarts on visibility changes. */
export function watchCacheCountdown(
  estimate: CacheCountdownEstimate,
  onTick: (state: ReturnType<typeof getCacheCountdownState>) => void,
): () => void {
  const fiber = Effect.runFork(countdownTicks(estimate, onTick));
  return () => {
    Effect.runFork(Fiber.interrupt(fiber));
  };
}
