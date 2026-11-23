import { effect, keymap, Text, View } from "nsh";
import { Button } from "nsh/base";
import * as store from "../store/appStore";
import { windowBelowMinimum } from "../store/windowGate";
import { tint } from "../theme/palette";
import { Icon, type IconName } from "./Icon";
import { ModalShell } from "./ui";

interface TypeOption {
  cipherType: "login" | "note";
  label: string;
  hint: string;
  key: string;
  icon: IconName;
}

const OPTIONS: TypeOption[] = [
  {
    cipherType: "login",
    label: "Login",
    hint: "A username, a password, and the websites it belongs to.",
    key: "L",
    icon: "key",
  },
  {
    cipherType: "note",
    label: "Secure Note",
    hint: "A private note with no login fields.",
    key: "N",
    icon: "file-text",
  },
];

/**
 * `Ctrl+N`'s "which kind?" step: a compact picker that answers the question
 * once and hands the Inspector the type, instead of guessing from the tab.
 */
export function TypePickerModal() {
  const palette = store.palette;
  const index = store.typePickerIndex;
  const selected = () => OPTIONS[index()] ?? OPTIONS[0];

  // The picker owns the keyboard while it is open: a single key chooses, the
  // arrows move, and Enter takes the highlighted row.
  effect(() => {
    if (windowBelowMinimum()) {
      return;
    }
    return keymap.bind(
      {
        l: () => store.selectTypePicker("login"),
        n: () => store.selectTypePicker("note"),
        up: () => store.moveTypePicker(-1),
        down: () => store.moveTypePicker(1),
        enter: () => store.chooseTypePickerSelection(),
      },
      { when: "always" },
    );
  });

  return (
    <ModalShell
      title="Create Item"
      testID="type-picker"
      subtitle="Choose what to add to the vault."
      width={420}
      onClose={store.closeModal}
    >
      <Each of={OPTIONS} key="index">
        {(option, optionIndex) => (
          <TypeRow
            option={option()}
            selected={index() === optionIndex()}
            onPress={() => store.selectTypePicker(option().cipherType)}
          />
        )}
      </Each>
      <Text
        testID="type-picker-hint"
        style={{ color: palette().muted, fontSize: store.type().sm }}
      >
        Enter creates a {selected().label}. Press Ctrl+N again to switch.
      </Text>
    </ModalShell>
  );
}

function TypeRow(props: { option: TypeOption; selected: boolean; onPress: () => void }) {
  const palette = store.palette;
  const foreground = () => (props.selected ? palette().popups.selectedText : palette().popups.text);
  const background = () =>
    props.selected ? palette().popups.selectedBackground : palette().popups.background;
  return (
    <Button
      testID={`type-picker-option-${props.option.cipherType}`}
      accessibilityLabel={props.option.label}
      selected={props.selected}
      onPress={props.onPress}
      style={{
        width: "100%",
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        paddingHorizontal: 10,
        paddingVertical: 8,
        borderRadius: 8,
        borderColor: palette().popups.border,
        borderWidth: 1,
        backgroundColor: background(),
      }}
      hoverStyle={{ backgroundColor: tint(palette().popups.selectedText, background(), 0.12) }}
      activeStyle={{ backgroundColor: tint(palette().popups.selectedText, background(), 0.22) }}
      focusVisibleStyle={{ borderColor: palette().popups.selectedText }}
    >
      <View style={{ width: 18, alignItems: "center" }}>
        <Icon name={props.option.icon} size={14} color={foreground()} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <Text style={{ color: foreground(), fontSize: store.type().md, fontWeight: "bold" }}>
          {props.option.label}
        </Text>
        <Text style={{ color: palette().muted, fontSize: store.type().sm }}>
          {props.option.hint}
        </Text>
      </View>
      <View
        style={{
          borderColor: palette().popups.border,
          borderWidth: 1,
          borderRadius: 4,
          paddingHorizontal: 6,
          paddingVertical: 1,
        }}
      >
        <Text style={{ color: palette().muted, fontSize: store.type().xs }}>{props.option.key}</Text>
      </View>
    </Button>
  );
}
