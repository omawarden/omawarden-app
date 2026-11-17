import { Image, Scroll, Text, View, windowSize } from "nsh";
import { Button } from "nsh/base";
import type { CipherRowView, ItemCategory } from "omawarden-app/native";
import * as store from "../store/appStore";
import { formatMaskedCardNumber } from "../store/CardFormatter";
import { formatLocalDateTime } from "../store/DateTime";
import { markIconFailed, rowIcon } from "../store/Icons";
import { VAULT_ICON_SIZE, scaleLength, sidebarWidth } from "../theme/layout";
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

  // The Trash has two empty states: nothing deleted at all, and nothing left
  // after the category and search filters it applies to the loaded rows.
  const emptyHint = () =>
    store.vaultView() === "trash"
      ? store.viewRows().length === 0
        ? "The Trash is empty."
        : "No trashed items match this search."
      : "No items match this search.";

  return (
    <View
      testID="vault-item-list"
      style={{
        width: sidebarWidth(windowSize().width),
        backgroundColor: palette().popups.background,
        borderColor: palette().popups.border,
        borderWidth: 1,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: palette().popups.border,
          flexDirection: "row",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <Text
          style={{
            color: palette().popups.text,
            fontSize: store.type().base,
            fontWeight: "bold",
            flexShrink: 1,
            numberOfLines: 1,
          }}
        >
          {store.vaultView() === "trash" ? "Trash" : "Vault Items"}
        </Text>
        <Text style={{ color: palette().muted, fontSize: store.type().sm, flexShrink: 0, numberOfLines: 1 }}>
          {store.visibleItems().length} of {store.filteredItems().length}
        </Text>
      </View>

      <Scroll style={{ flex: 1 }} contentStyle={{ padding: 8, gap: 8 }}>
        <If when={store.filteredItems().length === 0}>
          <EmptyHint>{emptyHint()}</EmptyHint>
        </If>
        {/* Keyed by cipher, not by position: NSH keeps the row's views with the
            item, so a filtered-list reorder moves a row instead of redrawing a
            different cipher into its slot. `item()` and `index()` still follow
            the row, so the action below stays on the cipher the user pressed. */}
        <Each of={store.visibleItems()} key={(item) => item.id}>
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
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 10,
        ...focusOutline(focused(), accent()),
      }}
      hoverStyle={{
        backgroundColor: tint(accent(), palette().popups.background, 0.14),
        borderColor: accent(),
      }}
      activeStyle={{ backgroundColor: tint(accent(), palette().popups.background, 0.26) }}
      focusStyle={{ borderColor: accent() }}
    >
      <Text style={{ color: accent(), fontSize: store.type().sm, fontWeight: "bold" }}>
        Show more ({props.remaining()} remaining)
      </Text>
    </Button>
  );
}

function VaultRow(props: { item: () => CipherRowView; index: () => number }) {
  const palette = store.palette;
  // Named by the cipher, not by the slot. `actionOrder` is the app's Tab ring
  // and holds its first registration order, so a slot-named action would be
  // spliced out and appended again on every reorder that moves its row.
  const id = actionID(`cipher-row-${props.item().id}`);
  useAction(id, () => store.selectCipher(props.index()));
  const focused = () => store.focusedAction() === id;
  const inTrash = () => store.vaultView() === "trash";
  const active = () => props.index() === store.selectedIndex() && store.selectionActive();
  const accent = () => palette().popups.selectedText;
  const background = () =>
    active() ? palette().popups.selectedBackground : palette().popups.background;
  // Trashed rows show the category glyph: the favicon comes from a website URL,
  // and the Trash inspector exposes no URIs.
  const iconUrl = () => (inTrash() ? "" : rowIcon(props.item));
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
        gap: 10,
        backgroundColor: background(),
        borderColor: focused() ? accent() : palette().popups.border,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 10,
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
          style={{
            width: scaleLength(VAULT_ICON_SIZE, store.totalScale()),
            height: scaleLength(VAULT_ICON_SIZE, store.totalScale()),
            borderRadius: 3,
            objectFit: "contain",
          }}
          onError={() => markIconFailed(props.item)}
        />
      </If>
      <If when={iconUrl() === ""}>
        <Icon
          testID={`cipher-category-icon-${props.item().id}`}
          name={categoryIcon(props.item().category)}
          size={VAULT_ICON_SIZE}
          color={active() ? palette().popups.selectedText : palette().popups.text}
        />
      </If>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Text
            style={{
              color: active() ? palette().popups.selectedText : palette().popups.text,
              fontSize: store.type().base,
              fontWeight: "bold",
              // NSH's flexShrink defaults to 0, so without this a long title
              // pushes past the row instead of shrinking into an ellipsis.
              flexShrink: 1,
              numberOfLines: 1,
            }}
          >
            {props.item().title}
          </Text>
          <If when={!inTrash() && props.item().favorite}>
            <Icon
              testID={`cipher-favorite-${props.item().id}`}
              name="star-filled"
              size={11}
              color={palette().warning}
            />
          </If>
        </View>
        <Text
          testID={`cipher-subtitle-${props.item().id}`}
          style={{
            color: palette().muted,
            fontSize: store.type().sm,
            flexShrink: 1,
            numberOfLines: 1,
          }}
        >
          {subtitle()}
        </Text>
        <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap" }}>
          <If when={inTrash()}>
            <View
              style={{
                backgroundColor: tint(palette().warning, palette().popups.background, 0.16),
                borderRadius: 5,
                paddingHorizontal: 5,
              }}
            >
              <Text
                testID={`cipher-deleted-${props.item().id}`}
                style={{ color: palette().warning, fontSize: store.type()["2xs"] }}
              >
                {formatLocalDateTime(props.item().deletedAt)}
              </Text>
            </View>
          </If>
          <If when={!inTrash() && props.item().organization}>
            <View
              style={{
                backgroundColor: tint(palette().info, palette().popups.background, 0.16),
                borderRadius: 5,
                paddingHorizontal: 5,
              }}
            >
              <Text style={{ color: palette().info, fontSize: store.type()["2xs"] }}>
                {props.item().organization ?? ""}
              </Text>
            </View>
          </If>
          <If when={!inTrash() && props.item().attachmentCount > 0}>
            <View
              style={{
                backgroundColor: tint(palette().purple, palette().popups.background, 0.16),
                borderRadius: 5,
                paddingHorizontal: 5,
              }}
            >
              <Text style={{ color: palette().purple, fontSize: store.type()["2xs"] }}>
                {props.item().attachmentCount} file
              </Text>
            </View>
          </If>
          <If when={!inTrash() && props.item().hasTotp}>
            <View
              style={{
                backgroundColor: tint(palette().success, palette().popups.background, 0.16),
                borderRadius: 5,
                paddingHorizontal: 5,
              }}
            >
              <Text style={{ color: palette().success, fontSize: store.type()["2xs"] }}>TOTP</Text>
            </View>
          </If>
        </View>
      </View>
    </Button>
  );
}
