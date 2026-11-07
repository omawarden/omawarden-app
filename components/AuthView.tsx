import { Text, View } from "nsh";
import { Button, Checkbox, Input, OtpInput } from "nsh/base";
import * as store from "../store/appStore";
import {
  clientId,
  clientSecret,
  confirmLogout,
  email,
  loginTab,
  mtlsCertPath,
  mtlsEnabled,
  mtlsKeyPath,
  newDeviceOtp,
  password,
  pendingPassword,
  rememberEmail,
  serverPanelOpen,
  serverUrlDraft,
  twoFactorCode,
  unlockPassword,
} from "../store/authForm";
import { isOfficialServer } from "../store/IconPolicy";
import { tint, textOnTint } from "../theme/palette";
import { actionID, ActionButton, focusOutline, SmallButton, useAction } from "./ui";
import { Icon, type IconName } from "./Icon";

export type AuthMode = "login" | "twoFactor" | "locked";

const OFFICIAL_SERVER = "https://vault.bitwarden.com";

/**
 * The three ways into the vault share one column and one header shape, as the
 * plugin's do: an accent glyph, the action's name, and the account or server
 * the action applies to.
 */
export function AuthView(props: { mode: AuthMode }) {
  const palette = store.palette;
  const snap = store.snapshot;

  const glyph = (): IconName =>
    props.mode === "login" ? "key" : props.mode === "twoFactor" ? "shield" : "lock";
  const title = () =>
    props.mode === "login"
      ? "Log In to Bitwarden"
      : props.mode === "twoFactor"
        ? "Two-Factor Verification"
        : "Vault is Locked";

  return (
    <View
      testID={`auth-view-${props.mode}`}
      style={{
        flex: 1,
        backgroundColor: palette().menu.background,
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <View style={{ width: "100%", maxWidth: 360, gap: 14 }}>
        <View style={{ alignItems: "center", gap: 4 }}>
          <Icon name={glyph()} size={28} color={palette().menu.selectedText} />
          <Text
            style={{
              color: palette().menu.text,
              fontSize: store.type()["5xl"],
              fontWeight: "bold",
              textAlign: "center",
            }}
          >
            {title()}
          </Text>
          {props.mode === "login" ? (
            <LoginServerRow />
          ) : (
            <Text style={{ color: palette().muted, fontSize: store.type().sm, textAlign: "center" }}>
              {props.mode === "locked" ? "Logged in as " : ""}
              {snap().email || "your account"}
            </Text>
          )}
        </View>

        {snap().error ? (
          <View
            style={{
              backgroundColor: tint(palette().danger, palette().menu.background, 0.18),
              borderColor: palette().danger,
              borderWidth: 1,
              borderRadius: 8,
              padding: 10,
            }}
          >
            <Text
              style={{
                color: textOnTint(palette().danger, palette().menu.background, 0.18),
                fontSize: store.type().base,
              }}
            >
              {snap().error}
            </Text>
          </View>
        ) : null}

        {props.mode === "login" ? <LoginForm /> : null}
        {props.mode === "twoFactor" ? <TwoFactorForm /> : null}
        {props.mode === "locked" ? <UnlockForm /> : null}
      </View>
    </View>
  );
}

/** The server the login will talk to, with the chip that opens its panel. */
function LoginServerRow() {
  const palette = store.palette;
  const snap = store.snapshot;
  const shown = () =>
    store.settings()?.config.serverUrl || snap().serverUrl || OFFICIAL_SERVER;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        flexWrap: "wrap",
      }}
    >
      <Text
        style={{
          color: palette().muted,
          fontSize: store.type().sm,
          userSelect: "text",
        }}
      >
        {shown()}
      </Text>
      <SmallButton testID="login-server-chip" paddingVertical={1} onPress={toggleServerPanel}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <Icon
            name={serverPanelOpen() ? "x" : "settings"}
            size={10}
            color={palette().menu.selectedText}
          />
          <Text style={{ color: palette().menu.selectedText, fontSize: store.type().sm }}>
            {serverPanelOpen() ? "Close" : "Server"}
          </Text>
        </View>
      </SmallButton>
    </View>
  );
}

