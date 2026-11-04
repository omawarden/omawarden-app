import type { JSX } from "nsh";
import { cleanup, Scroll, Text, View } from "nsh";
import { Button } from "nsh/base";
import * as store from "../store/appStore";
import { tint, textOn, textOnTint } from "../theme/palette";
import { GhostIconButton } from "./GhostIconButton";

// Every action control registers with the store so Tab can reach it where the
// platform's native traversal only visits text fields.
let actionSerial = 0;

export function actionID(testID: string | undefined): string {
  if (testID) {
    return `action:${testID}`;
  }
  actionSerial += 1;
  return `action:auto-${actionSerial}`;
}

// Registered in render order so Tab walks the screen top to bottom, and
// released with the component that owns the control.
export function useAction(id: string, onPress: () => void): void {
  store.registerAction(id, onPress);
  cleanup(() => store.unregisterAction(id));
}

export function focusOutline(active: boolean, color: string) {
  return {
    outlineWidth: active ? 2 : 0,
    outlineColor: color,
    outlineStyle: "solid" as const,
    outlineOffset: 1,
  };
}

export function SectionTitle(props: { children?: JSX.Element; hint?: string }) {
  const palette = store.palette;
  return (
    <View style={{ gap: 2 }}>
      <Text style={{ color: palette().menu.text, fontSize: 15, fontWeight: "bold" }}>
        {props.children}
      </Text>
      {props.hint ? (
        <Text style={{ color: palette().muted, fontSize: 12 }}>{props.hint}</Text>
      ) : null}
    </View>
  );
}

export function Panel(props: { children?: JSX.Element; testID?: string }) {
  const palette = store.palette;
  return (
    <View
      testID={props.testID}
      style={{
        backgroundColor: palette().popups.background,
        borderColor: palette().popups.border,
        borderWidth: 1,
        borderRadius: 10,
        padding: 12,
        gap: 8,
      }}
    >
      {props.children}
    </View>
  );
}

