import { effect, Text, View } from "nsh";
import { Button, Input } from "nsh/base";
import * as store from "../store/appStore";
import { blurSearch, focusSearch, setSearchField } from "../store/searchFocus";
import { windowBelowMinimum } from "../store/windowGate";
import { tint } from "../theme/palette";
import { actionID, focusOutline, useAction } from "./ui";
import { GhostIconButton } from "./GhostIconButton";
import { Icon } from "./Icon";
import { inputStyle } from "./AuthView";

export function SearchHeader() {
  const palette = store.palette;
  const snap = store.snapshot;
  const scopeID = actionID("scope-trigger");
  useAction(scopeID, store.toggleScope);
  const scopeFocused = () => store.focusedAction() === scopeID;
  const scopeAccent = () => palette().menu.selectedText;
  const scopeBackground = () => palette().menu.background;

  // The vault's home position for the keyboard: unlocking or showing the
  // vault puts it in the search box, and the minimum-window gate takes it away
  // while it covers the app. Comparing the predicate's value keeps a plain
  // resize from stealing focus back from an action the user tabbed to.
  //
  // A dialog takes the keyboard as well: its fields are what the user types
  // into, and Escape has to reach the dialog rather than the search behind it.
  // Closing it does not give the focus back — only the palette asks for that.
  let lastBelow: boolean | null = null;
  let lastModal = false;
  effect(() => {
    const below = windowBelowMinimum();
    const modal = store.activeModal() !== "none";
    if (modal && !lastModal) {
      blurSearch();
    }
    lastModal = modal;
    if (below === lastBelow) {
      return;
    }
    lastBelow = below;
    if (below || modal) {
      blurSearch();
    } else {
      focusSearch();
    }
  });

  return (
    <View
      testID="search-header"
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 10,
        backgroundColor: palette().menu.background,
        borderBottomWidth: 1,
        borderBottomColor: palette().menu.border,
        flexWrap: "wrap",
      }}
    >
      <View style={{ flex: 1, minWidth: 220, flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Icon name="search" size={14} color={palette().muted} />
        <Input
          testID="vault-search"
          ref={setSearchField}
          value={store.search()}
          placeholder="Search your vault…"
          autoCapitalize="none"
          autoCorrect={false}
          submitBehavior="submit"
          onSubmit={() => store.primaryCopy()}
          onChange={({ value }) => store.setSearch(value)}
          style={{ ...inputStyle(), flex: 1 }}
        />
        {store.search() ? (
          <GhostIconButton
            testID="clear-search"
            label="Clear search"
            icon="x"
            onPress={() => store.setSearch("")}
          />
        ) : null}
        <View
          style={{
            backgroundColor: palette().menu.selectedBackground,
            borderRadius: 999,
            paddingHorizontal: 9,
            paddingVertical: 3,
          }}
        >
          <Text style={{ color: palette().menu.selectedText, fontSize: store.type().sm, fontWeight: "bold" }}>
            {store.filteredItems().length} / {snap().totalCount}
          </Text>
        </View>
      </View>

      <Button
        testID="scope-trigger"
        onPress={store.toggleScope}
        style={{
          backgroundColor: scopeBackground(),
          borderColor: scopeFocused() ? scopeAccent() : palette().menu.border,
          borderWidth: 1,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 6,
          ...focusOutline(scopeFocused(), scopeAccent()),
        }}
        hoverStyle={{
          backgroundColor: tint(scopeAccent(), scopeBackground(), 0.14),
          borderColor: scopeAccent(),
        }}
        activeStyle={{ backgroundColor: tint(scopeAccent(), scopeBackground(), 0.26) }}
        focusStyle={{ borderColor: scopeAccent() }}
      >
        <Text style={{ color: palette().menu.text, fontSize: store.type().base }}>
          Scope: {store.activeScopeName()}
        </Text>
      </Button>
    </View>
  );
}
