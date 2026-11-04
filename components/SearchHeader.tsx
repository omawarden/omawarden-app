import { Text, View } from "nsh";
import { Button, Input } from "nsh/base";
import * as store from "../store/appStore";
import { ActionButton } from "./ui";
import { inputStyle } from "./AuthView";

export function SearchHeader() {
  const palette = store.palette;
  const snap = store.snapshot;

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
        <Input
          testID="vault-search"
          value={snap().search}
          placeholder="Search your vault…"
          autoCapitalize="none"
          autoCorrect={false}
          onChange={(text: string) => store.setSearch(text)}
          style={{ ...inputStyle(), flex: 1 }}
        />
        <View
          style={{
            backgroundColor: palette().menu.selectedBackground,
            borderRadius: 999,
            paddingHorizontal: 9,
            paddingVertical: 3,
          }}
        >
          <Text style={{ color: palette().menu.selectedText, fontSize: 11, fontWeight: "bold" }}>
            {snap().items.length} / {snap().totalCount}
          </Text>
        </View>
      </View>

      <Button
        testID="scope-trigger"
        onPress={store.toggleScope}
        style={{
          backgroundColor: palette().menu.background,
          borderColor: palette().menu.border,
          borderWidth: 1,
          borderRadius: 8,
          paddingHorizontal: 10,
          paddingVertical: 6,
        }}
      >
        <Text style={{ color: palette().menu.text, fontSize: 12 }}>
          Scope: {store.activeScopeName()}
        </Text>
      </Button>

      <ActionButton label="Generator" testID="open-generator" onPress={store.openGenerator} />
      <ActionButton
        label="New SSH Key"
        testID="open-ssh-key"
        onPress={() => store.openSshKey("create")}
      />
      <ActionButton label="Sync" testID="sync-vault" onPress={store.sync} />
      <ActionButton label="Lock" testID="lock-vault" onPress={() => store.lockOrLogout(false)} />
      <ActionButton label="Settings" testID="open-settings" onPress={store.openSettings} />
    </View>
  );
}
