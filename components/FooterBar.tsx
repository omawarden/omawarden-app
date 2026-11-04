import { Text, View } from "nsh";
import { Button } from "nsh/base";
import * as store from "../store/appStore";
import { tint } from "../theme/palette";
import { actionID, focusOutline, useAction } from "./ui";

const SHORTCUTS = [
  "↑↓ Navigate",
  "⏎ Primary Copy",
  "Ctrl+K Actions",
  "Ctrl+G Generator",
  "Ctrl+R Sync",
  "Ctrl+L Lock",
  "Ctrl+, Settings",
];

export function FooterBar() {
  const palette = store.palette;
  const snap = store.snapshot;
  const update = store.updateStatus;
  const updateID = actionID("update-badge");
  useAction(updateID, store.openReleaseNotes);
  const updateFocused = () => store.focusedAction() === updateID;
  const updateAccent = () => palette().info;
  const updateBackground = () => tint(palette().info, palette().menu.background, 0.2);

  return (
    <View
      testID="footer-bar"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 12,
        paddingVertical: 6,
        backgroundColor: palette().menu.background,
        borderTopWidth: 1,
        borderTopColor: palette().menu.border,
        flexWrap: "wrap",
      }}
    >
      <Each of={SHORTCUTS} key="index">
        {(shortcut) => (
          <Text style={{ color: palette().muted, fontSize: 10 }}>{shortcut()}</Text>
        )}
      </Each>
      <View style={{ flex: 1 }} />
      <Text style={{ color: palette().muted, fontSize: 10 }}>
        Theme: {store.theme() === "light" ? "Light" : "Dark"}
      </Text>
      <Text style={{ color: palette().muted, fontSize: 10 }}>
        Engine {snap().engineVersion ?? "unknown"}
      </Text>
      {snap().lastSync ? (
        <Text style={{ color: palette().muted, fontSize: 10 }}>Synced {snap().lastSync}</Text>
      ) : null}
      {update()?.available ? (
        <Button
          testID="update-badge"
          onPress={store.openReleaseNotes}
          style={{
            backgroundColor: updateBackground(),
            borderColor: updateFocused() ? updateAccent() : updateBackground(),
            borderWidth: 1,
            borderRadius: 999,
            paddingHorizontal: 8,
            paddingVertical: 2,
            ...focusOutline(updateFocused(), updateAccent()),
          }}
          hoverStyle={{
            backgroundColor: tint(updateAccent(), updateBackground(), 0.22),
            borderColor: updateAccent(),
          }}
          activeStyle={{ backgroundColor: tint(updateAccent(), updateBackground(), 0.34) }}
          focusStyle={{ borderColor: updateAccent() }}
        >
          <Text style={{ color: palette().info, fontSize: 10, fontWeight: "bold" }}>
            Update {update()?.latestVersion}
          </Text>
        </Button>
      ) : null}
    </View>
  );
}