/** Opens the panel on the stored configuration, so it edits what is in use. */
function toggleServerPanel(): void {
  if (serverPanelOpen()) {
    serverPanelOpen.set(false);
    return;
  }
  const config = store.loadServerConfig();
  serverUrlDraft.set(config.serverUrl || OFFICIAL_SERVER);
  mtlsCertPath.set(config.clientCertPath);
  mtlsKeyPath.set(config.clientKeyPath);
  mtlsEnabled.set(Boolean(config.clientCertPath));
  serverPanelOpen.set(true);
}

/** The plugin's inline server and mTLS configuration, above the login methods. */
function ServerPanel() {
  const palette = store.palette;
  const official = () => isOfficialServer(serverUrlDraft());

  const save = () => {
    const url = serverUrlDraft().trim() || OFFICIAL_SERVER;
    const useMtls = !isOfficialServer(url) && mtlsEnabled();
    store.saveServerConfig(
      url,
      useMtls ? mtlsCertPath().trim() : "",
      useMtls ? mtlsKeyPath().trim() : "",
    );
    serverUrlDraft.set(url);
    serverPanelOpen.set(false);
  };

  const reset = () => {
    serverUrlDraft.set(OFFICIAL_SERVER);
    mtlsEnabled.set(false);
    mtlsCertPath.set("");
    mtlsKeyPath.set("");
    store.saveServerConfig(OFFICIAL_SERVER, "", "");
    serverPanelOpen.set(false);
  };

  return (
    <View
      testID="login-server-panel"
      style={{
        backgroundColor: tint(palette().menu.text, palette().menu.background, 0.06),
        borderColor: palette().popups.border,
        borderWidth: 1,
        borderRadius: 8,
        padding: 10,
        gap: 8,
      }}
    >
      <Text
        style={{
          color: palette().menu.selectedText,
          fontSize: store.type().sm,
          fontWeight: "bold",
        }}
      >
        SERVER & mTLS CLIENT CERTIFICATE
      </Text>

      <Text style={{ color: palette().popups.text, fontSize: store.type().sm }}>Server URL:</Text>
      <Input
        testID="login-server-url"
        value={serverUrlDraft()}
        placeholder={OFFICIAL_SERVER}
        autoCapitalize="none"
        autoCorrect={false}
        onChange={({ value }) => serverUrlDraft.set(value)}
        style={inputStyle()}
      />

      {official() ? (
        <Text style={{ color: palette().muted, fontSize: store.type().xs }}>
          Official Bitwarden cloud uses standard HTTPS and does not require client certificates.
        </Text>
      ) : (
        <Checkbox
          testID="login-mtls-toggle"
          checked={mtlsEnabled()}
          onChange={({ checked }) => mtlsEnabled.set(checked)}
          indicator={
            <Icon
              name="check"
              size={11}
              color={mtlsEnabled() ? palette().menu.selectedText : "transparent"}
            />
          }
        >
          <Text style={{ color: palette().popups.text, fontSize: store.type().sm }}>
            Use mTLS Client Certificate (for edge gateways)
          </Text>
        </Checkbox>
      )}

      {!official() && mtlsEnabled() ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: palette().popups.text, fontSize: store.type().sm }}>
            Client Certificate Path (.pem / .crt):
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Input
              testID="login-mtls-cert"
              value={mtlsCertPath()}
              placeholder="~/.config/omawarden/client.crt"
              autoCapitalize="none"
              autoCorrect={false}
              onChange={({ value }) => mtlsCertPath.set(value)}
              style={{ ...inputStyle(), flex: 1 }}
            />
            <ActionButton
              label="Browse…"
              testID="login-mtls-cert-browse"
              onPress={() => {
                const path = store.pickFile("Select Client Certificate", "Certificate files", [
                  "crt",
                  "pem",
                ]);
                if (path) {
                  mtlsCertPath.set(path);
                  mtlsEnabled.set(true);
                }
              }}
            />
          </View>

          <Text style={{ color: palette().popups.text, fontSize: store.type().sm }}>
            Client Private Key Path (optional if merged):
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Input
              testID="login-mtls-key"
              value={mtlsKeyPath()}
              placeholder="~/.config/omawarden/client.key"
              autoCapitalize="none"
              autoCorrect={false}
              onChange={({ value }) => mtlsKeyPath.set(value)}
              style={{ ...inputStyle(), flex: 1 }}
            />
            <ActionButton
              label="Browse…"
              testID="login-mtls-key-browse"
              onPress={() => {
                const path = store.pickFile("Select Client Private Key", "Key files", [
                  "key",
                  "pem",
                ]);
                if (path) {
                  mtlsKeyPath.set(path);
                  mtlsEnabled.set(true);
                }
              }}
            />
          </View>

          <Text style={{ color: palette().muted, fontSize: store.type().xs }}>
            Private key files must be restricted to 0600 or 0400 file permissions.
          </Text>
        </View>
      ) : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <SmallButton
          testID="login-server-save"
          label="Save & Apply"
          paddingVertical={4}
          onPress={save}
        />
        <SmallButton
          testID="login-server-reset"
          label="Reset to Official"
          paddingVertical={4}
          onPress={reset}
        />
      </View>
    </View>
  );
}

