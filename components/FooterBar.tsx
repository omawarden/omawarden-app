import { Animated, createMotion, effect, Text, View } from "nsh";
import { Button } from "nsh/base";
import * as store from "../store/appStore";
import * as paletteActions from "../store/actionPalette";
import { tint } from "../theme/palette";
import { Icon, type IconName } from "./Icon";
import { actionID, focusOutline, useAction } from "./ui";

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
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 6,
        backgroundColor: palette().menu.background,
        borderTopWidth: 1,
        borderTopColor: palette().menu.border,
        flexWrap: "wrap",
      }}
    >
      <FooterAction
        icon="zap"
        label="Actions"
        shortcut="Ctrl+K"
        testID="open-actions"
        onPress={paletteActions.openPalette}
      />
      <FooterAction
        icon="key"
        label="Generate"
        shortcut="Ctrl+G"
        testID="open-generator"
        onPress={store.openGenerator}
      />
      <FooterAction
        icon="refresh-cw"
        label="Sync"
        shortcut="Ctrl+R"
        testID="sync-vault"
        onPress={store.sync}
      />
      {store.isSyncing() ? <SyncIndicator /> : null}
      <FooterAction
        icon="lock"
        label="Lock"
        shortcut="Ctrl+L"
        testID="lock-vault"
        onPress={() => store.lockOrLogout(false)}
      />
      <FooterAction
        icon="settings"
        label="Settings"
        shortcut="Ctrl+,"
        testID="open-settings"
        onPress={store.openSettings}
      />
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

/** A small refresh glyph that spins while a sync is in flight. */
function SyncIndicator() {
  const palette = store.palette;
  const motion = createMotion();
  effect(() => {
    if (!store.isSyncing()) {
      motion.reset();
      return;
    }
    const spin = Animated.loop(
      Animated.timing(motion.rotate, { toValue: 360, duration: 900, easing: "linear" }),
    );
    spin.start();
    return () => {
      spin.stop();
      motion.reset();
    };
  });

  return (
    <View
      testID="sync-indicator"
      accessibilityLabel="Syncing"
      style={{
        width: 14,
        height: 14,
        alignItems: "center",
        justifyContent: "center",
        ...motion.style,
      }}
    >
      <Icon name="refresh-cw" size={12} color={palette().muted} />
    </View>
  );
}

function FooterAction(props: {
  icon: IconName;
  label: string;
  shortcut: string;
  testID: string;
  onPress: () => void;
}) {
  const palette = store.palette;
  const id = actionID(props.testID);
  useAction(id, () => props.onPress());
  const focused = () => store.focusedAction() === id;
  const accent = () => palette().menu.selectedText;
  const background = () => palette().menu.background;
  return (
    <Button
      testID={props.testID}
      accessibilityLabel={`${props.label} (${props.shortcut})`}
      onPress={props.onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 4,
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 4,
        backgroundColor: "transparent",
        ...focusOutline(focused(), accent()),
      }}
      hoverStyle={{ backgroundColor: tint(accent(), background(), 0.08) }}
      activeStyle={{ backgroundColor: tint(accent(), background(), 0.16) }}
      focusStyle={{ backgroundColor: tint(accent(), background(), 0.08) }}
    >
      <Icon name={props.icon} size={11} color={palette().muted} />
      <Text style={{ color: palette().muted, fontSize: 11, fontWeight: "bold" }}>
        {props.label}
      </Text>
      <Text style={{ color: palette().muted, fontSize: 9 }}>{props.shortcut}</Text>
    </Button>
  );
}
