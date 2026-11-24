import { Text, View } from "nsh";
import { Button } from "nsh/base";
import * as store from "../store/appStore";
import { tint } from "../theme/palette";
import { actionID, focusOutline, useAction } from "./ui";

export function ScopeDropdown() {
  const palette = store.palette;
  const snap = store.snapshot;

  const ScopeRow = (props: {
    id: string;
    name: string;
    /** Omitted while the count is unknown, so no placeholder shows. */
    count?: number;
    active: boolean;
    onPress: () => void;
  }) => {
    const rowID = actionID(`scope-${props.id}`);
    useAction(rowID, () => props.onPress());
    const focused = () => store.focusedAction() === rowID;
    const accent = () => palette().popups.selectedText;
    const background = () =>
      props.active ? palette().popups.selectedBackground : palette().popups.background;
    return (
      <Button
        testID={`scope-${props.id}`}
        selected={props.active}
        onPress={props.onPress}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          backgroundColor: background(),
          borderColor: focused() ? accent() : palette().popups.border,
          borderWidth: 1,
          borderRadius: 7,
          paddingHorizontal: 10,
          paddingVertical: 6,
          ...focusOutline(focused(), accent()),
        }}
        hoverStyle={{
          backgroundColor: tint(accent(), background(), 0.14),
          borderColor: accent(),
        }}
        activeStyle={{ backgroundColor: tint(accent(), background(), 0.26) }}
        focusVisibleStyle={{ borderColor: accent() }}
      >
        <Text
          style={{
            color: props.active ? palette().popups.selectedText : palette().popups.text,
            fontSize: store.type().base,
            fontWeight: props.active ? "bold" : "normal",
          }}
        >
          {props.name}
        </Text>
        <If when={props.count !== undefined}>
          <Text style={{ color: palette().muted, fontSize: store.type().sm }}>{props.count}</Text>
        </If>
      </Button>
    );
  };

  return (
    <View
      testID="scope-dropdown"
      style={{
        backgroundColor: palette().popups.background,
        borderBottomWidth: 1,
        borderBottomColor: palette().popups.border,
        padding: 12,
        gap: 10,
        flexDirection: "row",
        flexWrap: "wrap",
      }}
    >
      <View
        style={{
          minWidth: 220,
          flex: 1,
          // In the Trash the folder column is gone, so the scope column keeps a
          // popup-like width instead of stretching across the whole window.
          maxWidth: store.vaultView() === "trash" ? 360 : undefined,
          gap: 4,
        }}
      >
        <Text style={{ color: palette().muted, fontSize: store.type().sm, fontWeight: "bold" }}>
          Vault Scope
        </Text>
        <Each of={snap().scopes} key="index">
          {(scope) => (
            <ScopeRow
              id={scope().id}
              name={scope().name}
              count={scope().count}
              active={store.vaultView() === "active" && store.scopeId() === scope().id}
              onPress={() => {
                store.closeTrash();
                store.setScope(scope().id);
              }}
            />
          )}
        </Each>

        <View
          testID="scope-divider"
          style={{
            borderTopWidth: 1,
            borderTopColor: palette().popups.border,
            marginTop: 4,
            marginBottom: 4,
          }}
        />
        <ScopeRow
          id="trash"
          name="Trash"
          count={store.trashCount() ?? undefined}
          active={store.vaultView() === "trash"}
          onPress={store.openTrash}
        />
      </View>

      <If when={store.vaultView() === "active"}>
        <View style={{ minWidth: 220, flex: 1, gap: 4 }}>
          <Text style={{ color: palette().muted, fontSize: store.type().sm, fontWeight: "bold" }}>
            Folders
          </Text>
          <ScopeRow
            id="folder-all"
            name="All Folders"
            count={store.scopeRowCount()}
            active={store.folderId() === null}
            onPress={() => store.setFolder(null)}
          />
          <Each of={store.folderOptions()} key="index">
            {(folder) => (
              <ScopeRow
                id={folder().id}
                name={folder().name}
                count={folder().count}
                active={store.folderId() === folder().id}
                onPress={() => store.setFolder(folder().id)}
              />
            )}
          </Each>
        </View>
      </If>

      <If when={store.vaultView() === "active"}>
        <View
          style={{
            width: "100%",
            backgroundColor: tint(palette().info, palette().popups.background, 0.12),
            borderRadius: 7,
            padding: 8,
          }}
        >
          <Text style={{ color: palette().muted, fontSize: store.type().sm }}>
            Scope filters apply together with the category tabs and the search text.
          </Text>
        </View>
      </If>
    </View>
  );
}
