import type { JSX } from "nsh";
import { Image, Scroll, Text, View } from "nsh";
import { Progress } from "nsh/base";
import type { InspectorView, ItemCategory } from "omawarden-app/native";
import * as store from "../store/appStore";
import { formatMaskedCardNumber, formatRevealedCardNumber } from "../store/CardFormatter";
import { isAppScheme } from "../store/IconPolicy";
import { inspectorIcon, markInspectorIconFailed } from "../store/Icons";
import { scaleLength } from "../theme/layout";
import { tint } from "../theme/palette";
import { noteLineHeight } from "../theme/typeScale";
import { ActionButton } from "./ui";
import { GhostIconButton } from "./GhostIconButton";
import { EmptyInspector } from "./EmptyInspector";
import { Icon, type IconName } from "./Icon";

export function ItemInspector() {
  return (
    <If when={store.inspector()} else={<EmptyInspector />}>
      {(item) => <InspectorBody item={item} />}
    </If>
  );
}

/** One icon action on a field: what the plugin's `GhostIconButton` does. */
interface FieldAction {
  icon: IconName;
  label: string;
  testID?: string;
  onPress: () => void;
}

/** One row of a section: its label above its value, its actions to the right. */
interface FieldSpec {
  label: string;
  value: string;
  testID?: string;
  mono?: boolean;
  wrap?: boolean;
  actions?: FieldAction[];
}

/** A field that draws no row when it has no value, as the plugin's `visible` does. */
function optional(spec: FieldSpec): FieldSpec | null {
  return spec.value === "" ? null : spec;
}

/** The fields that have a value, in order. */
function fields(specs: (FieldSpec | null)[]): FieldSpec[] {
  const kept: FieldSpec[] = [];
  for (const spec of specs) {
    if (spec) {
      kept.push(spec);
    }
  }
  return kept;
}

/** One card of the inspector: the plugin's 6pt frame with 10pt of padding. */
function Section(props: { testID?: string; children?: JSX.Element }) {
  const palette = store.palette;
  return (
    <View
      testID={props.testID}
      style={{
        backgroundColor: palette().popups.background,
        borderColor: palette().popups.border,
        borderWidth: 1,
        borderRadius: 6,
        padding: 10,
        gap: 8,
      }}
    >
      {props.children}
    </View>
  );
}

/** The 1pt rule the plugin draws between two fields of a section. */
function Rule() {
  const palette = store.palette;
  return <View style={{ height: 1, backgroundColor: palette().popups.border }} />;
}

/** A section's small muted caption, where the plugin puts one. */
function SectionLabel(props: { children?: JSX.Element }) {
  const palette = store.palette;
  return (
    <Text style={{ color: palette().muted, fontSize: store.type().xs }}>{props.children}</Text>
  );
}

/**
 * The label-over-value row the plugin uses for every field: the label in the
 * caption step above a medium-weight value, with the field's icon actions on
 * the right. The rule above the row is part of the row, so an absent field
 * takes its rule with it.
 */
function Field(props: { spec: () => FieldSpec; first: () => boolean }) {
  const palette = store.palette;
  // The body runs once, so every read of `spec()` happens in a binding that
  // re-runs when the spec list is rebuilt: revealing a secret or ticking the
  // TOTP replaces the array, and the row follows.
  return (
    <View style={{ gap: 8 }}>
      <If when={!props.first()}>
        <Rule />
      </If>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Text style={{ color: palette().muted, fontSize: store.type().xs, numberOfLines: 1 }}>
            {props.spec().label}
          </Text>
          <Text
            testID={props.spec().testID}
            style={{
              userSelect: "text",
              color: palette().popups.text,
              fontSize: store.type().base,
              fontWeight: 500,
              fontFamily: props.spec().mono ? "monospace" : undefined,
              numberOfLines: props.spec().wrap ? undefined : 1,
            }}
          >
            {props.spec().value}
          </Text>
        </View>
        <If when={(props.spec().actions ?? []).length > 0}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Each of={props.spec().actions ?? []} key="index">
              {(action) => (
                <GhostIconButton
                  testID={action().testID}
                  label={action().label}
                  icon={action().icon}
                  onPress={action().onPress}
                />
              )}
            </Each>
          </View>
        </If>
      </View>
    </View>
  );
}

