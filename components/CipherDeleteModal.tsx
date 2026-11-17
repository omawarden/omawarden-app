import { Text, View } from "nsh";
import * as store from "../store/appStore";
import { tint } from "../theme/palette";
import { ActionButton, ModalShell } from "./ui";

/**
 * Confirms a cipher delete.
 *
 * A soft delete keeps the item in the sync queue; a permanent delete removes
 * it from the vault and the server. The Trash's permanent delete uses a third
 * mode with different copy and a different confirm handler, reachable only from
 * the Trash inspector. The active vault's delete is always soft.
 */
export function CipherDeleteModal() {
  const palette = store.palette;
  const cipher = store.selectedCipher;
  const permanent = store.cipherDeletePermanent;
  const inTrash = () => store.vaultView() === "trash";

  const isTrashPermanent = () => permanent() && inTrash();

  return (
    <ModalShell
      title={isTrashPermanent() ? "Permanently Delete?" : permanent() ? "Delete Permanently?" : "Delete Item?"}
      testID="cipher-delete-modal"
      subtitle={
        isTrashPermanent()
          ? "This cannot be undone."
          : permanent()
            ? "This removes the item from the vault and the server."
            : "This moves the item to the trash and syncs the change."
      }
      width={520}
      onClose={store.closeModal}
    >
      <View style={{ gap: 6 }}>
        <Text style={{ color: palette().popups.text, fontSize: store.type().md }}>
          {cipher()?.title ?? "This item"}
        </Text>
        <Text style={{ color: palette().muted, fontSize: store.type().sm }}>
          {cipher()?.subtitle ?? ""}
        </Text>
      </View>

      <View
        testID="cipher-delete-warning"
        style={{
          backgroundColor: tint(palette().danger, palette().popups.background, 0.16),
          borderColor: palette().danger,
          borderWidth: 1,
          borderRadius: 8,
          padding: 10,
          gap: 4,
        }}
      >
        <Text style={{ color: palette().danger, fontSize: store.type().base, fontWeight: "bold" }}>
          {isTrashPermanent() ? "This cannot be undone." : permanent() ? "This cannot be undone." : "The item can be restored from the trash."}
        </Text>
        <Text style={{ color: palette().muted, fontSize: store.type().sm }}>
          {isTrashPermanent()
            ? "Permanent deletes remove the item from every synced device."
            : permanent()
              ? "Permanent deletes remove the item from every synced device."
              : "A soft delete keeps the item until the next sync and can be undone."}
        </Text>
      </View>

      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
        <ActionButton label="Cancel" testID="cipher-delete-cancel" onPress={store.closeModal} />
        <ActionButton
          label={permanent() ? "Delete Permanently" : "Delete"}
          testID="cipher-delete-confirm"
          tone="danger"
          onPress={() => (isTrashPermanent() ? store.confirmDeleteTrashCipher() : store.confirmDeleteCipher(permanent()))}
        />
      </View>
    </ModalShell>
  );
}
