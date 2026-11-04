import { signal, Text, View } from "nsh";
import { Input } from "nsh/base";
import * as store from "../store/appStore";
import { inputStyle } from "./AuthView";
import { ActionButton, ModalShell, Panel } from "./ui";

const secret = signal("");

/** Asks for the master password before an item's secrets are shown or copied. */
export function MasterPasswordModal() {
  const palette = store.palette;
  const error = store.repromptError;
  const submitting = store.isSubmitting;

  const submit = () => {
    if (secret().length === 0) {
      return;
    }
    store.confirmMasterPassword(secret());
    secret.set("");
  };

  const cancel = () => {
    secret.set("");
    store.closeModal();
  };

  return (
    <ModalShell
      title="Confirm Master Password"
      testID="reprompt-modal"
      subtitle="This item is protected by a master password re-prompt."
      width={460}
    >
      <Panel>
        <Text style={{ color: palette().muted, fontSize: 12 }}>
          Enter your master password to reveal or copy this item's secrets.
        </Text>
        <Input
          testID="reprompt-password"
          value={secret()}
          placeholder="Master password"
          masked
          autoCapitalize="none"
          autoCorrect={false}
          readonly={submitting()}
          onChange={(text: string) => secret.set(text)}
          onSubmit={submit}
          style={inputStyle()}
        />
        {error() ? (
          <Text testID="reprompt-error" style={{ color: palette().danger, fontSize: 12 }}>
            {error()}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <ActionButton
            label="Confirm"
            testID="reprompt-submit"
            tone="primary"
            disabled={secret().length === 0}
            onPress={submit}
          />
          <ActionButton label="Cancel" testID="reprompt-cancel" onPress={cancel} />
        </View>
      </Panel>
    </ModalShell>
  );
}
