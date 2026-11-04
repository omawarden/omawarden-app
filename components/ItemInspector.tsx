import { Scroll, Text, View } from "nsh";
import { Button, Progress } from "nsh/base";
import type { InspectorView } from "omawarden-app/native";
import * as store from "../store/appStore";
import { tint } from "../theme/palette";
import { ActionButton, Chip, FieldRow, Panel, SectionTitle } from "./ui";
import { EmptyInspector } from "./EmptyInspector";

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
          {item().favorite ? <Text style={{ color: palette().warning }}>★</Text> : null}
          <Chip label={categoryLabel(item().category)} color={palette().info} />
        </View>
        <Text style={{ color: palette().muted, fontSize: 11 }}>
          {item().metadata.folder || "No folder"}
          {item().metadata.organization ? ` · ${item().metadata.organization}` : ""}
        </Text>
      </View>

      <Scroll style={{ flex: 1 }} contentStyle={{ padding: 12, gap: 12 }}>
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
                <Button
                  testID="reveal-password"
                  onPress={() => store.toggleReveal("password")}
                  style={smallButtonStyle()}
                >
                  <Text
                    style={{
                      color: palette().popups.selectedText,
                      fontSize: 11,
                      fontWeight: "bold",
                    }}
                  >
                    {store.reveal().revealPassword ? "Hide" : "Reveal"}
                  </Text>
                </Button>
                <Button
                  testID="copy-password"
                  accessibilityLabel="Copy password"
                  onPress={() => store.copyField("password")}
                  style={smallButtonStyle()}
                >
                  <Text
                    style={{
                      color: palette().popups.selectedText,
                      fontSize: 11,
                      fontWeight: "bold",
                    }}
                  >
                    Copy
                  </Text>
                </Button>
              </View>
              {item().passwordHistory.length > 0 ? (
                <Button
                  testID="open-password-history"
                  onPress={store.openPasswordHistory}
                  style={{ alignSelf: "flex-start", paddingVertical: 2 }}
                >
                  <Text style={{ color: palette().popups.selectedText, fontSize: 12 }}>
                    Password History ({item().passwordHistory.length})
                  </Text>
                </Button>
              ) : null}
            </View>

            {item().totp ? (
              <View
                testID="inspector-totp"
                style={{
                  backgroundColor: tint(palette().success, palette().popups.background, 0.12),
                  borderRadius: 8,
                  padding: 10,
                  gap: 6,
                }}
              >
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Text style={{ color: palette().popups.text, fontSize: 12, fontWeight: "bold" }}>
                    Live TOTP
                  </Text>
                  <Text style={{ color: palette().success, fontSize: 11 }}>
                    {item().totp?.valid
                      ? `${item().totp?.remaining}s / ${item().totp?.period}s`
                      : "Unavailable"}
                  </Text>
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Text
                    selectable
                    style={{
                      color: palette().popups.text,
                      fontSize: 24,
                      fontWeight: "bold",
                      fontFamily: "monospace",
                      letterSpacing: 3,
                    }}
                  >
                    {item().totp?.valid
                      ? item().totp?.formatted
                      : item().totp?.error ?? "—"}
                  </Text>
                  <Button
                    testID="copy-totp"
                    accessibilityLabel="Copy TOTP"
                    onPress={() => store.copyField("totp")}
                    style={smallButtonStyle()}
                  >
                    <Text
                      style={{
                        color: palette().popups.selectedText,
                        fontSize: 11,
                        fontWeight: "bold",
                      }}
                    >
                      Copy
                    </Text>
                  </Button>
                  <Button
                    testID="refresh-totp"
                    onPress={store.refreshTotp}
                    style={smallButtonStyle()}
                  >
                    <Text
                      style={{
                        color: palette().popups.selectedText,
                        fontSize: 11,
                        fontWeight: "bold",
                      }}
                    >
                      Refresh
                    </Text>
                  </Button>
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
                  trackClass="h-1.5 rounded-full"
                  indicatorClass="h-1.5 rounded-full"
                  trackStyle={{
                    backgroundColor: tint(
                      palette().success,
                      palette().popups.background,
                      0.2,
                    ),
                  }}
                  indicatorStyle={{ backgroundColor: palette().success }}
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
                      <Button
                        testID={`copy-uri-${uri().host}`}
                        onPress={() => store.copyText(uri().uri, "website URL", false)}
                        style={smallButtonStyle()}
                      >
                        <Text style={{ color: palette().popups.selectedText, fontSize: 11 }}>
                          Copy
                        </Text>
                      </Button>
                      <Button
                        testID={`launch-uri-${uri().host}`}
                        onPress={() => store.openUrl(uri().uri)}
                        style={smallButtonStyle()}
                      >
                        <Text style={{ color: palette().popups.selectedText, fontSize: 11 }}>
                          Open
                        </Text>
                      </Button>
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
                {item().card?.number || item().card?.numberMasked}
              </Text>
              <Button
                testID="reveal-card-number"
                onPress={() => store.toggleReveal("cardNumber")}
                style={smallButtonStyle()}
              >
                <Text
                  style={{
                    color: palette().popups.selectedText,
                    fontSize: 11,
                    fontWeight: "bold",
                  }}
                >
                  {store.reveal().revealCardNumber ? "Hide" : "Reveal"}
                </Text>
              </Button>
              <Button
                testID="copy-card-number"
                accessibilityLabel="Copy card number"
                onPress={() => store.copyField("card_number")}
                style={smallButtonStyle()}
              >
                <Text
                  style={{
                    color: palette().popups.selectedText,
                    fontSize: 11,
                    fontWeight: "bold",
                  }}
                >
                  Copy
                </Text>
              </Button>
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
              <Button
                testID="reveal-cvv"
                onPress={() => store.toggleReveal("cvv")}
                style={smallButtonStyle()}
              >
                <Text
                  style={{
                    color: palette().popups.selectedText,
                    fontSize: 11,
                    fontWeight: "bold",
                  }}
                >
                  {store.reveal().revealCvv ? "Hide" : "Reveal"}
                </Text>
              </Button>
              <Button
                testID="copy-cvv"
                accessibilityLabel="Copy security code"
                onPress={() => store.copyField("cvv")}
                style={smallButtonStyle()}
              >
                <Text
                  style={{
                    color: palette().popups.selectedText,
                    fontSize: 11,
                    fontWeight: "bold",
                  }}
                >
                  Copy
                </Text>
              </Button>
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
              <Button
                testID="reveal-private-key"
                onPress={() => store.toggleReveal("privateKey")}
                style={smallButtonStyle()}
              >
                <Text
                  style={{
                    color: palette().popups.selectedText,
                    fontSize: 11,
                    fontWeight: "bold",
                  }}
                >
                  {store.reveal().revealPrivateKey ? "Hide" : "Reveal"}
                </Text>
              </Button>
              <Button
                testID="copy-private-key"
                accessibilityLabel="Copy private key"
                onPress={() => store.copyField("private_key")}
                style={smallButtonStyle()}
              >
                <Text
                  style={{
                    color: palette().popups.selectedText,
                    fontSize: 11,
                    fontWeight: "bold",
                  }}
                >
                  Copy
                </Text>
              </Button>
            </View>
            <ActionButton
              label="Export to ~/.ssh"
              testID="export-ssh-key"
              onPress={() => store.openSshKey("export")}
            />
          </Panel>
        ) : null}

        {item().notes ? (
          <Panel testID="inspector-notes">
            <SectionTitle>Secure Note</SectionTitle>
            <Text selectable style={{ color: palette().popups.text, fontSize: 13, lineHeight: 19 }}>
              {item().notes}
            </Text>
            <ActionButton
              label="Copy Note"
              testID="copy-notes"
              onPress={() => store.copyField("notes")}
            />
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
                      <Button
                        testID={`reveal-field-${field().index}`}
                        onPress={() => store.toggleRevealField(field().index)}
                        style={smallButtonStyle()}
                      >
                        <Text style={{ color: palette().popups.selectedText, fontSize: 11 }}>
                          {store.reveal().revealFields.includes(field().index)
                            ? "Hide"
                            : "Reveal"}
                        </Text>
                      </Button>
                    ) : null}
                    <Button
                      testID={`copy-field-${field().index}`}
                      onPress={() => store.copyField("custom", field().index)}
                      style={smallButtonStyle()}
                    >
                      <Text style={{ color: palette().popups.selectedText, fontSize: 11 }}>
                        Copy
                      </Text>
                    </Button>
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
                  <Button
                    testID={`preview-attachment-${file().id}`}
                    onPress={() => store.openAttachment(item().id, file().id, "preview")}
                    style={smallButtonStyle()}
                  >
                    <Text style={{ color: palette().popups.selectedText, fontSize: 11 }}>
                      Preview
                    </Text>
                  </Button>
                  <Button
                    testID={`download-attachment-${file().id}`}
                    onPress={() => store.openAttachment(item().id, file().id, "download")}
                    style={smallButtonStyle()}
                  >
                    <Text style={{ color: palette().popups.selectedText, fontSize: 11 }}>
                      Download
                    </Text>
                  </Button>
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
                  <Button
                    testID="close-attachment-preview"
                    onPress={store.closeAttachmentPreview}
                    style={{ paddingVertical: 1 }}
                  >
                    <Text style={{ color: palette().muted, fontSize: 11 }}>Close</Text>
                  </Button>
                </View>
                {attachment()?.isImage ? (
                  <Text style={{ color: palette().muted, fontSize: 11 }}>
                    Image preview ready at {attachment()?.path}
                  </Text>
                ) : (
                  <Text selectable style={{ color: palette().popups.text, fontSize: 12 }}>
                    {attachment()?.text}
                  </Text>
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

function smallButtonStyle() {
  const palette = store.palette();
  return {
    borderColor: palette.popups.border,
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 7,
    paddingVertical: 3,
  };
}
