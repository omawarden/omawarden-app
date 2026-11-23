import { effect, Text, View } from "nsh";
import { Button, Input } from "nsh/base";
import * as store from "../store/appStore";
import { blurSearch, focusSearch, setSearchField } from "../store/searchFocus";
import { windowTooShortForShell } from "../store/shellScroll";
import { tint } from "../theme/palette";
import { actionID, focusOutline, useAction } from "./ui";
import { GhostIconButton } from "./GhostIconButton";
import { Icon } from "./Icon";
import { inputStyle } from "./AuthView";

/**
 * The sidebar's expand/collapse control, at the far left of the search row.
 *
 * It is the only such control: the sidebar's head has none, so the way back is
 * always in the same place. While the window is too narrow for the sidebar the
 * control is disabled rather than hidden, and its tooltip says why.
 */
function SidebarToggle() {
  const palette = store.palette;
  const id = actionID("nav-sidebar-toggle");
  useAction(id, store.toggleSidebar);
  const focused = () => store.focusedAction() === id;
  const accent = () => palette().menu.selectedText;
  const blocked = () => store.sidebarToggleBlocked();

  return (
    <Button
      testID="nav-sidebar-toggle"
      accessibilityLabel={blocked() ? "Widen the window to show the sidebar" : "Toggle the sidebar"}
      tooltip={
        <Text style={{ color: palette().popups.text }}>
          {blocked() ? "Widen the window to show the sidebar" : "Toggle the sidebar (Ctrl+\\)"}
        </Text>
      }
      disabled={blocked()}
      onPress={store.toggleSidebar}
      style={{
        width: 30,
        height: 30,
        minWidth: 30,
        minHeight: 30,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: palette().menu.background,
        borderColor: focused() ? accent() : palette().menu.border,
        borderWidth: 1,
        borderRadius: 8,
        ...focusOutline(focused(), accent()),
      }}
      hoverStyle={{ backgroundColor: tint(accent(), palette().menu.background, 0.12) }}
      activeStyle={{ backgroundColor: tint(accent(), palette().menu.background, 0.2) }}
      focusVisibleStyle={{ backgroundColor: tint(accent(), palette().menu.background, 0.12) }}
      disabledStyle={{ opacity: 0.5 }}
    >
      <Icon name="panel-left" size={14} color={blocked() ? palette().muted : accent()} />
    </Button>
  );
}

/**
 * The scope selector, which only the collapsed layout shows.
 *
 * It is a component of its own so its action registers when the trigger
 * renders: a `useAction` in `SearchHeader`'s body would run before any of its
 * children, putting the trigger at the head of the Tab ring instead of after
 * the sidebar toggle that is drawn to its left.
 */
function ScopeTrigger() {
  const palette = store.palette;
  const scopeID = actionID("scope-trigger");
  useAction(scopeID, store.toggleScope);
  const scopeFocused = () => store.focusedAction() === scopeID;
  const scopeAccent = () => palette().menu.selectedText;
  const scopeBackground = () => palette().menu.background;

  return (
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
      focusVisibleStyle={{ borderColor: scopeAccent() }}
    >
      <Text style={{ color: palette().menu.text, fontSize: store.type().base }}>
        {store.scopeLabel()}
      </Text>
    </Button>
  );
}

export function SearchHeader() {
  const palette = store.palette;

  // The vault's home position for the keyboard: unlocking or showing the
  // vault puts it in the search box, and the short-window gate takes it away
  // while it covers the app. Comparing the predicate's value keeps a plain
  // resize from stealing focus back from an action the user tabbed to.
  //
  // A dialog takes the keyboard as well: its fields are what the user types
  // into, and Escape has to reach the dialog rather than the search behind it.
  // Closing it does not give the focus back — only the palette asks for that.
  let lastShort: boolean | null = null;
  let lastModal = false;
  effect(() => {
    const short = windowTooShortForShell();
    const modal = store.activeModal() !== "none";
    if (modal && !lastModal) {
      blurSearch();
    }
    lastModal = modal;
    if (short === lastShort) {
      return;
    }
    lastShort = short;
    if (short || modal) {
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
      <SidebarToggle />

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
          // The Inspector Form owns the keyboard while a draft is open: a click
          // on the search must not let typing filter the list behind it.
          readonly={store.cipherForm() !== null}
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
            {store.filteredItems().length} / {store.viewRows().length}
          </Text>
        </View>
      </View>

      {/* Expanded, the sidebar is where the vault is picked, so the trigger
          that opens the dropdown would be a second way to the same filter. */}
      <If when={!store.sidebarExpanded()}>
        <ScopeTrigger />
      </If>
    </View>
  );
}
