import { memo, useEffect, useState } from "react";
import {
  describeCacheCountdown,
  getCacheCountdownState,
  watchCacheCountdown,
  type CacheCountdownEstimate,
} from "@t3tools/client-runtime/cache-countdown";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";

export const CacheCountdown = memo(function CacheCountdown({
  estimate,
}: {
  estimate: CacheCountdownEstimate;
}) {
  const [state, setState] = useState(() => getCacheCountdownState(estimate, Date.now()));
  useEffect(() => {
    let stop: (() => void) | undefined;
    const sync = () => {
      stop?.();
      stop =
        document.visibilityState === "visible"
          ? watchCacheCountdown(estimate, setState)
          : undefined;
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      stop?.();
      document.removeEventListener("visibilitychange", sync);
    };
  }, [estimate]);

  const circumference = 2 * Math.PI * 9;
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        render={
          <Button
            size="icon-sm"
            variant="ghost-muted"
            className="size-7 rounded-full"
            aria-label={state.label}
          >
            <svg
              viewBox="0 0 24 24"
              className={`size-5 mx-0! ${state.ending ? "text-amber-500 dark:text-amber-400" : "text-muted-foreground/70"}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" opacity="0.25" />
              {state.remainingMs > 0 ? (
                <>
                  <circle
                    cx="12"
                    cy="12"
                    r="9"
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={circumference * (1 - state.fraction)}
                    transform="rotate(-90 12 12)"
                  />
                  <path
                    d="M12 12V6.5"
                    strokeLinecap="round"
                    transform={`rotate(${state.fraction * 360} 12 12)`}
                  />
                  <circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none" />
                </>
              ) : null}
            </svg>
          </Button>
        }
      />
      <PopoverPopup
        tooltipStyle
        side="top"
        align="end"
        className="w-64 max-w-none whitespace-normal text-left"
      >
        <div className="flex flex-col gap-1.5">
          <div className="text-xs font-medium tabular-nums">{state.label}</div>
          <div className="text-[11px] text-secondary-label">{describeCacheCountdown(estimate)}</div>
        </div>
      </PopoverPopup>
    </Popover>
  );
});
