import { Scroll, Text, View } from "nsh";
import { Button } from "nsh/base";
import type { ItemCategory } from "omawarden-app/native";
import * as store from "../store/appStore";
import { tint } from "../theme/palette";
import { EmptyHint } from "./ui";

function categoryGlyph(category: ItemCategory): string {
  switch (category) {
    case "login":
      return "🔑";
    case "card":
      return "💳";
    case "identity":
      return "🪪";
    case "secureNote":
      return "📝";
    case "sshKey":
      return "🔐";
    default:
      return "●";
  }
}

export function VaultItemList() {
  const palette = store.palette;
  const snap = store.snapshot;

  return (
    <View
      testID="vault-item-list"
      style={{
        width: 260,
        backgroundColor: palette().popups.background,
        borderColor: palette().popups.border,
        borderWidth: 1,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          paddingHorizontal: 10,
          paddingVertical: 8,
          borderBottomWidth: 1,
          borderBottomColor: palette().popups.border,
          flexDirection: "row",
          justifyContent: "space-between",
        }}
      >
        <Text style={{ color: palette().popups.text, fontSize: 12, fontWeight: "bold" }}>
          Vault Items
        </Text>
        <Text style={{ color: palette().muted, fontSize: 11 }}>
          {snap().items.length} shown
        </Text>
      </View>

      <Scroll style={{ flex: 1 }} contentStyle={{ padding: 4, gap: 3 }}>
        <If when={snap().items.length === 0}>
          <EmptyHint>No items match this search.</EmptyHint>
        </If>
        <Each of={snap().items} key="index">
          {(item, index) => (
            <Button
              testID={`cipher-row-${item().id}`}
              onPress={() => store.selectCipher(index())}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                backgroundColor:
                  index() === store.selectedIndex() && store.inspector() !== null
                    ? palette().popups.selectedBackground
                    : palette().popups.background,
                borderRadius: 7,
                paddingHorizontal: 8,
                paddingVertical: 7,
              }}
            >
              <Text style={{ fontSize: 16 }}>{categoryGlyph(item().category)}</Text>
              <View style={{ flex: 1, gap: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                  <Text
                    style={{
                      color:
                        index() === store.selectedIndex() && store.inspector() !== null
                          ? palette().popups.selectedText
                          : palette().popups.text,
                      fontSize: 12,
                      fontWeight: "bold",
                    }}
                  >
                    {item().title}
                  </Text>
                  {item().favorite ? (
                    <Text style={{ color: palette().warning, fontSize: 11 }}>★</Text>
                  ) : null}
                </View>
                <Text style={{ color: palette().muted, fontSize: 11 }}>
                  {item().subtitle || item().category}
                </Text>
                <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap" }}>
                  {item().organization ? (
                    <View
                      style={{
                        backgroundColor: tint(
                          palette().info,
                          palette().popups.background,
                          0.16,
                        ),
                        borderRadius: 5,
                        paddingHorizontal: 5,
                      }}
                    >
                      <Text style={{ color: palette().info, fontSize: 9 }}>
                        {item().organization}
                      </Text>
                    </View>
                  ) : null}
                  {item().attachmentCount > 0 ? (
                    <View
                      style={{
                        backgroundColor: tint(
                          palette().purple,
                          palette().popups.background,
                          0.16,
                        ),
                        borderRadius: 5,
                        paddingHorizontal: 5,
                      }}
                    >
                      <Text style={{ color: palette().purple, fontSize: 9 }}>
                        {item().attachmentCount} file
                      </Text>
                    </View>
                  ) : null}
                  {item().hasTotp ? (
                    <View
                      style={{
                        backgroundColor: tint(
                          palette().success,
                          palette().popups.background,
                          0.16,
                        ),
                        borderRadius: 5,
                        paddingHorizontal: 5,
                      }}
                    >
                      <Text style={{ color: palette().success, fontSize: 9 }}>TOTP</Text>
                    </View>
                  ) : null}
                </View>
              </View>
            </Button>
          )}
        </Each>
      </Scroll>
    </View>
  );
}