/** A section's fields, each after the first drawn under its own rule. */
function FieldList(props: { fields: () => FieldSpec[] }) {
  return (
    <Each of={props.fields()} key="index">
      {(field, index) => <Field spec={field} first={() => index() === 0} />}
    </Each>
  );
}

/**
 * A badge of the header: the plugin's 3pt rectangle, not a pill. A colored
 * badge tints its own hue; the favorite badge is the plugin's monochrome one,
 * a wash of the foreground with muted text.
 */
function Badge(props: { label: string; color?: string; icon?: IconName; neutral?: boolean }) {
  const palette = store.palette;
  const wash = () => (props.neutral ? palette().popups.text : (props.color ?? palette().muted));
  const base = () => (props.neutral ? palette().menu.background : palette().popups.background);
  const ink = () => (props.neutral ? palette().muted : (props.color ?? palette().muted));
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        backgroundColor: tint(wash(), base(), props.neutral ? 0.08 : 0.2),
        borderColor: props.neutral ? palette().popups.border : tint(wash(), base(), 0.5),
        borderWidth: 1,
        borderRadius: 3,
        paddingHorizontal: 4,
        paddingVertical: 1,
      }}
    >
      {props.icon ? <Icon name={props.icon} size={8} color={ink()} /> : null}
      <Text
        style={{
          color: ink(),
          fontSize: store.type().xs,
          fontWeight: 500,
          numberOfLines: 1,
        }}
      >
        {props.label}
      </Text>
    </View>
  );
}

/**
 * The item's identity: its favicon or category glyph, its name with the
 * favorite/organization/folder badges, and its category underneath. The plugin
 * keeps this inside the scroll body rather than in a header bar of its own.
 */
function InspectorHeader(props: { item: () => InspectorView }) {
  const palette = store.palette;
  const iconUrl = () => inspectorIcon(props.item);
  const box = () => scaleLength(24, store.totalScale());
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
      <View style={{ width: box(), height: box(), alignItems: "center", justifyContent: "center" }}>
        <If when={iconUrl() !== ""}>
          <Image
            testID="inspector-icon"
            src={iconUrl()}
            style={{ width: box(), height: box(), borderRadius: 3, objectFit: "contain" }}
            onError={() => markInspectorIconFailed(props.item)}
          />
        </If>
        <If when={iconUrl() === ""}>
          <Icon name={categoryIcon(props.item().category)} size={14} color={palette().muted} />
        </If>
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 }}>
          <Text
            style={{
              color: palette().popups.text,
              fontSize: store.type().base,
              fontWeight: 600,
              // NSH's flexShrink defaults to 0: without this a long name pushes
              // the badges past the pane instead of shrinking into an ellipsis.
              flexShrink: 1,
              numberOfLines: 1,
            }}
          >
            {props.item().title || "Untitled"}
          </Text>
          <If when={props.item().favorite}>
            <Badge label="Favorite" icon="star" neutral />
          </If>
          <If when={props.item().metadata.organization !== ""}>
            <Badge
              label={props.item().metadata.organization}
              color={palette().warning}
              icon="building"
            />
          </If>
          <If when={props.item().metadata.folder !== ""}>
            <Badge label={props.item().metadata.folder} color={palette().info} icon="folder" />
          </If>
        </View>
        <Text style={{ color: palette().muted, fontSize: store.type().sm, numberOfLines: 1 }}>
          {categoryLabel(props.item().category)}
        </Text>
      </View>
    </View>
  );
}