function LoginForm() {
  const palette = store.palette;
  const submitting = store.isSubmitting;

  return (
    <View style={{ gap: 10 }}>
      {serverPanelOpen() ? <ServerPanel /> : null}

      <View style={{ flexDirection: "row", justifyContent: "center", gap: 6 }}>
        <TabButton
          label="Master Password"
          active={loginTab() === "password"}
          disabled={submitting()}
          onPress={() => loginTab.set("password")}
          testID="login-tab-password"
        />
        <TabButton
          label="API Key"
          active={loginTab() === "apiKey"}
          disabled={submitting()}
          onPress={() => loginTab.set("apiKey")}
          testID="login-tab-api"
        />
      </View>

      {loginTab() === "password" ? (
        <View style={{ gap: 8 }}>
          <Text style={{ color: palette().popups.text, fontSize: store.type().sm }}>Email:</Text>
          <Input
            testID="login-email"
            value={email()}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            readonly={submitting()}
            submitBehavior="submit"
            onChange={({ value }) => email.set(value)}
            style={inputStyle()}
          />
          <Text style={{ color: palette().popups.text, fontSize: store.type().sm }}>
            Master Password:
          </Text>
          <Input
            testID="login-password"
            value={password()}
            placeholder="Master password"
            masked
            autoCapitalize="none"
            autoCorrect={false}
            readonly={submitting()}
            submitBehavior="submit"
            onChange={({ value }) => password.set(value)}
            onSubmit={() => submitLogin()}
            style={inputStyle()}
          />
          <Checkbox
            testID="login-remember-email"
            checked={rememberEmail()}
            disabled={submitting()}
            onChange={({ checked }) => rememberEmail.set(checked)}
            indicator={
              <Icon
                name="check"
                size={11}
                color={rememberEmail() ? palette().menu.selectedText : "transparent"}
              />
            }
          >
            <Text style={{ color: palette().popups.text, fontSize: store.type().base }}>
              Remember email
            </Text>
          </Checkbox>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Text style={{ color: palette().popups.text, fontSize: store.type().sm }}>Client ID:</Text>
          <Input
            testID="login-client-id"
            value={clientId()}
            placeholder="user.client-id"
            autoCapitalize="none"
            autoCorrect={false}
            readonly={submitting()}
            submitBehavior="submit"
            onChange={({ value }) => clientId.set(value)}
            style={inputStyle()}
          />
          <Text style={{ color: palette().popups.text, fontSize: store.type().sm }}>
            Client Secret:
          </Text>
          <Input
            testID="login-client-secret"
            value={clientSecret()}
            placeholder="Client secret"
            masked
            autoCapitalize="none"
            autoCorrect={false}
            readonly={submitting()}
            submitBehavior="submit"
            onChange={({ value }) => clientSecret.set(value)}
            style={inputStyle()}
          />
        </View>
      )}

      <ActionButton
        label={submitting() ? "Logging in…" : "Log In"}
        testID="login-submit"
        tone="primary"
        disabled={submitting()}
        onPress={submitLogin}
      />
    </View>
  );
}

function fido2StatusText(status: string | null | undefined): string {
  switch (status) {
    case "available":
      return "Security key ready. Touch it to continue.";
    case "no_device":
      return "No security key found. Insert your key and try again.";
    case "tool_not_found":
      return "libfido2 tools were not found. Install the libfido2 package.";
    case "other_error":
      return "The security key could not be checked. Try again.";
    default:
      return "Touch your security key to continue.";
  }
}

