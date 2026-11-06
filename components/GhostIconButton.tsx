import { Button } from "nsh/base";
import * as store from "../store/appStore";
import { tint } from "../theme/palette";
import { Icon, type IconName } from "./Icon";
import { actionID, focusOutline, useAction } from "./ui";

/** A compact 22x22 icon-only action: the field-level affordance in the inspector. */
export function GhostIconButton(props: {
  icon: IconName;
  label: string;
  onPress: () => void;
  testID?: string;
  size?: number;
  color?: string;
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
      accessibilityLabel={props.label}
      onPress={props.onPress}
      style={{
        width: 22,
        height: 22,
        minWidth: 22,
        minHeight: 22,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "transparent",
        borderRadius: 4,
        ...focusOutline(focused(), accent()),
      }}
      hoverStyle={{ backgroundColor: tint(accent(), background(), 0.08) }}
      activeStyle={{ backgroundColor: tint(accent(), background(), 0.16) }}
      focusStyle={{ backgroundColor: tint(accent(), background(), 0.08) }}
    >
      <Icon
        name={props.icon}
        size={props.size}
        color={props.color ?? accent()}
      />
    </Button>
  );
}
