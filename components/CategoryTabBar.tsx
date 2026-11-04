import { Text, View } from "nsh";
import { Button } from "nsh/base";
import type { CategoryCountsView, ItemCategory } from "omawarden-app/native";
import * as store from "../store/appStore";

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
  const snap = store.snapshot;

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
        {(tab) => (
          <Button
            testID={`category-${tab().category}`}
            onPress={() => store.setCategory(tab().category)}
            style={{
              backgroundColor:
                snap().category === tab().category
                  ? palette().menu.selectedBackground
                  : palette().menu.background,
              borderColor: palette().menu.border,
              borderWidth: 1,
              borderRadius: 7,
              paddingHorizontal: 10,
              paddingVertical: 5,
            }}
          >
            <Text
              style={{
                color:
                  snap().category === tab().category
                    ? palette().menu.selectedText
                    : palette().menu.text,
                fontSize: 12,
                fontWeight: snap().category === tab().category ? "bold" : "normal",
              }}
            >
              {tab().label} ({snap().categoryCounts[tab().count]})
            </Text>
          </Button>
        )}
      </Each>
    </View>
  );
}
