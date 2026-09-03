import {
  EventId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationThreadActivity,
} from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  deriveCacheCountdown,
  getCacheCountdownState,
  watchCacheCountdown,
} from "./cacheCountdown.ts";

const completedAt = "2026-09-03T10:02:00.000Z";
const completedMs = Date.parse(completedAt);
const turnId = TurnId.make("turn-1");
const instanceId = ProviderInstanceId.make("codex-custom");
function thread() {
  return {
    modelSelection: { instanceId, model: "gpt-5.6-sol" },
    latestTurn: {
      turnId,
      state: "completed" as const,
      requestedAt: "2026-09-03T10:00:00.000Z",
      startedAt: "2026-09-03T10:00:01.000Z",
      completedAt,
      assistantMessageId: null,
    },
    session: {
      threadId: ThreadId.make("thread-1"),
      status: "ready" as const,
      providerName: "codex",
      providerInstanceId: instanceId,
      runtimeMode: "full-access" as const,
      activeTurnId: null,
      lastError: null,
      updatedAt: completedAt,
    },
    activities: [] as OrchestrationThreadActivity[],
  };
}
function usage(overrides: Partial<OrchestrationThreadActivity> = {}): OrchestrationThreadActivity {
  return {
    id: EventId.make("usage-1"),
    tone: "info",
    kind: "context-window.updated",
    summary: "Context window updated",
    payload: { usedTokens: 4_000 },
    turnId,
    createdAt: "2026-09-03T10:01:30.000Z",
    ...overrides,
  };
}

describe("deriveCacheCountdown", () => {
  it("estimates from completion when usage is unavailable, including after reload", () => {
    expect(deriveCacheCountdown(thread())).toEqual({
      expiresAt: completedMs + 30 * 60_000,
      durationMs: 30 * 60_000,
      basis: "completion",
    });
    expect(deriveCacheCountdown(JSON.parse(JSON.stringify(thread())))).toEqual(
      deriveCacheCountdown(thread()),
    );
  });

  it("uses the latest valid usage update in the completed turn without adding checkpoint delay", () => {
    const input = thread();
    input.activities = [
      usage(),
      usage({ createdAt: "2026-09-03T10:01:20.000Z" }),
      usage({ turnId: TurnId.make("another-turn"), createdAt: completedAt }),
      usage({ createdAt: "2026-09-03T10:03:00.000Z" }),
      usage({ createdAt: "2026-09-03T09:59:00.000Z" }),
      usage({ createdAt: completedAt, payload: { usedTokens: NaN } }),
    ];
    expect(deriveCacheCountdown(input)).toEqual({
      expiresAt: Date.parse("2026-09-03T10:31:30.000Z"),
      durationMs: 30 * 60_000,
      basis: "usage",
    });
  });

  it("accepts turnless usage only within the completed turn's time window", () => {
    const input = thread();
    input.activities = [usage({ turnId: null })];
    expect(deriveCacheCountdown(input)?.basis).toBe("usage");
    input.activities = [usage({ turnId: null, createdAt: "2026-09-03T09:00:00.000Z" })];
    expect(deriveCacheCountdown(input)?.basis).toBe("completion");
  });

  it.each(["running", "error", "interrupted"] as const)(
    "hides the clock during a %s turn",
    (state) => {
      const input = thread();
      expect(
        deriveCacheCountdown({ ...input, latestTurn: { ...input.latestTurn, state } }),
      ).toBeNull();
    },
  );

  it("hides the old clock while another request is starting", () => {
    const input = thread();
    expect(
      deriveCacheCountdown({ ...input, session: { ...input.session, status: "starting" } }),
    ).toBeNull();
  });

  it("does not show an old model's or provider instance's estimate for a draft selection", () => {
    const input = thread();
    expect(deriveCacheCountdown(input, { ...input.modelSelection, model: "gpt-5.4" })).toBeNull();
    expect(
      deriveCacheCountdown(input, {
        ...input.modelSelection,
        instanceId: ProviderInstanceId.make("another"),
      }),
    ).toBeNull();
    expect(
      deriveCacheCountdown({
        ...input,
        session: { ...input.session, providerInstanceId: ProviderInstanceId.make("another") },
      }),
    ).toBeNull();
  });

  it.each(["cursor", "grok", "opencode", "unknown"])(
    "leaves %s without a fabricated cache window",
    (providerName) => {
      const input = thread();
      expect(
        deriveCacheCountdown({ ...input, session: { ...input.session, providerName } }),
      ).toBeNull();
    },
  );

  it.each([
    ["codex", "gpt-5.5", 30],
    ["codex", "gpt-5.6-terra", 30],
    ["codex", "gpt-5.4", 5],
    ["codex", "gpt-5-codex", 5],
    ["claudeAgent", "claude-sonnet-5", 5],
  ])("uses a documented estimate for %s / %s", (providerName, model, minutes) => {
    const input = thread();
    expect(
      deriveCacheCountdown({
        ...input,
        session: { ...input.session, providerName },
        modelSelection: { ...input.modelSelection, model },
      })?.durationMs,
    ).toBe(Number(minutes) * 60_000);
  });

  it("rejects missing turns, malformed timestamps and unknown Codex models", () => {
    const input = thread();
    expect(deriveCacheCountdown(null)).toBeNull();
    expect(deriveCacheCountdown({ ...input, latestTurn: null })).toBeNull();
    for (const value of [null, "invalid", "2026-09-03T09:00:00.000Z"]) {
      expect(
        deriveCacheCountdown({ ...input, latestTurn: { ...input.latestTurn, completedAt: value } }),
      ).toBeNull();
    }
    expect(
      deriveCacheCountdown({
        ...input,
        modelSelection: { ...input.modelSelection, model: "custom-model" },
      }),
    ).toBeNull();
  });

  it("starts a fresh estimate after the next successful reply", () => {
    const input = thread();
    const nextCompletedAt = "2026-09-03T11:00:00.000Z";
    expect(
      deriveCacheCountdown({
        ...input,
        latestTurn: {
          ...input.latestTurn,
          turnId: TurnId.make("turn-2"),
          completedAt: nextCompletedAt,
        },
      })?.expiresAt,
    ).toBe(Date.parse(nextCompletedAt) + 30 * 60_000);
  });
});

