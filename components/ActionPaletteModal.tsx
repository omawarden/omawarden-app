import { effect, keymap, Text, View } from "nsh";
import { Button, Input } from "nsh/base";
import * as store from "../store/appStore";
import * as paletteActions from "../store/actionPalette";
import type { PaletteAction } from "../store/actionPalette";
import { tint } from "../theme/palette";
import { inputStyle } from "./AuthView";
import { Icon } from "./Icon";
import { ActionButton, ModalShell, SectionTitle } from "./ui";

export function ActionPaletteModal() {
  const palette = store.palette;
  const cipher = store.selectedCipher;
  const contextVisible = () => paletteActions.filteredContext();
  const globalVisible = () => paletteActions.filteredGlobal();
  const empty = () => contextVisible().length === 0 && globalVisible().length === 0;

  // The palette owns the keyboard while it is open: arrows move the selection
  // even though the search input has focus, and each action's shortcut runs it.
  effect(() => {
    const unbind = keymap.bind(
      {
        up: () => paletteActions.moveSelection(-1),
        down: () => paletteActions.moveSelection(1),
        enter: () => paletteActions.runSelected(),
        "mod+enter": () => paletteActions.runShortcut("mod+enter"),
        "ctrl+enter": () => paletteActions.runShortcut("mod+enter"),
        "mod+u": () => paletteActions.runShortcut("mod+u"),
        "mod+t": () => paletteActions.runShortcut("mod+t"),
        "mod+o": () => paletteActions.runShortcut("mod+o"),
        "mod+h": () => paletteActions.runShortcut("mod+h"),
        "mod+e": () => paletteActions.runShortcut("mod+e"),
        "mod+g": () => paletteActions.runShortcut("mod+g"),
        "mod+r": () => paletteActions.runShortcut("mod+r"),
        "mod+l": () => paletteActions.runShortcut("mod+l"),
        "mod+,": () => paletteActions.runShortcut("mod+,"),
      },
      { when: "always" },
    );
    return unbind;
  });

  return (
    <ModalShell
      title="Action Palette"
      testID="action-palette-modal"
      subtitle="Run a command for the selected item or the whole vault."
      width={560}
    >
      <Input
        testID="action-palette-search"
        value={paletteActions.query()}
        placeholder="Search actions…"
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        onChange={(text: string) => paletteActions.setQuery(text)}
        style={inputStyle()}
      />

      <If when={contextVisible().length > 0}>
        <SectionTitle hint={cipher()?.title}>Selected Item</SectionTitle>
      </If>
      <Each of={contextVisible()} key="index">
        {(action, index) => (
          <PaletteRow
            action={action()}
            selected={paletteActions.selectedIndex() === index()}
            onPress={() => paletteActions.runAction(action())}
          />
        )}
      </Each>

      <If when={globalVisible().length > 0}>
        <SectionTitle hint="Vault-wide commands">Global</SectionTitle>
      </If>
      <Each of={globalVisible()} key="index">
        {(action, index) => (
          <PaletteRow
            action={action()}
            selected={paletteActions.selectedIndex() === contextVisible().length + index()}
            onPress={() => paletteActions.runAction(action())}
          />
        )}
      </Each>

      {empty() ? (
        <Text testID="action-palette-empty" style={{ color: palette().muted, fontSize: 12 }}>
          No actions match “{paletteActions.query()}”.
        </Text>
      ) : null}

      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <ActionButton
          label="Close"
          testID="action-palette-close"
          onPress={() => {
            paletteActions.reset();
            store.closeModal();
          }}
        />
      </View>
    </ModalShell>
  );
}

function PaletteRow(props: {
  action: PaletteAction;
  selected: boolean;
  onPress: () => void;
}) {
  const palette = store.palette;
  const foreground = () => palette().popups.text;
  const accent = () => palette().popups.selectedText;
  const background = () =>
    props.selected ? palette().popups.selectedBackground : "transparent";

  return (
    <Button
      testID={`action-${props.action.id}`}
      accessibilityLabel={props.action.label}
      onPress={props.onPress}
      style={{
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 8,
        paddingVertical: 6,
        borderRadius: 6,
        backgroundColor: background(),
      }}
      hoverStyle={{ backgroundColor: tint(accent(), palette().popups.background, 0.1) }}
      activeStyle={{ backgroundColor: tint(accent(), palette().popups.background, 0.2) }}
      focusStyle={{ backgroundColor: tint(accent(), palette().popups.background, 0.1) }}
    >
      <View style={{ width: 18, alignItems: "center" }}>
        <Icon
          name={props.action.icon}
          size={14}
          color={props.selected ? accent() : palette().muted}
        />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text
          style={{
            color: props.selected ? accent() : foreground(),
            fontSize: 13,
            fontWeight: "bold",
          }}
        >
          {props.action.label}
        </Text>
        <Text style={{ color: palette().muted, fontSize: 11 }}>{props.action.hint}</Text>
      </View>
      {props.action.shortcut ? (
        <View
          style={{
            backgroundColor: tint(foreground(), palette().popups.background, 0.08),
            borderColor: palette().popups.border,
            borderWidth: 1,
            borderRadius: 3,
            paddingHorizontal: 5,
            paddingVertical: 1,
          }}
        >
          <Text style={{ color: palette().muted, fontSize: 10 }}>
            {props.action.shortcut}
          </Text>
        </View>
      ) : null}
    </Button>
  );
}
