import { Text, View } from "nsh";
import { Input } from "nsh/base";
import * as store from "../store/appStore";
import { tint } from "../theme/palette";
import { inputStyle } from "./AuthView";
import { ActionButton, ModalShell, Panel, SectionTitle } from "./ui";

/**
 * Targets a cipher by name or id, the GUI's answer to the CLI's
 * `omawarden vault edit <target>` resolution.
 *
 * An exact id or name opens that item directly. A partial name that matches
 * several items lists every candidate, so the wrong cipher is never picked by
 * accident; a name that matches nothing reports the failure instead.
 */
export function CipherResolveModal() {
  const palette = store.palette;
  const candidates = store.cipherCandidates;

  return (
    <ModalShell
      title="Go to Item"
      testID="cipher-resolve-modal"
      subtitle="Type an item name or id. Exact matches open directly; partial names list every match."
      width={560}
      onClose={store.closeModal}
    >
      <View style={{ gap: 4 }}>
        <Text style={{ color: palette().muted, fontSize: store.type().base }}>Name or id</Text>
        <Input
          testID="cipher-resolve-input"
          value={store.cipherResolveQuery()}
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          onChange={({ value }) => store.updateCipherResolveQuery(value)}
          onSubmit={() => store.submitCipherResolve()}
          style={inputStyle()}
        />
      </View>

      <If when={store.cipherResolveError() !== null}>
        <View
          testID="cipher-resolve-error"
          style={{
            backgroundColor: tint(palette().danger, palette().popups.background, 0.16),
            borderColor: palette().danger,
            borderWidth: 1,
            borderRadius: 8,
            padding: 10,
          }}
        >
          <Text style={{ color: palette().danger, fontSize: store.type().base }}>
            {store.cipherResolveError() ?? ""}
          </Text>
        </View>
      </If>

      <If when={(candidates() ?? []).length > 0}>
        <Panel testID="cipher-resolve-candidates">
          <SectionTitle hint="Pick the exact item.">Matches</SectionTitle>
          <Each of={candidates() ?? []} key="index">
            {(candidate) => (
              <ActionButton
                label={`${candidate().name} · ${candidate().typeName}`}
                testID={`cipher-candidate-${candidate().id}`}
                onPress={() => store.pickCipherCandidate(candidate())}
              />
            )}
          </Each>
        </Panel>
      </If>

      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
        <ActionButton label="Cancel" testID="cipher-resolve-cancel" onPress={store.closeModal} />
        <ActionButton
          label="Go"
          testID="cipher-resolve-submit"
          tone="primary"
          onPress={store.submitCipherResolve}
        />
      </View>
    </ModalShell>
  );
}
