import { Image, Scroll, Text, View } from "nsh";
import { signal } from "nsh";
import { Button } from "nsh/base";
import type { CipherRowView, ItemCategory } from "omawarden-app/native";
import * as store from "../store/appStore";
import { formatMaskedCardNumber } from "../store/CardFormatter";
import { iconUrlFor, resolve } from "../store/IconPolicy";
import { tint } from "../theme/palette";
import { Icon, type IconName } from "./Icon";
import { actionID, EmptyHint, focusOutline, useAction } from "./ui";

function categoryIcon(category: ItemCategory): IconName {
  switch (category) {
    case "login":
      return "key";
    case "card":
      return "credit-card";
    case "identity":
      return "user";
    case "secureNote":
      return "file-text";
    case "sshKey":
      return "terminal";
    default:
      return "circle";
  }
}

export function VaultItemList() {
  const palette = store.palette;

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
          {store.visibleItems().length} of {store.filteredItems().length}
        </Text>
      </View>

      <Scroll style={{ flex: 1 }} contentStyle={{ padding: 4, gap: 3 }}>
        <If when={store.filteredItems().length === 0}>
          <EmptyHint>No items match this search.</EmptyHint>
        </If>
        <Each of={store.visibleItems()} key="index">
          {(item, index) => <VaultRow item={item} index={index} />}
        </Each>
        <If when={store.filteredItems().length > store.visibleItems().length}>
          <ShowMoreRow remaining={() => store.filteredItems().length - store.visibleItems().length} />
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
  const failedIcon = signal(false);
  const id = actionID(`cipher-row-slot-${props.index()}`);
  useAction(id, () => store.selectCipher(props.index()));
  const focused = () => store.focusedAction() === id;
  const active = () =>
    props.index() === store.selectedIndex() && store.inspector() !== null;
  const accent = () => palette().popups.selectedText;
  const background = () =>
    active() ? palette().popups.selectedBackground : palette().popups.background;
  const iconUrl = () => {
    if (failedIcon()) {
      return "";
    }
    const current = store.settings();
    if (!resolve(current !== null, current?.config.showWebsiteIcons)) {
      return "";
    }
    return iconUrlFor(store.snapshot().serverUrl, props.item().uris);
  };
  const subtitle = () => {
    const item = props.item();
    if (item.category === "card" && item.cardMask) {
      const masked = formatMaskedCardNumber(item.cardMask, item.cardBrand ?? "");
      return item.cardBrand ? `${item.cardBrand} · ${masked}` : masked;
    }
    return item.subtitle || item.category;
  };
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
      <If when={iconUrl() !== ""}>
        <Image
          testID={`cipher-icon-${props.item().id}`}
          src={iconUrl()}
          resizeMode="contain"
          style={{ width: 16, height: 16, borderRadius: 3 }}
          onError={() => failedIcon.set(true)}
        />
      </If>
      <If when={iconUrl() === ""}>
        <Icon
          testID={`cipher-category-icon-${props.item().id}`}
          name={categoryIcon(props.item().category)}
          size={16}
          color={active() ? palette().popups.selectedText : palette().popups.text}
        />
      </If>
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
          <If when={props.item().favorite}>
            <Icon name="star" size={11} color={palette().warning} />
          </If>
        </View>
        <Text
          testID={`cipher-subtitle-${props.item().id}`}
          style={{ color: palette().muted, fontSize: 11 }}
        >
          {subtitle()}
        </Text>
        <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap" }}>
          <If when={props.item().organization}>
            <View
              style={{
                backgroundColor: tint(palette().info, palette().popups.background, 0.16),
                borderRadius: 5,
                paddingHorizontal: 5,
              }}
            >
              <Text style={{ color: palette().info, fontSize: 9 }}>
                {props.item().organization ?? ""}
              </Text>
            </View>
          </If>
          <If when={props.item().attachmentCount > 0}>
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
          </If>
          <If when={props.item().hasTotp}>
            <View
              style={{
                backgroundColor: tint(palette().success, palette().popups.background, 0.16),
                borderRadius: 5,
                paddingHorizontal: 5,
              }}
            >
              <Text style={{ color: palette().success, fontSize: 9 }}>TOTP</Text>
            </View>
          </If>
        </View>
      </View>
    </Button>
  );
}
