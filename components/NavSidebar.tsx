import { Image, Scroll, Text, View } from "nsh";
import { Button } from "nsh/base";
import * as store from "../store/appStore";
import { extractHost } from "../store/IconPolicy";
import { tint } from "../theme/palette";
import logo from "../assets/icon.png";
import { GhostIconButton } from "./GhostIconButton";
import { Icon, type IconName } from "./Icon";
import { actionID, focusOutline, useAction } from "./ui";
import { NAV_SIDEBAR_WIDTH, scaleLength } from "../theme/layout";

/** The app's mark in the sidebar's head, before the text scale. */
const APP_ICON_SIZE = 28;

/**
 * One navigation row: an optional glyph, a name that truncates to one line, and
 * a count on the right.
 *
 * The name truncates rather than wrapping because the sidebar is a fixed-width
 * column and a long vault or folder name must not grow its row: the list beside
 * it would jump every time the data changed. The full name stays reachable as
 * the row's tooltip.
 */
function SidebarRow(props: {
  testID: string;
  name: string;
  icon: IconName;
  /** Omitted while the count is unknown, so no placeholder shows. */
  count?: number;
  active: boolean;
  /** Dimmed rather than hidden: the row still works, it just does not apply. */
  dimmed?: boolean;
  onPress: () => void;
}) {
  const palette = store.palette;
  const rowID = actionID(props.testID);
  useAction(rowID, () => props.onPress());
  const focused = () => store.focusedAction() === rowID;
  const accent = () => palette().popups.selectedText;
  const background = () =>
    props.active ? palette().popups.selectedBackground : "transparent";

  return (
    <Button
      testID={props.testID}
      tooltip={<Text style={{ color: store.palette().popups.text }}>{props.name}</Text>}
      accessibilityLabel={props.name}
      selected={props.active}
      onPress={props.onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: background(),
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 6,
        opacity: props.dimmed ? 0.5 : 1,
        ...focusOutline(focused(), accent()),
      }}
      hoverStyle={{ backgroundColor: tint(accent(), palette().menu.background, 0.12) }}
      activeStyle={{ backgroundColor: tint(accent(), palette().menu.background, 0.2) }}
      focusVisibleStyle={{ backgroundColor: tint(accent(), palette().menu.background, 0.12) }}
    >
      <Icon
        name={props.icon}
        size={14}
        color={props.active ? accent() : palette().muted}
      />
      <Text
        style={{
          flex: 1,
          minWidth: 0,
          color: props.active ? palette().popups.selectedText : palette().menu.text,
          fontSize: store.type().base,
          fontWeight: props.active ? "bold" : "normal",
          // One line: a long name must not grow its row and shift the list.
          numberOfLines: 1,
        }}
      >
        {props.name}
      </Text>
      <If when={props.count !== undefined}>
        <Text style={{ color: palette().muted, fontSize: store.type().sm }}>{props.count}</Text>
      </If>
    </Button>
  );
}

/** A group's caption, above its rows. */
function GroupTitle(props: { label: string }) {
  return (
    <Text
      style={{
        color: store.palette().muted,
        fontSize: store.type()["2xs"],
        fontWeight: "bold",
        letterSpacing: 0.6,
        paddingHorizontal: 8,
      }}
    >
      {props.label}
    </Text>
  );
}

/** The one-line hint an empty group shows, so the sidebar keeps its shape. */
function GroupHint(props: { hint: string }) {
  return (
    <Text
      style={{
        color: store.palette().muted,
        fontSize: store.type().sm,
        paddingHorizontal: 8,
        paddingVertical: 2,
      }}
    >
      {props.hint}
    </Text>
  );
}

/** The scope's glyph: an org is a building, the personal vault a person. */
function scopeIcon(kind: string): IconName {
  if (kind === "organization") {
    return "building";
  }
  if (kind === "personal") {
    return "user";
  }
  return "shield";
}

/**
 * The Navigation Sidebar: the vaults, the folders, the Trash and the account.
 *
 * A full-height column of its own, beside the content column rather than inside
 * it, so the search row and the category tabs stop at its right edge and it
 * reads as navigation. The head is fixed, the middle scrolls because the folder
 * list has no bound, and the Trash sits below the scroll with the account under
 * it: the Trash closes the list of places, so it is part of the body yet stays
 * put when folders scroll, and only the account is the column's foot.
 *
 * Vault and folder are independent dimensions and may both highlight: the list
 * shows their intersection. The Trash is a view rather than a scope, so while
 * it is open neither group highlights and both dim, but the rows still work.
 */
