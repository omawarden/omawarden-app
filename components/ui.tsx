import type { JSX } from "nsh";
import { Scroll, Text, View } from "nsh";
import { Button } from "nsh/base";
import * as store from "../store/appStore";
import { tint, textOn, textOnTint } from "../theme/palette";

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
  return (
    <Button
      testID={props.testID}
      disabled={props.disabled}
      onPress={props.onPress}
      style={{
        backgroundColor:
          tone === "primary"
            ? palette().menu.selectedBackground
            : tone === "danger"
              ? tint(palette().danger, palette().menu.background, 0.2)
              : palette().menu.background,
        borderColor: palette().menu.border,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 12,
        paddingVertical: 7,
      }}
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
            <Button
              testID={props.copyTestID}
              accessibilityLabel={`Copy ${props.label}`}
              onPress={props.onCopy}
              style={{
                borderColor: palette().popups.border,
                borderWidth: 1,
                borderRadius: 6,
                paddingHorizontal: 8,
                paddingVertical: 3,
              }}
            >
              <Text style={{ color: palette().popups.selectedText, fontSize: 11, fontWeight: "bold" }}>
                Copy
              </Text>
            </Button>
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
          <Button
            testID="modal-close"
            accessibilityLabel="Close dialog"
            onPress={close}
            style={{
              borderColor: palette().popups.border,
              borderWidth: 1,
              borderRadius: 8,
              paddingHorizontal: 10,
              paddingVertical: 5,
            }}
          >
            <Text style={{ color: palette().popups.text, fontSize: 12, fontWeight: "bold" }}>
              Close
            </Text>
          </Button>
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
