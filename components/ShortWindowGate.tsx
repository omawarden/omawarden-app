import { Text, View } from "nsh";
import * as store from "../store/appStore";
import { windowTooShortForShell } from "../store/shellScroll";
import { minimumWindowHeight } from "../theme/layout";

// An opaque overlay, not a replacement: the workspace, dialogs and toast stay
// mounted underneath so a shrink-and-restore cycle loses nothing. It has no
// controls on purpose; only resizing the window clears it.
//
// Width no longer takes part. A window too narrow for the shell keeps the
// layout at its floor and scrolls sideways (ADR 0006); the one dimension the
// shell cannot answer with a scroll is height, because the panes are vertical
// scrolls themselves. So this asks a shorter question than its predecessor did,
// and it names the height alone.
export function ShortWindowGate() {
  const palette = store.palette;
  const minimum = minimumWindowHeight();

  return (
    <If when={windowTooShortForShell()}>
      <View
        testID="short-window-gate"
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
            testID="short-window-gate-title"
            style={{ color: palette().menu.text, fontSize: store.type()["5xl"], fontWeight: "bold" }}
          >
            Window too short
          </Text>
          <Text
            testID="short-window-gate-minimum"
            style={{ color: palette().muted, fontSize: store.type().md }}
          >
            {`Minimum height: ${minimum} points`}
          </Text>
          <Text
            testID="short-window-gate-instruction"
            style={{ color: palette().muted, fontSize: store.type().md, textAlign: "center" }}
          >
            Make the window taller to continue.
          </Text>
        </View>
      </View>
    </If>
  );
}
