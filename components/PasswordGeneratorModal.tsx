import { Text, View } from "nsh";
import { Input, Switch } from "nsh/base";
import { signal } from "nsh";
import * as store from "../store/appStore";
import { strengthColor, tint } from "../theme/palette";
import { Icon } from "./Icon";
import { ActionButton, Chip, ModalShell, Panel, SectionTitle, SmallButton } from "./ui";
import { TabButton, inputStyle } from "./AuthView";

const PASSWORD_LENGTH_ERROR =
  "Password length must be between 5 and 128 characters. Use 14 or more characters for a strong password.";
const PASSPHRASE_WORDS_ERROR = "Passphrase word count must be between 3 and 20 words.";

const mode = signal<"password" | "passphrase">("password");
const lengthText = signal("20");
const uppercase = signal(true);
const lowercase = signal(true);
const numbers = signal(true);
const special = signal(true);
const avoidAmbiguous = signal(false);
const minNumbers = signal(1);
const minSpecial = signal(1);
const wordsText = signal("5");
const separator = signal("-");
const capitalize = signal(false);
const localError = signal<string | null>(null);

export function PasswordGeneratorModal() {
  const palette = store.palette;
  const secret = store.generatedSecret;
  const accent = () =>
    secret()?.ok ? strengthColor(secret()!.entropy, store.theme()) : palette().danger;

  const generate = () => {
    localError.set(null);
    if (mode() === "password") {
      const length = Number.parseInt(lengthText(), 10);
      if (!Number.isFinite(length) || length < 5 || length > 128) {
        localError.set(PASSWORD_LENGTH_ERROR);
        return;
      }
      store.generatePassword({
        length,
        uppercase: uppercase(),
        lowercase: lowercase(),
        numbers: numbers(),
        special: special(),
        avoidAmbiguous: avoidAmbiguous(),
        minNumbers: minNumbers(),
        minSpecial: minSpecial(),
      });
    } else {
      const words = Number.parseInt(wordsText(), 10);
      if (!Number.isFinite(words) || words < 3 || words > 20) {
        localError.set(PASSPHRASE_WORDS_ERROR);
        return;
      }
      store.generatePassphrase({
        words,
        separator: separator() || "-",
        capitalize: capitalize(),
      });
    }
  };

  const copyAndClose = () => {
    if (!secret()?.ok || !secret()?.value) {
      localError.set("Generate a secret first.");
      return;
    }
    store.copyText(secret()!.value, "generated secret", true);
    store.closeModal();
  };

  return (
    <ModalShell
      title="Password Generator"
      testID="password-generator-modal"
      subtitle="Generate strong passwords and passphrases locally."
      width={640}
    >
      <View style={{ flexDirection: "row", gap: 6 }}>
        <TabButton
          label="Password"
          active={mode() === "password"}
          onPress={() => {
            mode.set("password");
            localError.set(null);
          }}
          testID="generator-tab-password"
        />
        <TabButton
          label="Passphrase"
          active={mode() === "passphrase"}
          onPress={() => {
            mode.set("passphrase");
            localError.set(null);
          }}
          testID="generator-tab-passphrase"
        />
      </View>

      <View
        testID="generator-preview"
        style={{
          backgroundColor: tint(accent(), palette().popups.background, 0.14),
          borderColor: accent(),
          borderWidth: 1,
          borderRadius: 10,
          padding: 14,
          gap: 8,
        }}
      >
        <Text
          selectable
          style={{
            color: palette().popups.text,
            fontSize: 20,
            fontFamily: "monospace",
            lineHeight: 28,
          }}
        >
          <SecretText value={secret()?.ok ? secret()!.value : "—"} />
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <Chip
            label={
              secret()?.ok
                ? `${secret()!.strength} · ${secret()!.entropy.toFixed(1)} bits`
                : "No secret yet"
            }
            color={accent()}
          />
          {secret() && !secret()!.ok && secret()!.error ? (
            <Text style={{ color: palette().danger, fontSize: 12 }}>{secret()!.error}</Text>
          ) : null}
        </View>
      </View>

      {localError() ? (
        <Text testID="generator-error" style={{ color: palette().danger, fontSize: 13 }}>
          {localError()}
        </Text>
      ) : null}

      {mode() === "password" ? (
        <Panel>
          <SectionTitle>Password Options</SectionTitle>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ color: palette().muted, fontSize: 12, width: 130 }}>
              Length (5–128)
            </Text>
            <Input
              testID="generator-length"
              value={lengthText()}
              keyboardType="numeric"
              onChange={(text: string) => lengthText.set(text)}
              style={{ ...inputStyle(), width: 110 }}
            />
          </View>

          <SwitchRow
            label="Uppercase"
            checked={uppercase()}
            onChange={(value: boolean) => uppercase.set(value)}
            testID="generator-uppercase"
          />
          <SwitchRow
            label="Lowercase"
            checked={lowercase()}
            onChange={(value: boolean) => lowercase.set(value)}
            testID="generator-lowercase"
          />
          <SwitchRow
            label="Numbers"
            checked={numbers()}
            onChange={(value: boolean) => numbers.set(value)}
            testID="generator-numbers"
          />
          <SwitchRow
            label="Special"
            checked={special()}
            onChange={(value: boolean) => special.set(value)}
            testID="generator-special"
          />
          <SwitchRow
            label="Avoid Ambiguous"
            checked={avoidAmbiguous()}
            onChange={(value: boolean) => avoidAmbiguous.set(value)}
            testID="generator-avoid-ambiguous"
          />

          <View style={{ flexDirection: "row", gap: 16, flexWrap: "wrap" }}>
            <Stepper
              label="Min Numbers"
              value={minNumbers()}
              onChange={(value: number) => minNumbers.set(value)}
              testID="generator-min-numbers"
            />
            <Stepper
              label="Min Special"
              value={minSpecial()}
              onChange={(value: number) => minSpecial.set(value)}
              testID="generator-min-special"
            />
          </View>
        </Panel>
      ) : (
        <Panel>
          <SectionTitle>Passphrase Options</SectionTitle>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ color: palette().muted, fontSize: 12, width: 130 }}>
              Words (3–20)
            </Text>
            <Input
              testID="generator-words"
              value={wordsText()}
              keyboardType="numeric"
              onChange={(text: string) => wordsText.set(text)}
              style={{ ...inputStyle(), width: 110 }}
            />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ color: palette().muted, fontSize: 12, width: 130 }}>Separator</Text>
            <Input
              testID="generator-separator"
              value={separator()}
              onChange={(text: string) => separator.set(text)}
              style={{ ...inputStyle(), width: 110 }}
            />
          </View>
          <SwitchRow
            label="Capitalize Words"
            checked={capitalize()}
            onChange={(value: boolean) => capitalize.set(value)}
            testID="generator-capitalize"
          />
        </Panel>
      )}

      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <ActionButton
          label="Generate"
          testID="generator-generate"
          tone="primary"
          onPress={generate}
        />
        <ActionButton label="Copy & Close" testID="generator-copy-close" onPress={copyAndClose} />
      </View>
    </ModalShell>
  );
}