function InspectorBody(props: { item: () => InspectorView }) {
  const palette = store.palette;
  const item = props.item;
  const attachment = store.attachmentPreview;
  const reprompt = () => item().reprompt === 1 && store.repromptRequired();
  const totpDanger = () => Boolean(item().totp?.valid) && (item().totp?.remaining ?? 0) <= 5;
  const totpColor = () => (totpDanger() ? palette().danger : palette().popups.selectedText);

  // Each list is a function rather than a value: `FieldList` calls it inside
  // its `Each` binding, which is the only place a read of `store.reveal()` or
  // `item()` is tracked and re-run.
  const loginRows = () => loginFields(item);
  const cardRows = () => cardFields(item, reprompt);
  const identityRows = () => identityFields(item);
  const sshRows = () => sshFields(item);

  return (
    <View testID="item-inspector" style={{ flex: 1, overflow: "hidden" }}>
      <Scroll style={{ flex: 1 }} contentStyle={{ padding: 12 }}>
        {/* The pane draws no card of its own: as in the plugin, the sections are
            the cards, and a capped content column would leave a wide pane half
            empty. */}
        <View style={{ gap: 12 }}>
          <InspectorHeader item={item} />

          {reprompt() ? (
            <View
              testID="inspector-reprompt"
              style={{
                backgroundColor: tint(palette().warning, palette().popups.background, 0.16),
                borderColor: palette().warning,
                borderWidth: 1,
                borderRadius: 6,
                padding: 10,
                gap: 8,
              }}
            >
              <Text
                style={{
                  color: palette().popups.text,
                  fontSize: store.type().base,
                  fontWeight: 500,
                }}
              >
                Master password required
              </Text>
              <Text style={{ color: palette().muted, fontSize: store.type().xs }}>
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
            <Section testID="inspector-login">
              <FieldList fields={loginRows} />

              {item().totp ? (
                <View testID="inspector-totp" style={{ gap: 8 }}>
                  <Rule />
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ color: palette().muted, fontSize: store.type().xs }}>
                          TOTP Code
                        </Text>
                        <Text
                          testID="inspector-totp-remaining"
                          style={{
                            color: totpDanger() ? palette().danger : palette().muted,
                            fontSize: store.type().xs,
                            fontWeight: totpDanger() ? "bold" : "normal",
                          }}
                        >
                          {item().totp?.valid ? `${item().totp?.remaining}s` : "Unavailable"}
                        </Text>
                      </View>
                      <Text
                        testID="inspector-totp-code"
                        style={{
                          userSelect: reprompt() ? "none" : "text",
                          color: reprompt() ? palette().muted : totpColor(),
                          fontSize: store.type().lg,
                          fontWeight: "bold",
                          fontFamily: "monospace",
                        }}
                      >
                        {reprompt()
                          ? "••• •••"
                          : item().totp?.valid
                            ? item().totp?.formatted
                            : item().totp?.error ?? "—"}
                      </Text>
                    </View>
                    <GhostIconButton
                      testID="refresh-totp"
                      label="Refresh TOTP"
                      icon="refresh-cw"
                      onPress={store.refreshTotp}
                    />
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
            </Section>
          ) : null}

          {item().category === "card" && item().card ? (
            <Section testID="inspector-card">
              <FieldList fields={cardRows} />
            </Section>
          ) : null}

          {item().category === "identity" && item().identity ? (
            <Section testID="inspector-identity">
              <FieldList fields={identityRows} />
            </Section>
          ) : null}

          {item().category === "sshKey" && item().ssh ? (
            <Section testID="inspector-ssh">
              <FieldList fields={sshRows} />
            </Section>
          ) : null}

          {item().notes ? (
            <Section testID="inspector-notes">
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ flex: 1, minWidth: 0 }}>
                  <SectionLabel>Notes</SectionLabel>
                </View>
                <GhostIconButton
                  testID="copy-notes"
                  label="Copy secure note"
                  icon="copy"
                  onPress={() => store.copyField("notes")}
                />
              </View>
              <Rule />
              <Text
                style={{
                  color: palette().popups.text,
                  fontSize: store.type().md,
                  lineHeight: noteLineHeight(store.type()),
                  userSelect: "text",
                }}
              >
                {item().notes}
              </Text>
            </Section>
          ) : null}

          {item().fields.length > 0 ? (
            <Section testID="inspector-fields">
              <SectionLabel>Custom Fields</SectionLabel>
              <Each of={item().fields} key="index">
                {(field) => (
                  <View style={{ gap: 8 }}>
                    <Rule />
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                        <Text
                          style={{
                            color: palette().muted,
                            fontSize: store.type().xs,
                            numberOfLines: 1,
                          }}
                        >
                          {field().name || `Field ${field().index + 1}`}
                        </Text>
                        <Text
                          testID={`field-value-${field().index}`}
                          style={{
                            userSelect: "text",
                            color: palette().popups.text,
                            fontSize: store.type().base,
                            fontWeight: 500,
                            fontFamily:
                              field().kind === "hidden" &&
                              !store.reveal().revealFields.includes(field().index)
                                ? "monospace"
                                : undefined,
                            numberOfLines: 1,
                          }}
                        >
                          {field().kind === "hidden" &&
                          !store.reveal().revealFields.includes(field().index)
                            ? field().valueMasked
                            : field().value}
                        </Text>
                      </View>
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
                  </View>
                )}
              </Each>
            </Section>
          ) : null}

          {item().attachments.length > 0 ? (
            <Section testID="inspector-attachments">
              <SectionLabel>Attachments ({item().attachments.length})</SectionLabel>
              <Each of={item().attachments} key="index">
                {(file) => (
                  <View style={{ gap: 8 }}>
                    <Rule />
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
                        <Text
                          style={{
                            color: palette().popups.text,
                            fontSize: store.type().sm,
                            fontWeight: 500,
                            numberOfLines: 1,
                          }}
                        >
                          {file().filename}
                        </Text>
                        <Text style={{ color: palette().muted, fontSize: store.type().xs }}>
                          {file().sizeLabel}
                        </Text>
                      </View>
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
                  </View>
                )}
              </Each>
              {attachment() ? (
                <View
                  testID="attachment-preview"
                  style={{
                    backgroundColor: tint(palette().info, palette().popups.background, 0.12),
                    borderRadius: 6,
                    padding: 8,
                    gap: 6,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text
                      style={{
                        color: palette().popups.text,
                        fontSize: store.type().sm,
                        fontWeight: 500,
                        flex: 1,
                        numberOfLines: 1,
                      }}
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
                          <Text style={{ color: palette().muted, fontSize: store.type().xs }}>
                            This image is too large to preview here. Open it with the system viewer.
                          </Text>
                        }
                      >
                        <Image
                          testID="attachment-image"
                          src={attachment()?.dataUrl ?? ""}
                          style={{
                            width: "100%",
                            maxHeight: 320,
                            minHeight: 120,
                            borderRadius: 6,
                            objectFit: "contain",
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
                          style={{
                            userSelect: "text",
                            color: palette().popups.text,
                            fontSize: store.type().base,
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
            </Section>
          ) : null}

          {item().metadata.createdAt ||
          item().metadata.updatedAt ||
          item().passwordHistory.length > 0 ? (
            <Section>
              <SectionLabel>Item history</SectionLabel>
              {item().metadata.createdAt ? (
                <View style={{ gap: 8 }}>
                  <Rule />
                  <View style={{ gap: 2 }}>
                    <Text style={{ color: palette().muted, fontSize: store.type().xs }}>
                      Created
                    </Text>
                    <Text
                      style={{
                        color: palette().popups.text,
                        fontSize: store.type().base,
                        fontWeight: 500,
                        numberOfLines: 1,
                      }}
                    >
                      {item().metadata.createdAt}
                    </Text>
                  </View>
                </View>
              ) : null}
              {item().metadata.updatedAt ? (
                <View style={{ gap: 8 }}>
                  <Rule />
                  <View style={{ gap: 2 }}>
                    <Text style={{ color: palette().muted, fontSize: store.type().xs }}>
                      Updated
                    </Text>
                    <Text
                      style={{
                        color: palette().popups.text,
                        fontSize: store.type().base,
                        fontWeight: 500,
                        numberOfLines: 1,
                      }}
                    >
                      {item().metadata.updatedAt}
                    </Text>
                  </View>
                </View>
              ) : null}
              {item().passwordHistory.length > 0 ? (
                <View style={{ gap: 8 }}>
                  <Rule />
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
                      <Text style={{ color: palette().muted, fontSize: store.type().xs }}>
                        Password History
                      </Text>
                      <Text
                        style={{
                          color: palette().popups.text,
                          fontSize: store.type().base,
                          fontWeight: 500,
                          numberOfLines: 1,
                        }}
                      >
                        {item().passwordHistory.length} previous password
                        {item().passwordHistory.length === 1 ? "" : "s"}
                      </Text>
                    </View>
                    <GhostIconButton
                      testID="open-password-history"
                      label="View password history"
                      icon="history"
                      onPress={store.openPasswordHistory}
                    />
                  </View>
                </View>
              ) : null}
            </Section>
          ) : null}

          {item().error ? (
            <Text style={{ color: palette().danger, fontSize: store.type().base }}>{item().error}</Text>
          ) : null}
        </View>
      </Scroll>
    </View>
  );
}

/** The login section's fields: username, password, then one row per website. */
function loginFields(item: () => InspectorView): FieldSpec[] {
  const specs: (FieldSpec | null)[] = [
    optional({
      label: "Username",
      value: item().username ?? "",
      actions: [
        {
          icon: "copy",
          label: "Copy username",
          testID: "copy-username",
          onPress: () => store.copyField("username"),
        },
      ],
    }),
    optional({
      label: "Password",
      value: item().password ?? item().passwordMasked,
      testID: "inspector-password",
      mono: store.reveal().revealPassword,
      actions: [
        {
          icon: store.reveal().revealPassword ? "eye-off" : "eye",
          label: store.reveal().revealPassword ? "Hide password" : "Show password",
          testID: "reveal-password",
          onPress: () => store.toggleReveal("password"),
        },
        {
          icon: "copy",
          label: "Copy password",
          testID: "copy-password",
          onPress: () => store.copyField("password"),
        },
      ],
    }),
  ];
  for (const uri of item().uris) {
    specs.push({
      label: isAppScheme(uri.uri) ? "App Scheme" : "Website",
      value: uri.host || uri.uri,
      actions: [
        {
          icon: "copy",
          label: "Copy website URL",
          testID: `copy-uri-${uri.host}`,
          onPress: () => store.copyText(uri.uri, "website URL", false),
        },
        {
          icon: "external-link",
          label: "Open website",
          testID: `launch-uri-${uri.host}`,
          onPress: () => store.openUrl(uri.uri),
        },
      ],
    });
  }
  return fields(specs);
}

/** The card section's fields. */
function cardFields(item: () => InspectorView, reprompt: () => boolean): FieldSpec[] {
  const card = item().card;
  if (!card) {
    return [];
  }
  return fields([
    optional({ label: "Cardholder", value: card.cardholderName }),
    optional({ label: "Brand", value: card.brand }),
    optional({
      label: "Card Number",
      value:
        store.reveal().revealCardNumber && !reprompt()
          ? formatRevealedCardNumber(card.number, card.brand)
          : formatMaskedCardNumber(card.numberMasked ?? card.number, card.brand),
      testID: "inspector-card-number",
      mono: true,
      actions: [
        {
          icon: store.reveal().revealCardNumber ? "eye-off" : "eye",
          label: store.reveal().revealCardNumber ? "Hide card number" : "Show card number",
          testID: "reveal-card-number",
          onPress: () => store.toggleReveal("cardNumber"),
        },
        {
          icon: "copy",
          label: "Copy card number",
          testID: "copy-card-number",
          onPress: () => store.copyField("card_number"),
        },
      ],
    }),
    optional({
      label: "Expiration",
      value: card.expiration,
      mono: true,
      actions: [
        {
          icon: "copy",
          label: "Copy expiration",
          testID: "copy-expiration",
          onPress: () => store.copyText(card.expiration, "expiration", false),
        },
      ],
    }),
    optional({
      label: "Security Code",
      value: card.cvv || card.cvvMasked,
      testID: "inspector-cvv",
      mono: true,
      actions: [
        {
          icon: store.reveal().revealCvv ? "eye-off" : "eye",
          label: store.reveal().revealCvv ? "Hide security code" : "Show security code",
          testID: "reveal-cvv",
          onPress: () => store.toggleReveal("cvv"),
        },
        {
          icon: "copy",
          label: "Copy security code",
          testID: "copy-cvv",
          onPress: () => store.copyField("cvv"),
        },
      ],
    }),
  ]);
}

/** The identity section's fields. */
function identityFields(item: () => InspectorView): FieldSpec[] {
  const identity = item().identity;
  if (!identity) {
    return [];
  }
  return fields([
    optional({
      label: "Full Name",
      value: identity.fullName,
      actions: [
        {
          icon: "copy",
          label: "Copy full name",
          testID: "copy-full-name",
          onPress: () => store.copyText(identity.fullName, "full name", false),
        },
      ],
    }),
    optional({
      label: "Username",
      value: identity.username,
      actions: [
        {
          icon: "copy",
          label: "Copy username",
          testID: "copy-identity-username",
          onPress: () => store.copyText(identity.username, "username", false),
        },
      ],
    }),
    optional({
      label: "Company",
      value: identity.company,
      actions: [
        {
          icon: "copy",
          label: "Copy company",
          testID: "copy-company",
          onPress: () => store.copyText(identity.company, "company", false),
        },
      ],
    }),
    optional({
      label: "Email",
      value: identity.email,
      actions: [
        {
          icon: "copy",
          label: "Copy email",
          testID: "copy-identity-email",
          onPress: () => store.copyText(identity.email, "email", false),
        },
      ],
    }),
    optional({
      label: "Phone",
      value: identity.phone,
      actions: [
        {
          icon: "copy",
          label: "Copy phone",
          testID: "copy-phone",
          onPress: () => store.copyText(identity.phone, "phone", false),
        },
      ],
    }),
    optional({
      label: "SSN",
      value: identity.ssn,
      actions: [
        {
          icon: "copy",
          label: "Copy SSN",
          testID: "copy-ssn",
          onPress: () => store.copyText(identity.ssn, "SSN", true),
        },
      ],
    }),
    optional({
      label: "Passport",
      value: identity.passportNumber,
      actions: [
        {
          icon: "copy",
          label: "Copy passport",
          testID: "copy-passport",
          onPress: () => store.copyText(identity.passportNumber, "passport", true),
        },
      ],
    }),
    optional({
      label: "License",
      value: identity.licenseNumber,
      actions: [
        {
          icon: "copy",
          label: "Copy license",
          testID: "copy-license",
          onPress: () => store.copyText(identity.licenseNumber, "license", true),
        },
      ],
    }),
    optional({
      label: "Address",
      value: [identity.address1, identity.address2, identity.address3]
        .filter(Boolean)
        .join(", "),
    }),
    optional({ label: "City", value: identity.city }),
    optional({ label: "State", value: identity.state }),
    optional({ label: "Postal Code", value: identity.postalCode }),
    optional({ label: "Country", value: identity.country }),
  ]);
}

/** The SSH key section's fields. */
function sshFields(item: () => InspectorView): FieldSpec[] {
  const ssh = item().ssh;
  if (!ssh) {
    return [];
  }
  return fields([
    optional({ label: "Key Type", value: ssh.keyType }),
    optional({
      label: "Private Key",
      value: ssh.privateKey,
      testID: "inspector-private-key",
      mono: true,
      wrap: true,
      actions: [
        {
          icon: store.reveal().revealPrivateKey ? "eye-off" : "eye",
          label: store.reveal().revealPrivateKey ? "Hide private key" : "Show private key",
          testID: "reveal-private-key",
          onPress: () => store.toggleReveal("privateKey"),
        },
        {
          icon: "copy",
          label: "Copy private key",
          testID: "copy-private-key",
          onPress: () => store.copyField("private_key"),
        },
        {
          icon: "upload",
          label: "Export SSH key to ~/.ssh",
          testID: "export-ssh-key",
          onPress: () => store.openSshKey("export"),
        },
      ],
    }),
    optional({
      label: "Public Key",
      value: ssh.publicKey,
      mono: true,
      wrap: true,
      actions: [
        {
          icon: "copy",
          label: "Copy public key",
          testID: "copy-public-key",
          onPress: () => store.copyText(ssh.publicKey, "public key", false),
        },
      ],
    }),
    optional({
      label: "Fingerprint",
      value: ssh.fingerprint,
      mono: true,
      wrap: true,
      actions: [
        {
          icon: "copy",
          label: "Copy fingerprint",
          testID: "copy-fingerprint",
          onPress: () => store.copyText(ssh.fingerprint, "fingerprint", false),
        },
      ],
    }),
  ]);
}

function categoryIcon(category: ItemCategory): IconName {
  switch (category) {
    case "login":
      return "key";
    case "card":
      return "credit-card";
    case "identity":
      return "user";
    case "secureNote":
      return "file-text";
    case "sshKey":
      return "terminal";
    default:
      return "circle";
  }
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
