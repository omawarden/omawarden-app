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
    count: number;
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
        focusStyle={{ borderColor: accent() }}
      >
        <Text
          style={{
            color: props.active ? palette().popups.selectedText : palette().popups.text,
            fontSize: 12,
            fontWeight: props.active ? "bold" : "normal",
          }}
        >
          {props.name}
        </Text>
        <Text style={{ color: palette().muted, fontSize: 11 }}>{props.count}</Text>
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
      <View style={{ minWidth: 220, flex: 1, gap: 4 }}>
        <Text style={{ color: palette().muted, fontSize: 11, fontWeight: "bold" }}>
          Vault Scope
        </Text>
        <Each of={snap().scopes} key="index">
          {(scope) => (
            <ScopeRow
              id={scope().id}
              name={scope().name}
              count={scope().count}
              active={store.scopeId() === scope().id}
              onPress={() => store.setScope(scope().id)}
            />
          )}
        </Each>
      </View>

      <View style={{ minWidth: 220, flex: 1, gap: 4 }}>
        <Text style={{ color: palette().muted, fontSize: 11, fontWeight: "bold" }}>Folders</Text>
        <ScopeRow
          id="folder-all"
          name="All Folders"
          count={snap().totalCount}
          active={store.folderId() === null}
          onPress={() => store.setFolder(null)}
        />
        <Each of={snap().folders} key="index">
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

      <View
        style={{
          width: "100%",
          backgroundColor: tint(palette().info, palette().popups.background, 0.12),
          borderRadius: 7,
          padding: 8,
        }}
      >
        <Text style={{ color: palette().muted, fontSize: 11 }}>
          Scope filters apply together with the category tabs and the search text.
        </Text>
      </View>
    </View>
  );
}
