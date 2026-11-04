import { Scroll, Text, View } from "nsh";
import { Button } from "nsh/base";
import type { CipherRowView, ItemCategory } from "omawarden-app/native";
import * as store from "../store/appStore";
import { tint } from "../theme/palette";
import { actionID, EmptyHint, focusOutline, useAction } from "./ui";

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
          {store.visibleItems().length} of {snap().items.length}
        </Text>
      </View>

      <Scroll style={{ flex: 1 }} contentStyle={{ padding: 4, gap: 3 }}>
        <If when={snap().items.length === 0}>
          <EmptyHint>No items match this search.</EmptyHint>
        </If>
        <Each of={store.visibleItems()} key="index">
          {(item, index) => <VaultRow item={item} index={index} />}
        </Each>
        <If when={snap().items.length > store.visibleItems().length}>
          <ShowMoreRow remaining={() => snap().items.length - store.visibleItems().length} />
        </If>
      </Scroll>
    </View>
  );
}

function ShowMoreRow(props: { remaining: () => number }) {
  const palette = store.palette;
  const id = actionID("vault-show-more");
  useAction(id, () => store.showMoreItems());
  const focused = () => store.focusedAction() === id;
  const accent = () => palette().popups.selectedText;
  return (
    <Button
      testID="vault-show-more"
      onPress={() => store.showMoreItems()}
      style={{
        alignItems: "center",
        backgroundColor: palette().popups.background,
        borderColor: focused() ? accent() : palette().popups.border,
        borderWidth: 1,
        borderRadius: 7,
        paddingHorizontal: 8,
        paddingVertical: 7,
        ...focusOutline(focused(), accent()),
      }}
      hoverStyle={{
        backgroundColor: tint(accent(), palette().popups.background, 0.14),
        borderColor: accent(),
      }}
      activeStyle={{ backgroundColor: tint(accent(), palette().popups.background, 0.26) }}
      focusStyle={{ borderColor: accent() }}
    >
      <Text style={{ color: accent(), fontSize: 11, fontWeight: "bold" }}>
        Show more ({props.remaining()} remaining)
      </Text>
    </Button>
  );
}

function VaultRow(props: { item: () => CipherRowView; index: () => number }) {
  const palette = store.palette;
  const id = actionID(`cipher-row-${props.item().id}`);
  useAction(id, () => store.selectCipher(props.index()));
  const focused = () => store.focusedAction() === id;
  const active = () =>
    props.index() === store.selectedIndex() && store.inspector() !== null;
  const accent = () => palette().popups.selectedText;
  const background = () =>
    active() ? palette().popups.selectedBackground : palette().popups.background;
  return (
    <Button
      testID={`cipher-row-${props.item().id}`}
      selected={active()}
      onPress={() => store.selectCipher(props.index())}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: background(),
        borderColor: focused() ? accent() : palette().popups.border,
        borderWidth: 1,
        borderRadius: 7,
        paddingHorizontal: 8,
        paddingVertical: 7,
        ...focusOutline(focused(), accent()),
      }}
      hoverStyle={{
        backgroundColor: tint(accent(), background(), 0.14),
        borderColor: accent(),
      }}
      activeStyle={{ backgroundColor: tint(accent(), background(), 0.26) }}
      focusStyle={{ borderColor: accent() }}
    >
      <Text style={{ fontSize: 16 }}>{categoryGlyph(props.item().category)}</Text>
      <View style={{ flex: 1, gap: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text
            style={{
              color: active() ? palette().popups.selectedText : palette().popups.text,
              fontSize: 12,
              fontWeight: "bold",
            }}
          >
            {props.item().title}
          </Text>
          {props.item().favorite ? (
            <Text style={{ color: palette().warning, fontSize: 11 }}>★</Text>
          ) : null}
        </View>
        <Text style={{ color: palette().muted, fontSize: 11 }}>
          {props.item().subtitle || props.item().category}
        </Text>
        <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap" }}>
          {props.item().organization ? (
            <View
              style={{
                backgroundColor: tint(palette().info, palette().popups.background, 0.16),
                borderRadius: 5,
                paddingHorizontal: 5,
              }}
            >
              <Text style={{ color: palette().info, fontSize: 9 }}>
                {props.item().organization}
              </Text>
            </View>
          ) : null}
          {props.item().attachmentCount > 0 ? (
            <View
              style={{
                backgroundColor: tint(palette().purple, palette().popups.background, 0.16),
                borderRadius: 5,
                paddingHorizontal: 5,
              }}
            >
              <Text style={{ color: palette().purple, fontSize: 9 }}>
                {props.item().attachmentCount} file
              </Text>
            </View>
          ) : null}
          {props.item().hasTotp ? (
            <View
              style={{
                backgroundColor: tint(palette().success, palette().popups.background, 0.16),
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
  );
}
