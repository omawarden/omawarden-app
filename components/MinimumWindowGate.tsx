import { Text, View, windowSize } from "nsh";
import * as store from "../store/appStore";
import { windowBelowMinimum } from "../store/windowGate";
import { MIN_WINDOW_HEIGHT, MIN_WINDOW_WIDTH } from "../theme/layout";

const formatSize = (width: number, height: number) =>
  `${Math.round(width)} × ${Math.round(height)}`;

// An opaque overlay, not a replacement: the workspace, dialogs and toast stay
// mounted underneath so a shrink-and-restore cycle loses nothing. It has no
// controls on purpose; only resizing the window clears it.
export function MinimumWindowGate() {
  const palette = store.palette;
  return (
    <If when={windowBelowMinimum()}>
      <View
        testID="minimum-window-gate"
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          backgroundColor: palette().menu.background,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
      >
        <View style={{ alignItems: "center", gap: 8 }}>
          <Text
            testID="minimum-window-gate-title"
            style={{ color: palette().menu.text, fontSize: 20, fontWeight: "bold" }}
          >
            Window too small
          </Text>
          <Text
            testID="minimum-window-gate-size"
            style={{ color: palette().menu.text, fontSize: 14 }}
          >
            {`Current size: ${formatSize(windowSize().width, windowSize().height)}`}
          </Text>
          <Text
            testID="minimum-window-gate-minimum"
            style={{ color: palette().muted, fontSize: 13 }}
          >
            {`Minimum: ${formatSize(MIN_WINDOW_WIDTH, MIN_WINDOW_HEIGHT)}`}
          </Text>
          <Text
            testID="minimum-window-gate-instruction"
            style={{ color: palette().muted, fontSize: 13, textAlign: "center" }}
          >
            Resize the window to continue.
          </Text>
        </View>
      </View>
    </If>
  );
}
