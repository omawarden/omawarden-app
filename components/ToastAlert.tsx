import { Text, View } from "nsh";
import { Button } from "nsh/base";
import * as store from "../store/appStore";
import { textOnTint, tint } from "../theme/palette";
import { Icon } from "./Icon";
import { actionID, focusOutline, useAction } from "./ui";

export function ToastAlert() {
  const palette = store.palette;
  const current = store.toast;
  const accent = () =>
    current()?.kind === "success"
      ? palette().success
      : current()?.kind === "error"
        ? palette().danger
        : palette().info;

  return (
    <If when={current()}>
      {(toast) => (
        <View
          style={{
            position: "absolute",
            bottom: 42,
            left: 0,
            right: 0,
            alignItems: "center",
            pointerEvents: "box-none",
          }}
        >
          <View
            testID="toast"
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              backgroundColor: tint(accent(), palette().popups.background, 0.24),
              borderColor: accent(),
              borderWidth: 1,
              borderRadius: 10,
              paddingHorizontal: 14,
              paddingVertical: 9,
              maxWidth: 620,
            }}
          >
            <Text
              style={{
                color: textOnTint(accent(), palette().popups.background, 0.24),
                fontSize: store.type().md,
              }}
            >
              {toast().message}
            </Text>
            <ToastDismiss accent={accent} />
          </View>
        </View>
      )}
    </If>
  );
}

function ToastDismiss(props: { accent: () => string }) {
  const palette = store.palette;
  const id = actionID("toast-dismiss");
  useAction(id, store.dismissToast);
  const focused = () => store.focusedAction() === id;
  return (
    <Button
      testID="toast-dismiss"
      accessibilityLabel="Dismiss notification"
      onPress={store.dismissToast}
      style={{
        backgroundColor: "transparent",
        borderColor: focused() ? props.accent() : "transparent",
        borderWidth: 1,
        borderRadius: 6,
        paddingVertical: 1,
        paddingHorizontal: 4,
        ...focusOutline(focused(), props.accent()),
      }}
      hoverStyle={{ backgroundColor: tint(props.accent(), palette().popups.background, 0.18) }}
      activeStyle={{ backgroundColor: tint(props.accent(), palette().popups.background, 0.3) }}
      focusStyle={{ borderColor: props.accent() }}
    >
      <Icon name="x" size={11} color={palette().muted} />
    </Button>
  );
}
