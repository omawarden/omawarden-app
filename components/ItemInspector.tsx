import { Image, Scroll, Text, View } from "nsh";
import { Progress } from "nsh/base";
import type { InspectorView } from "omawarden-app/native";
import * as store from "../store/appStore";
import { formatMaskedCardNumber, formatRevealedCardNumber } from "../store/CardFormatter";
import { tint } from "../theme/palette";
import { ActionButton, Chip, FieldRow, Panel, SectionTitle } from "./ui";
import { GhostIconButton } from "./GhostIconButton";
import { EmptyInspector } from "./EmptyInspector";
import { Icon } from "./Icon";

export function ItemInspector() {
  return (
    <If when={store.inspector()} else={<EmptyInspector />}>
      {(item) => <InspectorBody item={item} />}
    </If>
  );
}

function InspectorBody(props: { item: () => InspectorView }) {
  const palette = store.palette;
  const item = props.item;
  const attachment = store.attachmentPreview;
  const reprompt = () => item().reprompt === 1 && store.repromptRequired();
  const totpDanger = () => Boolean(item().totp?.valid) && (item().totp?.remaining ?? 0) <= 5;
  const totpColor = () => (totpDanger() ? palette().danger : palette().popups.selectedText);

  return (
    <View
      testID="item-inspector"
      style={{
        flex: 1,
        backgroundColor: palette().popups.background,
        borderColor: palette().popups.border,
        borderWidth: 1,
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      <View
        style={{
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: palette().popups.border,
          gap: 4,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Text style={{ color: palette().popups.text, fontSize: 17, fontWeight: "bold" }}>
            {item().title}
          </Text>
          {item().favorite ? <Icon name="star" size={11} color={palette().warning} /> : null}
          <Chip label={categoryLabel(item().category)} color={palette().info} />
        </View>
        <Text style={{ color: palette().muted, fontSize: 11 }}>
          {item().metadata.folder || "No folder"}
          {item().metadata.organization ? ` · ${item().metadata.organization}` : ""}
        </Text>
      </View>

      <Scroll style={{ flex: 1 }} contentStyle={{ padding: 12, gap: 12 }}>
        {reprompt() ? (
          <View
            testID="inspector-reprompt"
            style={{
              backgroundColor: tint(palette().warning, palette().popups.background, 0.16),
              borderColor: palette().warning,
              borderWidth: 1,
              borderRadius: 8,
              padding: 10,
              gap: 8,
            }}
          >
            <Text style={{ color: palette().popups.text, fontSize: 12, fontWeight: "bold" }}>
              Master password required
            </Text>
            <Text style={{ color: palette().muted, fontSize: 11 }}>
              Confirm your master password to reveal or copy secrets from this item.
            </Text>
            <ActionButton
              label="Confirm Master Password"
              testID="inspector-reprompt-confirm"
              tone="primary"
              onPress={store.requestReprompt}
            />
          </View>
        ) : null}

        {item().category === "login" ? (
          <Panel testID="inspector-login">
            <SectionTitle>Login</SectionTitle>
            <FieldRow
              label="Username"
              value={item().username ?? ""}
              copyTestID="copy-username"
              onCopy={() => store.copyField("username")}
            />
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Text style={{ color: palette().muted, fontSize: 12, width: 132 }}>Password</Text>
                <Text
                  testID="inspector-password"
                  selectable
                  style={{
                    flex: 1,
                    color: palette().popups.text,
                    fontSize: 13,
                    fontFamily: "monospace",
                  }}
                >
                  {item().password ?? item().passwordMasked}
                </Text>
                <GhostIconButton
                  testID="reveal-password"
                  label={store.reveal().revealPassword ? "Hide password" : "Show password"}
                  icon={store.reveal().revealPassword ? "eye-off" : "eye"}
                  onPress={() => store.toggleReveal("password")}
                />
                <GhostIconButton
                  testID="copy-password"
                  label="Copy password"
                  icon="copy"
                  onPress={() => store.copyField("password")}
                />
              </View>
              {item().passwordHistory.length > 0 ? (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ color: palette().muted, fontSize: 11 }}>
                    Password History ({item().passwordHistory.length})
                  </Text>
                  <GhostIconButton
                    testID="open-password-history"
                    label="View password history"
                    icon="history"
                    onPress={store.openPasswordHistory}
                  />
                </View>
              ) : null}
            </View>

            {item().totp ? (
              <View testID="inspector-totp" style={{ gap: 4 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={{ color: palette().muted, fontSize: 12 }}>TOTP Code</Text>
                  <Text
                    testID="inspector-totp-remaining"
                    style={{
                      color: totpDanger() ? palette().danger : palette().muted,
                      fontSize: 12,
                      fontWeight: totpDanger() ? "bold" : "normal",
                    }}
                  >
                    {item().totp?.valid ? `${item().totp?.remaining}s` : "Unavailable"}
                  </Text>
                  <View style={{ flex: 1 }} />
                  <GhostIconButton
                    testID="refresh-totp"
                    label="Refresh TOTP"
                    icon="refresh-cw"
                    onPress={store.refreshTotp}
                  />
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Text
                    testID="inspector-totp-code"
                    selectable={!reprompt()}
                    style={{
                      flex: 1,
                      color: reprompt() ? palette().muted : totpColor(),
                      fontSize: 24,
                      fontWeight: "bold",
                      fontFamily: "monospace",
                      letterSpacing: 3,
                    }}
                  >
                    {reprompt()
                      ? "••• •••"
                      : item().totp?.valid
                        ? item().totp?.formatted
                        : item().totp?.error ?? "—"}
                  </Text>
                  <GhostIconButton
                    testID="copy-totp"
                    label="Copy TOTP code"
                    icon="copy"
                    onPress={() => store.copyField("totp")}
                  />
                </View>
                <Progress
                  value={
                    (item().totp?.period ?? 0) > 0
                      ? Math.max(
                          0,
                          Math.min(
                            100,
                            ((item().totp?.remaining ?? 0) / (item().totp?.period ?? 1)) * 100,
                          ),
                        )
                      : 0
                  }
                  trackStyle={{
                    height: 3,
                    borderRadius: 2,
                    backgroundColor: tint(
                      palette().popups.text,
                      palette().popups.background,
                      0.1,
                    ),
                  }}
                  indicatorStyle={{ height: 3, borderRadius: 2, backgroundColor: totpColor() }}
                />
              </View>
            ) : null}

            {item().uris.length > 0 ? (
              <View style={{ gap: 4 }}>
                <Text style={{ color: palette().muted, fontSize: 12 }}>Website URIs</Text>
                <Each of={item().uris} key="index">
                  {(uri) => (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 8,
                        flexWrap: "wrap",
                      }}
                    >
                      <Text
                        selectable
                        style={{ color: palette().popups.text, fontSize: 12, flex: 1 }}
                      >
                        {uri().host || uri().uri}
                      </Text>
                      <GhostIconButton
                        testID={`copy-uri-${uri().host}`}
                        label="Copy website URL"
                        icon="copy"
                        onPress={() => store.copyText(uri().uri, "website URL", false)}
                      />
                      <GhostIconButton
                        testID={`launch-uri-${uri().host}`}
                        label="Open website"
                        icon="external-link"
                        onPress={() => store.openUrl(uri().uri)}
                      />
                    </View>
                  )}
                </Each>
              </View>
            ) : null}
          </Panel>
        ) : null}

        {item().category === "card" && item().card ? (
          <Panel testID="inspector-card">
            <SectionTitle>Card</SectionTitle>
            <FieldRow label="Cardholder" value={item().card?.cardholderName ?? ""} />
            <View style={{ flexDirection: "row", gap: 6 }}>
              {item().card?.brand ? (
                <Chip label={item().card?.brand ?? ""} color={palette().purple} />
              ) : null}
            </View>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ color: palette().muted, fontSize: 12, width: 132 }}>
                Card Number
              </Text>
              <Text
                testID="inspector-card-number"
                selectable
                style={{
                  flex: 1,
                  color: palette().popups.text,
                  fontSize: 14,
                  fontFamily: "monospace",
                }}
              >
                {store.reveal().revealCardNumber && !reprompt()
                  ? formatRevealedCardNumber(item().card?.number, item().card?.brand)
                  : formatMaskedCardNumber(
                      item().card?.numberMasked ?? item().card?.number,
                      item().card?.brand,
                    )}
              </Text>
              <GhostIconButton
                testID="reveal-card-number"
                label={store.reveal().revealCardNumber ? "Hide card number" : "Show card number"}
                icon={store.reveal().revealCardNumber ? "eye-off" : "eye"}
                onPress={() => store.toggleReveal("cardNumber")}
              />
              <GhostIconButton
                testID="copy-card-number"
                label="Copy card number"
                icon="copy"
                onPress={() => store.copyField("card_number")}
              />
            </View>
            <FieldRow
              label="Expiration"
              value={item().card?.expiration ?? ""}
              copyTestID="copy-expiration"
              onCopy={() =>
                store.copyText(item().card?.expiration ?? "", "expiration", false)
              }
            />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ color: palette().muted, fontSize: 12, width: 132 }}>
                Security Code
              </Text>
              <Text
                testID="inspector-cvv"
                selectable
                style={{
                  flex: 1,
                  color: palette().popups.text,
                  fontSize: 13,
                  fontFamily: "monospace",
                }}
              >
                {item().card?.cvv || item().card?.cvvMasked}
              </Text>
              <GhostIconButton
                testID="reveal-cvv"
                label={store.reveal().revealCvv ? "Hide security code" : "Show security code"}
                icon={store.reveal().revealCvv ? "eye-off" : "eye"}
                onPress={() => store.toggleReveal("cvv")}
              />
              <GhostIconButton
                testID="copy-cvv"
                label="Copy security code"
                icon="copy"
                onPress={() => store.copyField("cvv")}
              />
            </View>
          </Panel>
        ) : null}

        {item().category === "identity" && item().identity ? (
          <Panel testID="inspector-identity">
            <SectionTitle>Identity</SectionTitle>
            <FieldRow
              label="Full Name"
              value={item().identity?.fullName ?? ""}
              copyTestID="copy-full-name"
              onCopy={() =>
                store.copyText(item().identity?.fullName ?? "", "full name", false)
              }
            />
            <FieldRow
              label="Username"
              value={item().identity?.username ?? ""}
              copyTestID="copy-identity-username"
              onCopy={() =>
                store.copyText(item().identity?.username ?? "", "username", false)
              }
            />
            <FieldRow
              label="Company"
              value={item().identity?.company ?? ""}
              copyTestID="copy-company"
              onCopy={() => store.copyText(item().identity?.company ?? "", "company", false)}
            />
            <FieldRow
              label="Email"
              value={item().identity?.email ?? ""}
              copyTestID="copy-identity-email"
              onCopy={() => store.copyText(item().identity?.email ?? "", "email", false)}
            />
            <FieldRow
              label="Phone"
              value={item().identity?.phone ?? ""}
              copyTestID="copy-phone"
              onCopy={() => store.copyText(item().identity?.phone ?? "", "phone", false)}
            />
            <FieldRow
              label="SSN"
              value={item().identity?.ssn ?? ""}
              copyTestID="copy-ssn"
              onCopy={() => store.copyText(item().identity?.ssn ?? "", "SSN", true)}
            />
            <FieldRow
              label="Passport"
              value={item().identity?.passportNumber ?? ""}
              copyTestID="copy-passport"
              onCopy={() =>
                store.copyText(item().identity?.passportNumber ?? "", "passport", true)
              }
            />
            <FieldRow
              label="License"
              value={item().identity?.licenseNumber ?? ""}
              copyTestID="copy-license"
              onCopy={() =>
                store.copyText(item().identity?.licenseNumber ?? "", "license", true)
              }
            />
            <FieldRow
              label="Address"
              value={[
                item().identity?.address1,
                item().identity?.address2,
                item().identity?.address3,
              ]
                .filter(Boolean)
                .join(", ")}
            />
            <FieldRow label="City" value={item().identity?.city ?? ""} />
            <FieldRow label="State" value={item().identity?.state ?? ""} />
            <FieldRow label="Postal Code" value={item().identity?.postalCode ?? ""} />
            <FieldRow label="Country" value={item().identity?.country ?? ""} />
          </Panel>
        ) : null}

        {item().category === "sshKey" && item().ssh ? (
          <Panel testID="inspector-ssh">
            <SectionTitle>SSH Key</SectionTitle>
            <View style={{ flexDirection: "row", gap: 6 }}>
              <Chip label={item().ssh?.keyType ?? ""} color={palette().purple} />
            </View>
            <FieldRow
              label="Fingerprint"
              value={item().ssh?.fingerprint ?? ""}
              mono
              copyTestID="copy-fingerprint"
              onCopy={() =>
                store.copyText(item().ssh?.fingerprint ?? "", "fingerprint", false)
              }
            />
            <FieldRow
              label="Public Key"
              value={item().ssh?.publicKey ?? ""}
              mono
              copyTestID="copy-public-key"
              onCopy={() => store.copyText(item().ssh?.publicKey ?? "", "public key", false)}
            />
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <Text style={{ color: palette().muted, fontSize: 12, width: 132 }}>
                Private Key
              </Text>
              <Text
                testID="inspector-private-key"
                selectable
                numberOfLines={4}
                style={{
                  flex: 1,
                  color: palette().popups.text,
                  fontSize: 12,
                  fontFamily: "monospace",
                }}
              >
                {item().ssh?.privateKey}
              </Text>
              <GhostIconButton
                testID="reveal-private-key"
                label={store.reveal().revealPrivateKey ? "Hide private key" : "Show private key"}
                icon={store.reveal().revealPrivateKey ? "eye-off" : "eye"}
                onPress={() => store.toggleReveal("privateKey")}
              />
              <GhostIconButton
                testID="copy-private-key"
                label="Copy private key"
                icon="copy"
                onPress={() => store.copyField("private_key")}
              />
              <GhostIconButton
                testID="export-ssh-key"
                label="Export SSH key to ~/.ssh"
                icon="upload"
                onPress={() => store.openSshKey("export")}
              />
            </View>
          </Panel>
        ) : null}

        {item().notes ? (
          <Panel testID="inspector-notes">
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
              }}
            >
              <SectionTitle>Secure Note</SectionTitle>
              <GhostIconButton
                testID="copy-notes"
                label="Copy secure note"
                icon="copy"
                onPress={() => store.copyField("notes")}
              />
            </View>
            <Text selectable style={{ color: palette().popups.text, fontSize: 13, lineHeight: 19 }}>
              {item().notes}
            </Text>
          </Panel>
        ) : null}

        {item().fields.length > 0 ? (
          <Panel testID="inspector-fields">
            <SectionTitle>Custom Fields</SectionTitle>
            <Each of={item().fields} key="index">
              {(field) => (
                <View style={{ gap: 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ color: palette().muted, fontSize: 12, width: 132 }}>
                      {field().name || `Field ${field().index + 1}`}
                    </Text>
                    <Text
                      testID={`field-value-${field().index}`}
                      selectable
                      style={{ flex: 1, color: palette().popups.text, fontSize: 13 }}
                    >
                      {field().kind === "hidden" &&
                      !store.reveal().revealFields.includes(field().index)
                        ? field().valueMasked
                        : field().value}
                    </Text>
                    {field().kind === "hidden" ? (
                      <GhostIconButton
                        testID={`reveal-field-${field().index}`}
                        label={
                          store.reveal().revealFields.includes(field().index)
                            ? "Hide field"
                            : "Show field"
                        }
                        icon={
                          store.reveal().revealFields.includes(field().index)
                            ? "eye-off"
                            : "eye"
                        }
                        onPress={() => store.toggleRevealField(field().index)}
                      />
                    ) : null}
                    <GhostIconButton
                      testID={`copy-field-${field().index}`}
                      label="Copy field"
                      icon="copy"
                      onPress={() => store.copyField("custom", field().index)}
                    />
                  </View>
                  <Text style={{ color: palette().muted, fontSize: 10 }}>{field().kind}</Text>
                </View>
              )}
            </Each>
          </Panel>
        ) : null}

        {item().attachments.length > 0 ? (
          <Panel testID="inspector-attachments">
            <SectionTitle>Attachments</SectionTitle>
            <Each of={item().attachments} key="index">
              {(file) => (
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <Text style={{ color: palette().popups.text, fontSize: 12, flex: 1 }}>
                    {file().filename}
                  </Text>
                  <Text style={{ color: palette().muted, fontSize: 11 }}>
                    {file().sizeLabel}
                  </Text>
                  <GhostIconButton
                    testID={`preview-attachment-${file().id}`}
                    label="Preview attachment"
                    icon="eye"
                    onPress={() => store.openAttachment(item().id, file().id, "preview")}
                  />
                  <GhostIconButton
                    testID={`download-attachment-${file().id}`}
                    label="Download attachment"
                    icon="download"
                    onPress={() => store.saveAttachment(item().id, file().id)}
                  />
                </View>
              )}
            </Each>
            {attachment() ? (
              <View
                testID="attachment-preview"
                style={{
                  backgroundColor: tint(
                    palette().info,
                    palette().popups.background,
                    0.12,
                  ),
                  borderRadius: 8,
                  padding: 8,
                  gap: 4,
                }}
              >
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text
                    style={{ color: palette().popups.text, fontSize: 12, fontWeight: "bold" }}
                  >
                    {attachment()?.filename}
                  </Text>
                  <GhostIconButton
                    testID="close-attachment-preview"
                    label="Close preview"
                    icon="x"
                    onPress={store.closeAttachmentPreview}
                  />
                </View>
                {attachment()?.isImage ? (
                  <View style={{ gap: 6 }}>
                    <If
                      when={(attachment()?.dataUrl ?? "") !== ""}
                      else={
                        <Text style={{ color: palette().muted, fontSize: 11 }}>
                          This image is too large to preview here. Open it with the system viewer.
                        </Text>
                      }
                    >
                      <Image
                        testID="attachment-image"
                        src={attachment()?.dataUrl ?? ""}
                        resizeMode="contain"
                        style={{
                          width: "100%",
                          maxHeight: 320,
                          minHeight: 120,
                          borderRadius: 6,
                        }}
                      />
                    </If>
                    <GhostIconButton
                      testID="open-attachment-external"
                      label="Open attachment with system viewer"
                      icon="external-link"
                      onPress={store.launchAttachmentPreview}
                    />
                  </View>
                ) : (
                  <View style={{ gap: 6 }}>
                    <Scroll style={{ maxHeight: 320 }}>
                      <Text
                        testID="attachment-text"
                        selectable
                        style={{
                          color: palette().popups.text,
                          fontSize: 12,
                          fontFamily: "monospace",
                        }}
                      >
                        {attachment()?.text}
                      </Text>
                    </Scroll>
                    <GhostIconButton
                      testID="copy-attachment-content"
                      label="Copy attachment content"
                      icon="copy"
                      onPress={() =>
                        store.copyText(attachment()?.text ?? "", "attachment content", true)
                      }
                    />
                  </View>
                )}
              </View>
            ) : null}
          </Panel>
        ) : null}

        <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
          <Text style={{ color: palette().muted, fontSize: 11 }}>
            Folder: {item().metadata.folder || "—"}
          </Text>
          <Text style={{ color: palette().muted, fontSize: 11 }}>
            Organization: {item().metadata.organization || "—"}
          </Text>
          {item().metadata.createdAt ? (
            <Text style={{ color: palette().muted, fontSize: 11 }}>
              Created: {item().metadata.createdAt}
            </Text>
          ) : null}
          {item().metadata.updatedAt ? (
            <Text style={{ color: palette().muted, fontSize: 11 }}>
              Updated: {item().metadata.updatedAt}
            </Text>
          ) : null}
        </View>

        {item().error ? (
          <Text style={{ color: palette().danger, fontSize: 12 }}>{item().error}</Text>
        ) : null}
      </Scroll>
    </View>
  );
}

function categoryLabel(category: string): string {
  switch (category) {
    case "login":
      return "Login";
    case "card":
      return "Card";
    case "identity":
      return "Identity";
    case "secureNote":
      return "Secure Note";
    case "sshKey":
      return "SSH Key";
    default:
      return "Item";
  }
}
