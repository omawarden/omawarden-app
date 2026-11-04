import { Text, View } from "nsh";
import { Button } from "nsh/base";
import * as store from "../store/appStore";
import { textOnTint, tint } from "../theme/palette";

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
          pointerEvents="box-none"
          style={{
            position: "absolute",
            bottom: 42,
            left: 0,
            right: 0,
            alignItems: "center",
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
                fontSize: 13,
              }}
            >
              {toast().message}
            </Text>
            <Button
              testID="toast-dismiss"
              accessibilityLabel="Dismiss notification"
              onPress={store.dismissToast}
              style={{ paddingVertical: 1, paddingHorizontal: 4 }}
            >
              <Text style={{ color: palette().muted, fontSize: 12 }}>×</Text>
            </Button>
          </View>
        </View>
      )}
    </If>
  );
}
