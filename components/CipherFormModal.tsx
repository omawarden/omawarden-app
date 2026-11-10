import { Text, View } from "nsh";
import { Input } from "nsh/base";
import type { CipherMutationInput } from "omawarden-app/native";
import * as store from "../store/appStore";
import { tint } from "../theme/palette";
import { inputStyle } from "./AuthView";
import { ActionButton, ModalShell, Panel, SectionTitle, SmallButton } from "./ui";

function isLoginDraft(draft: CipherMutationInput | null): boolean {
  const type = (draft?.cipherType ?? "login").toLowerCase();
  return type === "login";
}

function textOf(draft: CipherMutationInput | null, key: keyof CipherMutationInput): string {
  const value = draft?.[key];
  return typeof value === "string" ? value : "";
}

function uriList(draft: CipherMutationInput | null): string[] {
  const uris = draft?.uris;
  return Array.isArray(uris) ? uris : [];
}

export function CipherFormModal() {
  const palette = store.palette;
  const draft = store.cipherForm;
  const editing = () => store.cipherFormId() !== null;
  const outcome = store.cipherFormOutcome;
  const login = () => isLoginDraft(draft());
  // An item without a URL still gets one editable row, so the first URL can be
  // added on an edit; an item with URLs shows its first row as the only input.
  const uriRows = () => {
    const list = uriList(draft());
    return editing() && list.length === 0 ? [""] : list;
  };

  const submit = () => {
    const input = draft();
    if (!input) {
      return;
    }
    const name = (input.name ?? "").trim();
    if (!name) {
      store.notify("Enter an item name before saving.", "error");
      return;
    }
    store.submitCipherForm({ ...input, name }, store.cipherFormId());
  };

  return (
    <ModalShell
      title={
        editing() ? "Edit Item" : login() ? "New Login" : "New Secure Note"
      }
      testID="cipher-form-modal"
      subtitle={
        editing()
          ? "Update the fields you want to change."
          : login()
            ? "Create a login."
            : "Create a secure note."
      }
      width={620}
      onClose={store.cancelCipherForm}
    >
      <Panel testID="cipher-form-fields">
        <SectionTitle hint="The name is what the vault list shows.">Details</SectionTitle>
        <FormInput
          label="Name"
          testID="cipher-form-name"
          value={textOf(draft(), "name")}
          onChange={(value) => store.updateCipherDraft({ name: value })}
          hint="Required."
        />
        <If when={login()}>
          <FormInput
            label="Username"
            testID="cipher-form-username"
            value={textOf(draft(), "username")}
            onChange={(value) => store.updateCipherDraft({ username: value })}
          />
          <View style={{ gap: 4 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <Text style={{ color: palette().muted, fontSize: store.type().base }}>Password</Text>
              <SmallButton
                label="Generate"
                testID="cipher-form-generate"
                onPress={store.generateCipherPassword}
              />
            </View>
            <Input
              testID="cipher-form-password"
              value={textOf(draft(), "password")}
              masked
              autoCapitalize="none"
              autoCorrect={false}
              onChange={({ value }) => store.updateCipherDraft({ password: value })}
              style={inputStyle()}
            />
            <Text style={{ color: palette().muted, fontSize: store.type().xs }}>
              Leave it empty to set it later, or Generate fills a 16-character password.
            </Text>
          </View>
          <View style={{ gap: 6 }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <Text style={{ color: palette().muted, fontSize: store.type().base }}>Websites</Text>
              <If when={!editing()}>
                <SmallButton
                  label="Add URL"
                  testID="cipher-form-uri-add"
                  onPress={() => {
                    const list = uriList(draft());
                    store.updateCipherDraft({ uris: [...list, ""] });
                  }}
                />
              </If>
            </View>
            <Each of={uriRows()} key="index">
              {(uri, index) => (
                <View style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
                  <If
                    when={!editing() || index() === 0}
                    else={
                      <Text
                        testID={`cipher-form-uri-${index()}`}
                        style={{
                          flex: 1,
                          color: palette().muted,
                          fontSize: store.type().base,
                          numberOfLines: 1,
                        }}
                      >
                        {uri()}
                      </Text>
                    }
                  >
                    <Input
                      testID={`cipher-form-uri-${index()}`}
                      value={uri()}
                      autoCapitalize="none"
                      autoCorrect={false}
                      onChange={({ value }) => {
                        const list = uriList(draft());
                        list[index()] = value;
                        store.updateCipherDraft({ uris: list });
                      }}
                      style={{ ...inputStyle(), flex: 1 }}
                    />
                  </If>
                  <If when={!editing()}>
                    <SmallButton
                      label="Remove"
                      testID={`cipher-form-uri-remove-${index()}`}
                      onPress={() => {
                        const list = uriList(draft()).filter((_, i) => i !== index());
                        store.updateCipherDraft({ uris: list });
                      }}
                    />
                  </If>
                </View>
              )}
            </Each>
            <Text style={{ color: palette().muted, fontSize: store.type().xs }}>
              {editing()
                ? "Only the first URL can be changed; the rest are kept."
                : "Each URL becomes a login URI."}
            </Text>
          </View>
        </If>
        <View style={{ gap: 4 }}>
          <Text style={{ color: palette().muted, fontSize: store.type().base }}>Notes</Text>
          <Input
            testID="cipher-form-notes"
            value={textOf(draft(), "notes")}
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            onChange={({ value }) => store.updateCipherDraft({ notes: value })}
            style={{ ...inputStyle(), minHeight: 110 }}
          />
        </View>
      </Panel>

      <If when={outcome() !== null && !outcome()!.ok}>
        <View
          testID="cipher-form-error"
          style={{
            backgroundColor: tint(palette().danger, palette().popups.background, 0.16),
            borderColor: palette().danger,
            borderWidth: 1,
            borderRadius: 8,
            padding: 10,
          }}
        >
          <Text style={{ color: palette().danger, fontSize: store.type().base }}>
            {outcome()?.error ?? "Could not save the item."}
          </Text>
        </View>
      </If>

      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
        <ActionButton label="Cancel" testID="cipher-form-cancel" onPress={store.cancelCipherForm} />
        <ActionButton
          label={editing() ? "Save Changes" : "Create Item"}
          testID="cipher-form-submit"
          tone="primary"
          disabled={store.isSubmitting()}
          onPress={submit}
        />
      </View>
    </ModalShell>
  );
}

function FormInput(props: {
  label: string;
  testID: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  const palette = store.palette;
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: palette().muted, fontSize: store.type().base }}>{props.label}</Text>
      <Input
        testID={props.testID}
        value={props.value}
        autoCapitalize="none"
        autoCorrect={false}
        onChange={({ value }) => props.onChange(value)}
        style={inputStyle()}
      />
      {props.hint ? (
        <Text style={{ color: palette().muted, fontSize: store.type().xs }}>{props.hint}</Text>
      ) : null}
    </View>
  );
}