function SecretText(props: { value: string }) {
  const palette = store.palette;
  return (
    <Each of={props.value.split(/(\d)/)} key="index">
      {(part) => (
        <Text
          style={{
            color: /^\d+$/.test(part()) ? palette().info : palette().popups.text,
            fontWeight: /^\d+$/.test(part()) ? "bold" : "normal",
          }}
        >
          {part()}
        </Text>
      )}
    </Each>
  );
}

function SwitchRow(props: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  testID: string;
}) {
  const palette = store.palette;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <Text style={{ color: palette().popups.text, fontSize: 12 }}>{props.label}</Text>
      <Switch
        testID={props.testID}
        checked={props.checked}
        onChange={props.onChange}
        trackClass="h-5 w-9 rounded-full"
        thumbClass="h-4 w-4 rounded-full"
        trackStyle={{
          backgroundColor: props.checked
            ? palette().popups.selectedBackground
            : palette().popups.border,
        }}
        thumbStyle={{
          backgroundColor: props.checked ? palette().popups.selectedText : palette().muted,
        }}
      />
    </View>
  );
}

function Stepper(props: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  testID: string;
}) {
  const palette = store.palette;
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Text style={{ color: palette().muted, fontSize: 12 }}>{props.label}</Text>
      <SmallButton
        testID={`${props.testID}-decrease`}
        paddingVertical={2}
        onPress={() => props.onChange(Math.max(0, props.value - 1))}
      >
        <Icon name="minus" size={12} color={palette().popups.text} />
      </SmallButton>
      <Text
        testID={props.testID}
        style={{
          color: palette().popups.text,
          fontSize: 13,
          width: 20,
          textAlign: "center",
        }}
      >
        {props.value}
      </Text>
      <SmallButton
        testID={`${props.testID}-increase`}
        paddingVertical={2}
        onPress={() => props.onChange(props.value + 1)}
      >
        <Icon name="plus" size={12} color={palette().popups.text} />
      </SmallButton>
    </View>
  );
}
