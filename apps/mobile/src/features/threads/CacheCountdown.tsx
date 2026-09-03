import {
  describeCacheCountdown,
  getCacheCountdownState,
  watchCacheCountdown,
  type CacheCountdownEstimate,
} from "@t3tools/client-runtime/cache-countdown";
import { useFocusEffect } from "@react-navigation/native";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { AppState, BackHandler, Pressable, View, useWindowDimensions } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { withUniwind } from "uniwind";
import { AppText as Text } from "../../components/AppText";
import { OverlayPortal } from "../../components/OverlayPortal";
const ThemedSvg = withUniwind(Svg);

export const CacheCountdown = memo(function CacheCountdown({
  estimate,
}: {
  readonly estimate: CacheCountdownEstimate;
}) {
  const { width, height } = useWindowDimensions();
  const trigger = useRef<View>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [state, setState] = useState(() => getCacheCountdownState(estimate, Date.now()));
  useEffect(() => setAnchor(null), [width, height]);
  useFocusEffect(
    useCallback(() => {
      let stop: (() => void) | undefined;
      const sync = () => {
        stop?.();
        stop =
          AppState.currentState === "active" ? watchCacheCountdown(estimate, setState) : undefined;
        if (AppState.currentState !== "active") setAnchor(null);
      };
      sync();
      const subscription = AppState.addEventListener("change", sync);
      return () => {
        stop?.();
        subscription.remove();
        setAnchor(null);
      };
    }, [estimate]),
  );
  useEffect(() => {
    if (!anchor) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setAnchor(null);
      return true;
    });
    return () => subscription.remove();
  }, [anchor]);

  const circumference = 2 * Math.PI * 9;
  return (
    <>
      <Pressable
        ref={trigger}
        accessibilityRole="button"
        accessibilityLabel={state.label}
        accessibilityHint="Show the estimated prompt cache window"
        accessibilityState={{ expanded: anchor !== null }}
        className="h-11 w-8 shrink-0 items-center justify-center rounded-full active:opacity-70"
        onPress={() => trigger.current?.measureInWindow((x, y) => setAnchor({ x, y }))}
      >
        <ThemedSvg
          width={20}
          height={20}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          colorClassName={state.ending ? "accent-adaptive-amber-700-400" : "accent-icon-muted"}
          strokeWidth={1.5}
          accessible={false}
        >
          <Circle cx={12} cy={12} r={9} opacity={0.25} />
          {state.remainingMs > 0 ? (
            <>
              <Circle
                cx={12}
                cy={12}
                r={9}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={circumference * (1 - state.fraction)}
                rotation={-90}
                origin="12, 12"
              />
              <Path
                d="M12 12V6.5"
                strokeLinecap="round"
                rotation={state.fraction * 360}
                origin="12, 12"
              />
              <Circle cx={12} cy={12} r={0.8} fill="currentColor" stroke="none" />
            </>
          ) : null}
        </ThemedSvg>
      </Pressable>
      {anchor ? (
        <OverlayPortal>
          <Pressable
            className="absolute inset-0"
            accessibilityRole="button"
            accessibilityLabel="Dismiss cache details"
            onPress={() => setAnchor(null)}
          />
          <View
            accessibilityViewIsModal
            className="absolute gap-2 rounded-xl border border-border bg-card p-3"
            style={{
              width: Math.min(264, width - 24),
              left: Math.max(12, Math.min(anchor.x - 232, width - 276)),
              bottom: Math.max(12, height - anchor.y + 8),
            }}
          >
            <Text className="text-sm font-t3-medium text-foreground">{state.label}</Text>
            <Text className="text-xs text-foreground-muted">
              {describeCacheCountdown(estimate)}
            </Text>
          </View>
        </OverlayPortal>
      ) : null}
    </>
  );
});