function submitLogin(): void {
  if (store.isSubmitting()) {
    return;
  }
  if (loginTab() === "apiKey") {
    store.authenticate({
      kind: "apiKey",
      email: email(),
      password: "",
      clientId: clientId(),
      clientSecret: clientSecret(),
      code: "",
      provider: null,
      rememberEmail: rememberEmail(),
      newDeviceOtp: null,
    });
    return;
  }
  pendingPassword.set(password());
  store.authenticate({
    kind: "password",
    email: email(),
    password: password(),
    clientId: "",
    clientSecret: "",
    code: "",
    provider: null,
    rememberEmail: rememberEmail(),
    newDeviceOtp: null,
  });
}

function TwoFactorForm() {
  const palette = store.palette;
  const snap = store.snapshot;
  const submitting = store.isSubmitting;
  const challenge = () => snap().twoFactor;
  const providers = () => challenge()?.providers ?? [];
  const provider = () => store.selectedProvider();
  const active = () =>
    providers().find((entry) => entry.id === provider()) ?? providers()[0];
  const isEmail = () => active()?.id === 1;
  const isFido2 = () => active()?.id === 7;

  const submit = () => {
    if (store.isSubmitting()) {
      return;
    }
    const kind = challenge()?.newDevice ? "newDevice" : "twoFactor";
    store.authenticate({
      kind,
      email: snap().email || email(),
      password: pendingPassword(),
      clientId: "",
      clientSecret: "",
      code: twoFactorCode(),
      provider: provider(),
      rememberEmail: rememberEmail(),
      // FIDO2 has no typed code: send none so the engine performs the
      // assertion instead of treating a blank OTP as a real code.
      newDeviceOtp: isFido2() ? null : newDeviceOtp(),
    });
  };

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: palette().muted, fontSize: store.type().base }}>
        {challenge()?.newDevice ? "New Device Verification" : "Enter a verification code"}
      </Text>

      <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
        <Each of={providers()} key="index">
          {(entry) => (
            <TabButton
              label={entry().label}
              active={entry().id === provider()}
              disabled={!entry().available}
              onPress={() => store.selectedProvider.set(entry().id)}
              testID={`twofactor-provider-${entry().id}`}
            />
          )}
        </Each>
      </View>

      {isFido2() ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: palette().muted, fontSize: store.type().base }}>
            {fido2StatusText(challenge()?.fido2Status)}
          </Text>
          <Text style={{ color: palette().muted, fontSize: store.type().sm }}>
            No verification code is needed. Your security key signs the challenge.
          </Text>
          <ActionButton
            label={submitting() ? "Checking…" : "Use Security Key"}
            testID="twofactor-retry-fido2"
            tone="primary"
            disabled={submitting()}
            onPress={submit}
          />
        </View>
      ) : challenge()?.newDevice ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: palette().popups.text, fontSize: store.type().sm }}>
            Verification code:
          </Text>
          <OtpInput
            testID="twofactor-code"
            length={6}
            value={newDeviceOtp()}
            disabled={submitting()}
            accessibilityLabel="Verification code, 6 digits"
            onChange={({ value }) => newDeviceOtp.set(value)}
            style={{ flexDirection: "row" }}
            groupStyle={{ flexDirection: "row", gap: 6 }}
            cellStyle={{
              width: store.lengths().otpCellWidth,
              height: store.lengths().otpCellHeight,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: palette().menu.border,
              borderRadius: 8,
              backgroundColor: palette().menu.background,
              color: palette().menu.text,
              fontSize: store.type()["4xl"],
            }}
          />
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          <Text style={{ color: palette().popups.text, fontSize: store.type().sm }}>
            {isEmail() ? "Email 2FA Verification Code:" : "Code:"}
          </Text>
          <OtpInput
            testID="twofactor-code"
            length={6}
            value={twoFactorCode()}
            disabled={submitting()}
            accessibilityLabel="Verification code, 6 digits"
            onChange={({ value }) => twoFactorCode.set(value)}
            style={{ flexDirection: "row" }}
            groupStyle={{ flexDirection: "row", gap: 6 }}
            cellStyle={{
              width: store.lengths().otpCellWidth,
              height: store.lengths().otpCellHeight,
              alignItems: "center",
              justifyContent: "center",
              borderWidth: 1,
              borderColor: palette().menu.border,
              borderRadius: 8,
              backgroundColor: palette().menu.background,
              color: palette().menu.text,
              fontSize: store.type()["4xl"],
            }}
          />
        </View>
      )}

      {isEmail() ? (
        <ActionButton
          label="Resend Email"
          testID="twofactor-resend"
          disabled={submitting()}
          onPress={() => store.sendTwoFactorEmail(snap().email || email(), pendingPassword())}
        />
      ) : null}

      {isFido2() ? null : (
        <ActionButton
          label={submitting() ? "Verifying…" : "Verify"}
          testID="twofactor-submit"
          tone="primary"
          disabled={submitting()}
          onPress={submit}
        />
      )}
      <ActionButton
        label="Back to Login"
        testID="twofactor-back"
        onPress={() => store.lockOrLogout(true)}
      />
    </View>
  );
}

