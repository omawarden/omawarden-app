import { effect, keymap, signal, Text, View } from "nsh";
import { Input, Switch } from "nsh/base";
import * as store from "../store/appStore";
import {
  MAX_PASSPHRASE_WORDS,
  MAX_PASSWORD_LENGTH,
  MIN_PASSPHRASE_WORDS,
  MIN_PASSWORD_LENGTH,
  avoidAmbiguous,
  capitalize,
  lengthText,
  lowercase,
  minNumbers,
  minSpecial,
  mode,
  numbers,
  passphraseOptions,
  passphraseWordsError,
  passwordLengthError,
  passwordOptions,
  separator,
  special,
  stepLength,
  stepWords,
  uppercase,
  wordsText,
} from "../store/generatorOptions";
import { strengthColor, tint } from "../theme/palette";
import { Icon } from "./Icon";
import { ActionButton, Chip, ModalShell, Panel, SectionTitle, SmallButton } from "./ui";
import { TabButton, inputStyle } from "./AuthView";

const localError = signal<string | null>(null);

export function PasswordGeneratorModal() {
  const palette = store.palette;
  const secret = store.generatedSecret;
  const fill = () => store.generatorFillMode();
  const accent = () =>
    secret()?.ok ? strengthColor(secret()!.entropy, store.theme()) : palette().danger;

  const generate = () => {
    localError.set(null);
    if (mode() === "password") {
      const error = passwordLengthError();
      if (error) {
        localError.set(error);
        return;
      }
      store.generatePassword(passwordOptions());
    } else {
      const error = passphraseWordsError();
      if (error) {
        localError.set(error);
        return;
      }
      store.generatePassphrase(passphraseOptions());
    }
  };

  // The preview is always what the current options produce: a length, a
  // toggle, or a mode change regenerates at once, so there is never a stale
  // secret behind the Regenerate button. An entry outside the range keeps the
  // last secret and says why, and the stepper snaps it back into range.
  effect(() => {
    const error = mode() === "password" ? passwordLengthError() : passphraseWordsError();
    if (error) {
      localError.set(error);
      return;
    }
    localError.set(null);
    if (mode() === "password") {
      store.generatePassword(passwordOptions());
    } else {
      store.generatePassphrase(passphraseOptions());
    }
  });

  const copyAndClose = () => {
    if (!secret()?.ok || !secret()?.value) {
      localError.set("Generate a secret first.");
      return;
    }
    store.copyText(secret()!.value, "generated secret", true);
    store.closeModal();
  };

  const usePassword = () => {
    if (!secret()?.ok || !secret()?.value) {
      localError.set("Generate a secret first.");
      return;
    }
    store.useGeneratedPassword();
  };

  // In fill mode the dialog's whole point is the Enter key. It stays bound
  // while the options are edited, so tuning the length does not cost the
  // shortcut that puts the result in the form.
  effect(() => {
    if (!fill()) {
      return;
    }
    return keymap.bind({ enter: () => usePassword() }, { when: "always" });
  });

  return (
    <ModalShell
      title={fill() ? "Generate Password" : "Password Generator"}
      testID="password-generator-modal"
      subtitle={
        fill()
          ? "Enter fills the form's password field; the secret skips the clipboard."
          : "Generate strong passwords and passphrases locally."
      }
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
          style={{
            userSelect: "text",
            color: palette().popups.text,
            fontSize: store.type()["5xl"],
            fontFamily: "monospace",
            lineHeight: store.type()["7xl"],
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
            <Text style={{ color: palette().danger, fontSize: store.type().base }}>{secret()!.error}</Text>
          ) : null}
        </View>
      </View>

      {localError() ? (
        <Text testID="generator-error" style={{ color: palette().danger, fontSize: store.type().md }}>
          {localError()}
        </Text>
      ) : null}

      {mode() === "password" ? (
        <Panel>
          <SectionTitle>Password Options</SectionTitle>
          <NumberRow
            label={`Length (${MIN_PASSWORD_LENGTH}–${MAX_PASSWORD_LENGTH})`}
            testID="generator-length"
            value={lengthText()}
            min={MIN_PASSWORD_LENGTH}
            max={MAX_PASSWORD_LENGTH}
            autoFocus={fill()}
            onChange={(value: string) => lengthText.set(value)}
            onStep={stepLength}
          />

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
          <NumberRow
            label={`Words (${MIN_PASSPHRASE_WORDS}–${MAX_PASSPHRASE_WORDS})`}
            testID="generator-words"
            value={wordsText()}
            min={MIN_PASSPHRASE_WORDS}
            max={MAX_PASSPHRASE_WORDS}
            autoFocus={fill()}
            onChange={(value: string) => wordsText.set(value)}
            onStep={stepWords}
          />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Text style={{ color: palette().muted, fontSize: store.type().base, width: store.lengths().generatorLabel }}>Separator</Text>
            <Input
              testID="generator-separator"
              value={separator()}
              onChange={({ value }) => separator.set(value)}
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
          label="Regenerate"
          testID="generator-generate"
          tone="primary"
          onPress={generate}
        />
        <If
          when={fill()}
          else={
            <ActionButton
              label="Copy & Close"
              testID="generator-copy-close"
              onPress={copyAndClose}
            />
          }
        >
          <ActionButton
            label="Use Password"
            testID="generator-use-password"
            onPress={usePassword}
          />
        </If>
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
      <Text style={{ color: palette().popups.text, fontSize: store.type().base }}>{props.label}</Text>
      <Switch
        testID={props.testID}
        checked={props.checked}
        onChange={({ checked }) => props.onChange(checked)}
        trackClass="w-11 rounded-full p-0.5 transition-colors"
        thumbClass="size-5 rounded-full shadow-sm transition-transform checked:translate-x-5"
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
    <View
      onWheel={(event) => {
        if (event.delta.y === 0) {
          return;
        }
        props.onChange(Math.max(0, props.value + (event.delta.y < 0 ? 1 : -1)));
      }}
      style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
    >
      <Text style={{ color: palette().muted, fontSize: store.type().base }}>{props.label}</Text>
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
          fontSize: store.type().md,
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

/**
 * A number the panel steps with `−` / `+`, or with the wheel over the row.
 *
 * The field stays an input, so an exact value can still be typed; the buttons
 * and the wheel keep the common case — a few characters more or less — on one
 * hand. The wheel listener sits on the row, nearer than the dialog's scroll
 * view, so spinning it changes the number instead of scrolling the panel.
 */
function NumberRow(props: {
  label: string;
  testID: string;
  value: string;
  min: number;
  max: number;
  autoFocus?: boolean;
  onChange: (value: string) => void;
  onStep: (delta: number) => void;
}) {
  const palette = store.palette;
  const typed = () => Number.parseInt(props.value, 10);
  const atMin = () => Number.isFinite(typed()) && typed() <= props.min;
  const atMax = () => Number.isFinite(typed()) && typed() >= props.max;
  return (
    <View
      testID={`${props.testID}-stepper`}
      onWheel={(event) => {
        if (event.delta.y === 0) {
          return;
        }
        props.onStep(event.delta.y < 0 ? 1 : -1);
      }}
      style={{ flexDirection: "row", alignItems: "center", gap: 10 }}
    >
      <Text
        style={{
          color: palette().muted,
          fontSize: store.type().base,
          width: store.lengths().generatorLabel,
        }}
      >
        {props.label}
      </Text>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <SmallButton
          testID={`${props.testID}-decrease`}
          disabled={atMin()}
          accessibilityLabel={`Decrease ${props.label}`}
          onPress={() => props.onStep(-1)}
        >
          <Icon name="minus" size={12} color={palette().popups.text} />
        </SmallButton>
        <Input
          testID={props.testID}
          value={props.value}
          keyboardType="numeric"
          autoFocus={props.autoFocus}
          onChange={({ value }) => props.onChange(value)}
          style={{ ...inputStyle(), width: 72, textAlign: "center" }}
        />
        <SmallButton
          testID={`${props.testID}-increase`}
          disabled={atMax()}
          accessibilityLabel={`Increase ${props.label}`}
          onPress={() => props.onStep(1)}
        >
          <Icon name="plus" size={12} color={palette().popups.text} />
        </SmallButton>
      </View>
    </View>
  );
}
