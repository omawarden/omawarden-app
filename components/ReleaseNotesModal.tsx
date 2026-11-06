import { Text, View } from "nsh";
import { TextView } from "nsh/base";
import * as store from "../store/appStore";
import { ActionButton, Chip, EmptyHint, ModalShell, Panel, SectionTitle } from "./ui";

export function ReleaseNotesModal() {
  const palette = store.palette;
  const status = store.updateStatus;
  const release = () => status()?.release ?? null;

  return (
    <ModalShell
      title="Release Notes"
      testID="release-notes-modal"
      subtitle="What changed in the latest Omawarden release."
      width={660}
    >
      <If
        when={release()}
        else={
          <View style={{ gap: 10 }}>
            <EmptyHint>
              {status()?.checked
                ? "You are running the latest version. No newer release notes are available."
                : "No update check has run yet."}
            </EmptyHint>
            {status()?.error ? (
              <Text testID="release-notes-error" style={{ color: palette().danger, fontSize: store.type().base }}>
                {status()?.error}
              </Text>
            ) : null}
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <ActionButton
                label="Check for Updates"
                testID="release-notes-check"
                tone="primary"
                onPress={() => store.checkUpdates(true)}
              />
              <ActionButton label="Close" testID="release-notes-close" onPress={store.closeModal} />
            </View>
          </View>
        }
      >
        {(current) => (
          <Panel testID="release-notes-content">
            <View
              style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}
            >
              <Chip label={`v${current().version}`} color={palette().success} />
              <Text style={{ color: palette().popups.text, fontSize: store.type().xl, fontWeight: "bold" }}>
                {current().title}
              </Text>
            </View>
            {current().publishedAt ? (
              <Text style={{ color: palette().muted, fontSize: store.type().sm }}>
                Published {current().publishedAt}
              </Text>
            ) : null}
            <TextView
              testID="release-notes-markdown"
              markdown={current().notes}
              selectable
              links="report"
            />
            <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
              <ActionButton
                label="Open Release Page"
                testID="open-release-page"
                tone="primary"
                onPress={() => store.openUrl(current().url)}
              />
              <ActionButton label="Close" testID="release-notes-close" onPress={store.closeModal} />
            </View>
          </Panel>
        )}
      </If>
    </ModalShell>
  );
}
