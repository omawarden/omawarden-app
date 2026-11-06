import { Text, View } from "nsh";
import * as store from "../store/appStore";
import { EMPTY_STATE_MAX_WIDTH } from "../theme/layout";

export function EmptyInspector() {
  const palette = store.palette;
  return (
    <View
      testID="empty-inspector"
      style={{
        flex: 1,
        backgroundColor: palette().popups.background,
        borderColor: palette().popups.border,
        borderWidth: 1,
        borderRadius: 10,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <View style={{ width: "100%", maxWidth: EMPTY_STATE_MAX_WIDTH, alignItems: "center", gap: 6 }}>
        <Text style={{ color: palette().popups.text, fontSize: 16, fontWeight: "bold" }}>
          No item selected
        </Text>
        <Text style={{ color: palette().muted, fontSize: 13, textAlign: "center" }}>
          Choose an item from the list to inspect its secrets, copy fields, and manage attachments.
        </Text>
      </View>
    </View>
  );
}
