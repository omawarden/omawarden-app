import { Text, View } from "nsh";
import * as store from "../store/appStore";
import { ActionButton, EmptyHint, ModalShell, Panel, SectionTitle } from "./ui";

export function PasswordHistoryModal() {
  const palette = store.palette;
  const item = store.inspector;
  const history = () => item()?.passwordHistory ?? [];

  return (
    <ModalShell
      title="Password History"
      testID="password-history-modal"
      subtitle={
        item()
          ? `${item()!.title} · ${history().length} previous password${
              history().length === 1 ? "" : "s"
            }`
          : "Previous passwords"
      }
      width={560}
    >
      <If when={history().length === 0}>
        <EmptyHint>No previous passwords are stored for this item.</EmptyHint>
      </If>
      <Each of={history()} key="index">
        {(entry, index) => (
          <Panel testID={`password-history-${index()}`}>
            <SectionTitle hint={entry().changedAt || "Unknown change date"}>
              Version {history().length - index()}
            </SectionTitle>
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}
            >
              <Text
                testID={`password-history-value-${index()}`}
                style={{
                  userSelect: "text",
                  flex: 1,
                  minWidth: 180,
                  color: palette().popups.text,
                  fontSize: 13,
                  fontFamily: "monospace",
                }}
              >
                {entry().password}
              </Text>
              <ActionButton
                label="Copy"
                testID={`copy-history-password-${index()}`}
                onPress={() =>
                  store.copyText(entry().password, "previous password", true)
                }
              />
            </View>
          </Panel>
        )}
      </Each>

      <View style={{ flexDirection: "row", justifyContent: "flex-end" }}>
        <ActionButton label="Close" testID="password-history-close" onPress={store.closeModal} />
      </View>
    </ModalShell>
  );
}