export function NavSidebar() {
  const palette = store.palette;
  const snap = store.snapshot;
  const inTrash = () => store.vaultView() === "trash";
  const email = () => snap().email || "Not signed in";
  const host = () => extractHost(snap().serverUrl);
  const initial = () => {
    const value = snap().email.trim();
    return value ? value.slice(0, 1).toUpperCase() : "?";
  };

  return (
    <View
      testID="nav-sidebar"
      style={{
        width: NAV_SIDEBAR_WIDTH,
        flexShrink: 0,
        alignSelf: "stretch",
        backgroundColor: palette().menu.background,
        borderRightWidth: 1,
        borderRightColor: palette().popups.border,
      }}
    >
      {/* Head: the mark and the name. Neither is a control. */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          paddingHorizontal: 12,
          paddingVertical: 12,
        }}
      >
        <Image
          testID="nav-app-icon"
          src={logo}
          style={{
            width: scaleLength(APP_ICON_SIZE, store.totalScale()),
            height: scaleLength(APP_ICON_SIZE, store.totalScale()),
            borderRadius: 6,
          }}
        />
        <Text
          testID="nav-app-name"
          style={{ color: palette().menu.text, fontSize: store.type().lg, fontWeight: "bold" }}
        >
          Omawarden
        </Text>
      </View>

      {/* Middle: the two groups. Both always render, so a sync cannot move the
          sidebar's shape under the pointer. */}
      <Scroll style={{ flex: 1 }} contentStyle={{ paddingHorizontal: 6, paddingVertical: 4 }}>
        <View style={{ gap: 4 }}>
          <GroupTitle label="VAULTS" />
          <If when={snap().scopes.length === 0}>
            <GroupHint hint="No vaults" />
          </If>
          <Each of={snap().scopes} key="index">
            {(scope) => (
              <SidebarRow
                testID={`nav-vault-${scope().id}`}
                name={scope().name}
                icon={scopeIcon(scope().kind)}
                count={scope().count}
                active={!inTrash() && store.scopeId() === scope().id}
                dimmed={inTrash()}
                onPress={() => store.setScope(scope().id)}
              />
            )}
          </Each>

          <View style={{ height: 8 }} />

          <GroupTitle label="FOLDERS" />
          <If when={snap().folders.length === 0}>
            <GroupHint hint="No folders" />
          </If>
          <SidebarRow
            testID="nav-folder-all"
            name="All Folders"
            icon="folder"
            count={snap().totalCount}
            active={!inTrash() && store.folderId() === null}
            dimmed={inTrash()}
            onPress={() => store.setFolder(null)}
          />
          <Each of={snap().folders} key="index">
            {(folder) => (
              <SidebarRow
                testID={`nav-folder-${folder().id}`}
                name={folder().name}
                icon="folder"
                count={folder().count}
                active={!inTrash() && store.folderId() === folder().id}
                dimmed={inTrash()}
                onPress={() => store.setFolder(folder().id)}
              />
            )}
          </Each>
        </View>
      </Scroll>

      {/* The list's own end: the Trash closes the navigation, so it sits below
          the Scroll rather than inside it — a long folder list scrolls and the
          Trash stays put — and the rule above it says the list stops here. */}
      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: palette().popups.border,
          paddingHorizontal: 6,
          paddingVertical: 6,
        }}
      >
        <SidebarRow
          testID="nav-trash"
          name="Trash"
          icon="trash"
          count={store.trashCount() ?? undefined}
          active={inTrash()}
          onPress={store.openTrash}
        />
      </View>

      {/* The column's foot: the account and the gear. Not a navigation row, so
          it is set apart by the rule above rather than keeping one of its own. */}
      <View style={{ paddingHorizontal: 6, paddingBottom: 6 }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
            paddingHorizontal: 8,
            paddingVertical: 4,
          }}
        >
          {/* The account itself is not a control; only the gear is. */}
          <View
            testID="nav-user"
            style={{
              flex: 1,
              minWidth: 0,
              flexDirection: "row",
              alignItems: "center",
              gap: 8,
            }}
          >
            <View
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                backgroundColor: tint(palette().popups.selectedText, palette().menu.background, 0.22),
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Text
                style={{
                  color: palette().popups.selectedText,
                  fontSize: store.type().sm,
                  fontWeight: "bold",
                }}
              >
                {initial()}
              </Text>
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
              <Text
                testID="nav-user-email"
                tooltip={<Text style={{ color: palette().popups.text }}>{email()}</Text>}
                style={{
                  color: palette().menu.text,
                  fontSize: store.type().base,
                  numberOfLines: 1,
                }}
              >
                {email()}
              </Text>
              <Text
                testID="nav-user-server"
                tooltip={<Text style={{ color: palette().popups.text }}>{host() || "No server"}</Text>}
                style={{
                  color: palette().muted,
                  fontSize: store.type()["2xs"],
                  numberOfLines: 1,
                }}
              >
                {host() || "No server"}
              </Text>
            </View>
          </View>
          <GhostIconButton
            testID="nav-settings"
            label="Open settings"
            icon="settings"
            size={14}
            onPress={store.openSettings}
          />
        </View>
      </View>
    </View>
  );
}