export function Chip(props: { label: string; color: string; testID?: string }) {
  const palette = store.palette;
  return (
    <View
      testID={props.testID}
      style={{
        backgroundColor: tint(props.color, palette().menu.background, 0.18),
        borderRadius: 999,
        paddingHorizontal: 8,
        paddingVertical: 2,
        alignSelf: "flex-start",
      }}
    >
      <Text
        style={{
          color: textOnTint(props.color, palette().menu.background, 0.18),
          fontSize: 11,
          fontWeight: "bold",
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}

export function SolidBadge(props: { label: string; color: string }) {
  return (
    <View
      style={{
        backgroundColor: props.color,
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 3,
        alignSelf: "flex-start",
      }}
    >
      <Text style={{ color: textOn(props.color), fontSize: 11, fontWeight: "bold" }}>
        {props.label}
      </Text>
    </View>
  );
}

export function ActionButton(props: {
  label: string;
  onPress: () => void;
  testID?: string;
  tone?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}) {
  const palette = store.palette;
  const tone = props.tone ?? "secondary";
  const id = actionID(props.testID);
  useAction(id, () => props.onPress());
  const focused = () => store.focusedAction() === id;
  const background = () =>
    tone === "primary"
      ? palette().menu.selectedBackground
      : tone === "danger"
        ? tint(palette().danger, palette().menu.background, 0.2)
        : palette().menu.background;
  const accent = () => (tone === "danger" ? palette().danger : palette().menu.selectedText);
  return (
    <Button
      testID={props.testID}
      disabled={props.disabled}
      onPress={props.onPress}
      style={{
        backgroundColor: background(),
        borderColor: focused() ? accent() : palette().menu.border,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 7,
        ...focusOutline(focused(), accent()),
      }}
      hoverStyle={{
        backgroundColor: tint(accent(), background(), 0.14),
        borderColor: accent(),
      }}
      activeStyle={{ backgroundColor: tint(accent(), background(), 0.26) }}
      focusStyle={{ borderColor: accent() }}
      disabledStyle={{ opacity: 0.5 }}
    >
      <Text
        style={{
          color:
            tone === "primary"
              ? palette().menu.selectedText
              : tone === "danger"
                ? textOnTint(palette().danger, palette().menu.background, 0.2)
                : palette().menu.text,
          fontSize: 13,
          fontWeight: "bold",
        }}
      >
        {props.label}
      </Text>
    </Button>
  );
}

export function SmallButton(props: {
  label?: string;
  children?: JSX.Element;
  onPress: () => void;
  testID?: string;
  accessibilityLabel?: string;
  disabled?: boolean;
  alignSelf?: "auto" | "flex-start" | "center" | "flex-end";
  paddingVertical?: number;
}) {
  const palette = store.palette;
  const id = actionID(props.testID);
  useAction(id, () => props.onPress());
  const focused = () => store.focusedAction() === id;
  const accent = () => palette().popups.selectedText;
  const background = () => palette().popups.background;
  return (
    <Button
      testID={props.testID}
      accessibilityLabel={props.accessibilityLabel}
      disabled={props.disabled}
      onPress={props.onPress}
      style={{
        alignSelf: props.alignSelf,
        backgroundColor: background(),
        borderColor: focused() ? accent() : palette().popups.border,
        borderWidth: 1,
        borderRadius: 6,
        paddingHorizontal: 7,
        paddingVertical: props.paddingVertical ?? 3,
        ...focusOutline(focused(), accent()),
      }}
      hoverStyle={{
        backgroundColor: tint(accent(), background(), 0.14),
        borderColor: accent(),
      }}
      activeStyle={{ backgroundColor: tint(accent(), background(), 0.26) }}
      focusStyle={{ borderColor: accent() }}
      disabledStyle={{ opacity: 0.5 }}
    >
      {props.children ?? (
        <Text style={{ color: palette().popups.selectedText, fontSize: 11, fontWeight: "bold" }}>
          {props.label}
        </Text>
      )}
    </Button>
  );
}

export function FieldRow(props: {
  label: string;
  value: string;
  testID?: string;
  copyTestID?: string;
  onCopy?: () => void;
  mono?: boolean;
  mutedValue?: boolean;
}) {
  const palette = store.palette;
  return (
    <If when={props.value}>
      {(value) => (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 3 }}>
          <View style={{ width: 132 }}>
            <Text style={{ color: palette().muted, fontSize: 12 }}>{props.label}</Text>
          </View>
          <Text
            testID={props.testID}
            selectable
            style={{
              flex: 1,
              color: props.mutedValue ? palette().muted : palette().popups.text,
              fontSize: 13,
              fontFamily: props.mono ? "monospace" : undefined,
            }}
          >
            {value()}
          </Text>
          {props.onCopy ? (
            <GhostIconButton
              testID={props.copyTestID}
              label={`Copy ${props.label}`}
              icon="copy"
              onPress={props.onCopy}
            />
          ) : null}
        </View>
      )}
    </If>
  );
}

export function ModalShell(props: {
  title: string;
  testID: string;
  subtitle?: string;
  children?: JSX.Element;
  onClose?: () => void;
  width?: number;
}) {
  const palette = store.palette;
  const close = props.onClose ?? store.closeModal;
  return (
    <View
      testID={props.testID}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: "rgba(0,0,0,0.55)",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <View
        style={{
          width: "100%",
          maxWidth: props.width ?? 620,
          maxHeight: "92%",
          backgroundColor: palette().popups.background,
          borderColor: palette().popups.border,
          borderWidth: 1,
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderBottomColor: palette().popups.border,
          }}
        >
          <View style={{ gap: 2 }}>
            <Text style={{ color: palette().popups.text, fontSize: 18, fontWeight: "bold" }}>
              {props.title}
            </Text>
            {props.subtitle ? (
              <Text style={{ color: palette().muted, fontSize: 12 }}>{props.subtitle}</Text>
            ) : null}
          </View>
          <SmallButton
            testID="modal-close"
            accessibilityLabel="Close dialog"
            label="Close"
            paddingVertical={5}
            onPress={close}
          />
        </View>
        <Scroll style={{ flexGrow: 0 }} contentStyle={{ padding: 16, gap: 12 }}>
          {props.children}
        </Scroll>
      </View>
    </View>
  );
}

export function EmptyHint(props: { children?: JSX.Element }) {
  const palette = store.palette;
  return (
    <View style={{ padding: 16, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: palette().muted, fontSize: 13, textAlign: "center" }}>
        {props.children}
      </Text>
    </View>
  );
}