function UnlockForm() {
  const palette = store.palette;
  const snap = store.snapshot;
  const submitting = store.isSubmitting;

  const unlock = () => {
    if (submitting()) {
      return;
    }
    store.authenticate({
      kind: "unlock",
      email: snap().email,
      password: unlockPassword(),
      clientId: "",
      clientSecret: "",
      code: "",
      provider: null,
      rememberEmail: rememberEmail(),
      newDeviceOtp: null,
    });
  };

  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: palette().popups.text, fontSize: store.type().sm }}>
        Master Password:
      </Text>
      <Input
        testID="unlock-password"
        value={unlockPassword()}
        placeholder="Master password"
        masked
        autoCapitalize="none"
        autoCorrect={false}
        readonly={submitting()}
        onChange={({ value }) => unlockPassword.set(value)}
        onSubmit={unlock}
        style={inputStyle()}
      />

      {snap().quickUnlockReady ? (
        <ActionButton
          label="Unlock with System Authentication"
          testID="quick-unlock"
          onPress={() =>
            store.authenticate({
              kind: "quickUnlock",
              email: snap().email,
              password: "",
              clientId: "",
              clientSecret: "",
              code: "",
              provider: null,
              rememberEmail: rememberEmail(),
              newDeviceOtp: null,
            })
          }
        />
      ) : null}

      <ActionButton
        label={submitting() ? "Unlocking…" : "Unlock Vault"}
        testID="unlock-submit"
        tone="primary"
        disabled={submitting()}
        onPress={unlock}
      />

      <View style={{ flexDirection: "row", justifyContent: "flex-end", gap: 8, flexWrap: "wrap" }}>
        {confirmLogout() ? (
          <>
            <ActionButton
              label="Cancel"
              testID="logout-cancel"
              onPress={() => confirmLogout.set(false)}
            />
            <ActionButton
              label="Confirm Log Out"
              testID="logout-confirm"
              tone="danger"
              onPress={() => {
                confirmLogout.set(false);
                store.lockOrLogout(true);
              }}
            />
          </>
        ) : (
          <SmallButton
            testID="logout"
            label="Log out from account"
            paddingVertical={2}
            onPress={() => confirmLogout.set(true)}
          />
        )}
      </View>
    </View>
  );
}

export function TabButton(props: {
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
  disabled?: boolean;
}) {
  const palette = store.palette;
  const id = actionID(props.testID);
  useAction(id, () => props.onPress());
  const focused = () => store.focusedAction() === id;
  const accent = () => palette().popups.selectedText;
  const background = () =>
    props.active ? palette().popups.selectedBackground : palette().popups.background;
  return (
    <Button
      testID={props.testID}
      disabled={props.disabled}
      selected={props.active}
      onPress={props.onPress}
      style={{
        backgroundColor: background(),
        borderColor: focused() ? accent() : palette().popups.border,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 5,
        ...focusOutline(focused(), accent()),
      }}
      hoverStyle={{
        backgroundColor: tint(accent(), background(), 0.14),
        borderColor: accent(),
      }}
      activeStyle={{ backgroundColor: tint(accent(), background(), 0.26) }}
      focusStyle={{ borderColor: accent() }}
      disabledStyle={{ opacity: 0.5 }}
    >
      <Text
        style={{
          color: props.active ? palette().popups.selectedText : palette().popups.text,
          fontSize: store.type().base,
          fontWeight: props.active ? "bold" : "normal",
        }}
      >
        {props.label}
      </Text>
    </Button>
  );
}

export function inputStyle() {
  const palette = store.palette();
  return {
    backgroundColor: palette.menu.background,
    borderColor: palette.menu.border,
    borderWidth: 1,
    borderRadius: 8,
    color: palette.menu.text,
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: store.type().md,
    minHeight: store.lengths().inputMinHeight,
  };
}
