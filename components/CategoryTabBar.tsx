import { Text, View } from "nsh";
import { Button } from "nsh/base";
import type { CategoryCountsView, ItemCategory } from "omawarden-app/native";
import * as store from "../store/appStore";
import { tint } from "../theme/palette";
import { actionID, focusOutline, useAction } from "./ui";

const TABS: Array<{ category: ItemCategory; label: string; count: keyof CategoryCountsView }> = [
  { category: "all", label: "All", count: "all" },
  { category: "login", label: "Logins", count: "logins" },
  { category: "card", label: "Cards", count: "cards" },
  { category: "identity", label: "Identities", count: "identities" },
  { category: "secureNote", label: "Secure Notes", count: "secureNotes" },
  { category: "sshKey", label: "SSH Keys", count: "sshKeys" },
];

export function CategoryTabBar() {
  const palette = store.palette;

  return (
    <View
      testID="category-tabs"
      style={{
        flexDirection: "row",
        gap: 6,
        paddingHorizontal: 12,
        paddingVertical: 8,
        backgroundColor: palette().menu.background,
        borderBottomWidth: 1,
        borderBottomColor: palette().menu.border,
        flexWrap: "wrap",
      }}
    >
      <Each of={TABS} key="index">
        {(tab) => <CategoryTab tab={tab()} />}
      </Each>
    </View>
  );
}

function CategoryTab(props: {
  tab: { category: ItemCategory; label: string; count: keyof CategoryCountsView };
}) {
  const palette = store.palette;
  const snap = store.snapshot;
  const active = () => snap().category === props.tab.category;
  const id = actionID(`category-${props.tab.category}`);
  useAction(id, () => store.setCategory(props.tab.category));
  const focused = () => store.focusedAction() === id;
  const accent = () => palette().menu.selectedText;
  const background = () =>
    active() ? palette().menu.selectedBackground : palette().menu.background;
  return (
    <Button
      testID={`category-${props.tab.category}`}
      selected={active()}
      onPress={() => store.setCategory(props.tab.category)}
      style={{
        backgroundColor: background(),
        borderColor: focused() ? accent() : palette().menu.border,
        borderWidth: 1,
        borderRadius: 7,
        paddingHorizontal: 10,
        paddingVertical: 5,
        ...focusOutline(focused(), accent()),
      }}
      hoverStyle={{
        backgroundColor: tint(accent(), background(), 0.14),
        borderColor: accent(),
      }}
      activeStyle={{ backgroundColor: tint(accent(), background(), 0.26) }}
      focusStyle={{ borderColor: accent() }}
    >
      <Text
        style={{
          color: active() ? palette().menu.selectedText : palette().menu.text,
          fontSize: 12,
          fontWeight: active() ? "bold" : "normal",
        }}
      >
        {props.tab.label} ({snap().categoryCounts[props.tab.count]})
      </Text>
    </Button>
  );
}