describe("countdown time and lifecycle", () => {
  const estimate = {
    expiresAt: completedMs + 5 * 60_000,
    durationMs: 5 * 60_000,
    basis: "completion" as const,
  };
  afterEach(() => vi.useRealTimers());

  it("shows remaining time, warns only in the last minute and leaves an empty ring at expiry", () => {
    expect(getCacheCountdownState(estimate, completedMs + 28_000)).toMatchObject({
      label: "Estimated cache remaining 04:32",
      ending: false,
    });
    expect(getCacheCountdownState(estimate, estimate.expiresAt - 60_000)).toMatchObject({
      ending: true,
      fraction: 0.2,
    });
    expect(getCacheCountdownState(estimate, estimate.expiresAt - 1)).toMatchObject({
      label: "Estimated cache remaining 00:01",
      ending: true,
    });
    expect(getCacheCountdownState(estimate, estimate.expiresAt + 10_000)).toMatchObject({
      fraction: 0,
      remainingMs: 0,
      ending: false,
      label: "Estimated cache window ended",
    });
    expect(getCacheCountdownState(estimate, completedMs - 10_000).fraction).toBe(1);
  });

  it("updates only the subscriber and stops scheduling at expiry", () => {
    vi.useFakeTimers();
    vi.setSystemTime(estimate.expiresAt - 2_500);
    const onTick = vi.fn();
    watchCacheCountdown(estimate, onTick);
    expect(onTick.mock.lastCall?.[0].remainingMs).toBe(2_500);
    vi.advanceTimersByTime(2_500);
    expect(onTick).toHaveBeenCalledTimes(4);
    expect(onTick.mock.lastCall?.[0].remainingMs).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels hidden/unmounted clocks and recomputes from the deadline on return", () => {
    vi.useFakeTimers();
    vi.setSystemTime(completedMs);
    const onTick = vi.fn();
    const stop = watchCacheCountdown(estimate, onTick);
    stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(completedMs + 4 * 60_000);
    const stopResumed = watchCacheCountdown(estimate, onTick);
    expect(onTick.mock.lastCall?.[0].remainingMs).toBe(60_000);
    stopResumed();
    vi.setSystemTime(estimate.expiresAt + 60_000);
    watchCacheCountdown(estimate, onTick);
    expect(onTick.mock.lastCall?.[0].remainingMs).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});
