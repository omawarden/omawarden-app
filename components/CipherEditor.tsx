import { effect, Scroll, Text, View } from "nsh";
import { Input } from "nsh/base";
import type { CipherMutationInput } from "omawarden-app/native";
import * as store from "../store/appStore";
import {
  markCipherFieldFocus,
  registerCipherField,
  setCipherPasswordField,
} from "../store/cipherFormFocus";
import { tint } from "../theme/palette";
import { inputStyle } from "./AuthView";
import { ActionButton, actionID, Panel, SectionTitle, SmallButton } from "./ui";

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

/**
 * The Inspector's form view: creating and editing a Login or a Secure Note in
 * place, where the item's details would be.
 *
 * It replaces the old centred form dialog so the list and the search stay in
 * view; the pane alternates between the item, the empty state, and this form.
 */
export function CipherEditor() {
  const palette = store.palette;
  const draft = store.cipherForm;
  const editing = () => store.cipherFormId() !== null;
  const login = () => isLoginDraft(draft());
  const busy = () => store.isSubmitting();
  const outcome = store.cipherFormOutcome;
  // An item without a URL still gets one editable row, so the first URL can be
  // added on an edit; an item with URLs shows its first row as the only input.
  const uriRows = () => {
    const list = uriList(draft());
    return editing() && list.length === 0 ? [""] : list;
  };

  // The form's buttons in the order they read, top to bottom. The platform
  // reports the controls in the order it mounted them, which is breadth first
  // and would put Cancel and Create before the Generate… button above them;
  // Tab follows this list instead.
  effect(() => {
    if (draft() === null) {
      return;
    }
    const ids = [actionID("inspector-form-generate")];
    if (!editing()) {
      ids.push(actionID("inspector-form-uri-add"));
      for (let index = 0; index < uriList(draft()).length; index += 1) {
        ids.push(actionID(`inspector-form-uri-remove-${index}`));
      }
    }
    if (store.cipherFormDiscardConfirm()) {
      ids.push(actionID("inspector-form-keep"), actionID("inspector-form-discard"));
    }
    ids.push(actionID("inspector-form-cancel"), actionID("inspector-form-submit"));
    store.setCipherFormActionRing(ids);
    return () => store.setCipherFormActionRing([]);
  });

  return (
    <View testID="inspector-form" style={{ flex: 1, overflow: "hidden" }}>
      <Scroll style={{ flex: 1 }} contentStyle={{ padding: 12 }}>
        <View style={{ gap: 12 }}>
          <View style={{ gap: 2 }}>
            <Text
              testID="inspector-form-title"
              style={{
                color: palette().popups.text,
                fontSize: store.type()["2xl"],
                fontWeight: "bold",
              }}
            >
              {editing() ? "Edit Item" : login() ? "New Login" : "New Secure Note"}
            </Text>
            <Text style={{ color: palette().muted, fontSize: store.type().base }}>
              {editing()
                ? "Update the fields you want to change."
                : login()
                  ? "Create a login."
                  : "Create a secure note."}
            </Text>
          </View>

          <Panel testID="inspector-form-fields">
            <SectionTitle hint="The name is what the vault list shows.">Details</SectionTitle>
            <FormInput
              label="Name"
              fieldKey="name"
              testID="inspector-form-name"
              value={textOf(draft(), "name")}
              autoFocus
              readOnly={busy()}
              onChange={(value) => store.updateCipherDraft({ name: value })}
              hint="Required."
            />
            <If when={login()}>
              <FormInput
                label="Username"
                fieldKey="username"
                testID="inspector-form-username"
                value={textOf(draft(), "username")}
                readOnly={busy()}
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
                    label="Generate…"
                    testID="inspector-form-generate"
                    disabled={busy()}
                    onPress={store.openGeneratorFill}
                  />
                </View>
                <Input
                  testID="inspector-form-password"
                  ref={(ref) => {
                    setCipherPasswordField(ref);
                    registerCipherField("password", ref);
                  }}
                  onFocus={() => markCipherFieldFocus("password", true)}
                  onBlur={() => markCipherFieldFocus("password", false)}
                  value={textOf(draft(), "password")}
                  masked
                  readonly={busy()}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onChange={({ value }) => store.updateCipherDraft({ password: value })}
                  style={inputStyle()}
                />
                <Text style={{ color: palette().muted, fontSize: store.type().xs }}>
                  Generate opens the password generator; press Enter there to fill this field.
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
                      testID="inspector-form-uri-add"
                      disabled={busy()}
                      onPress={() => {
                        store.updateCipherDraft({ uris: [...uriList(draft()), ""] });
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
                            testID={`inspector-form-uri-${index()}`}
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
                          testID={`inspector-form-uri-${index()}`}
                          ref={(ref) => registerCipherField(`uri-${index()}`, ref)}
                          onFocus={() => markCipherFieldFocus(`uri-${index()}`, true)}
                          onBlur={() => markCipherFieldFocus(`uri-${index()}`, false)}
                          value={uri()}
                          readonly={busy()}
                          autoCapitalize="none"
                          autoCorrect={false}
                          onChange={({ value }) => {
                            const list = [...uriList(draft())];
                            list[index()] = value;
                            store.updateCipherDraft({ uris: list });
                          }}
                          style={{ ...inputStyle(), flex: 1 }}
                        />
                      </If>
                      <If when={!editing()}>
                        <SmallButton
                          label="Remove"
                          testID={`inspector-form-uri-remove-${index()}`}
                          disabled={busy()}
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
                testID="inspector-form-notes"
                ref={(ref) => registerCipherField("notes", ref)}
                onFocus={() => markCipherFieldFocus("notes", true)}
                onBlur={() => markCipherFieldFocus("notes", false)}
                value={textOf(draft(), "notes")}
                multiline
                readonly={busy()}
                autoCapitalize="none"
                autoCorrect={false}
                onChange={({ value }) => store.updateCipherDraft({ notes: value })}
                style={{ ...inputStyle(), minHeight: 110 }}
              />
            </View>
          </Panel>

          <If when={outcome() !== null && !outcome()!.ok}>
            <View
              testID="inspector-form-error"
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

          <If when={store.cipherFormDiscardConfirm()}>
            <View
              testID="inspector-form-discard-confirm"
              style={{
                backgroundColor: tint(palette().danger, palette().popups.background, 0.16),
                borderColor: palette().danger,
                borderWidth: 1,
                borderRadius: 8,
                padding: 10,
                gap: 8,
              }}
            >
              <Text style={{ color: palette().popups.text, fontSize: store.type().base }}>
                Discard your unsaved changes?
              </Text>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
                <ActionButton
                  label="Keep Editing"
                  testID="inspector-form-keep"
                  onPress={store.keepCipherFormEditing}
                />
                <ActionButton
                  label="Discard"
                  testID="inspector-form-discard"
                  tone="danger"
                  onPress={store.confirmCipherFormDiscard}
                />
              </View>
            </View>
          </If>

          <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
            <ActionButton
              label="Cancel"
              testID="inspector-form-cancel"
              disabled={busy()}
              onPress={store.cancelCipherForm}
            />
            <ActionButton
              label={busy() ? "Saving…" : editing() ? "Save Changes" : "Create Item"}
              testID="inspector-form-submit"
              tone="primary"
              disabled={busy()}
              onPress={store.submitCipherFormDraft}
            />
          </View>
          <Text style={{ color: palette().muted, fontSize: store.type().xs }}>
            Tab moves between the fields and the buttons · Ctrl+S saves · Esc cancels
          </Text>
        </View>
      </Scroll>
    </View>
  );
}

function FormInput(props: {
  label: string;
  /** The field's place in the Inspector Form's Tab ring. */
  fieldKey: string;
  testID: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  autoFocus?: boolean;
  readOnly?: boolean;
}) {
  const palette = store.palette;
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: palette().muted, fontSize: store.type().base }}>{props.label}</Text>
      <Input
        testID={props.testID}
        ref={(ref) => registerCipherField(props.fieldKey, ref)}
        onFocus={() => markCipherFieldFocus(props.fieldKey, true)}
        onBlur={() => markCipherFieldFocus(props.fieldKey, false)}
        value={props.value}
        autoFocus={props.autoFocus}
        readonly={props.readOnly}
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
