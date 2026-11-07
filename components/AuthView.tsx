import { Image, Text, View } from "nsh";
import { Button, Checkbox, Input } from "nsh/base";
import * as store from "../store/appStore";
import logo from "../assets/icon.png";
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
import { Icon } from "./Icon";

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
  const loginLike = () => props.mode !== "locked";
  const title = () => (props.mode === "locked" ? "Vault is Locked" : "Log In to Bitwarden");

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
          {loginLike() ? (
            <Image
              testID="auth-logo"
              src={logo}
              style={{ width: 64, height: 64, borderRadius: 14 }}
            />
          ) : (
            <Icon name="lock" size={28} color={palette().menu.selectedText} />
          )}
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
          {loginLike() ? (
            <LoginServerRow />
          ) : (
            <Text style={{ color: palette().muted, fontSize: store.type().sm, textAlign: "center" }}>
              Logged in as {snap().email || "your account"}
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

        {loginLike() ? <LoginForm twoFactor={props.mode === "twoFactor"} /> : <UnlockForm />}
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
        <AuthCheckbox
          testID="login-mtls-toggle"
          checked={mtlsEnabled()}
          label="Use mTLS Client Certificate (for edge gateways)"
          fontSize={store.type().sm}
          onChange={(checked) => mtlsEnabled.set(checked)}
        />
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

/**
 * A checkbox drawn the app's way: the box and its label on one line, the box
 * filled with the accent colour while checked.
 */
function AuthCheckbox(props: {
  testID: string;
  checked: boolean;
  disabled?: boolean;
  label: string;
  fontSize: number;
  onChange: (checked: boolean) => void;
}) {
  const palette = store.palette;
  const accent = () => palette().menu.selectedText;
  return (
    <Checkbox
      testID={props.testID}
      checked={props.checked}
      disabled={props.disabled}
      onChange={({ checked }) => props.onChange(checked)}
      style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
      indicatorStyle={{
        width: 16,
        height: 16,
        alignItems: "center",
        justifyContent: "center",
        borderRadius: 4,
        borderWidth: 1,
        borderColor: props.checked ? accent() : palette().popups.border,
        backgroundColor: props.checked ? accent() : "transparent",
      }}
      indicator={
        <Icon
          name="check"
          size={11}
          color={props.checked ? palette().menu.background : "transparent"}
        />
      }
    >
      <Text style={{ flex: 1, color: palette().popups.text, fontSize: props.fontSize }}>
        {props.label}
      </Text>
    </Checkbox>
  );
}

function LoginForm(props: { twoFactor: boolean }) {
  const palette = store.palette;
  const submitting = store.isSubmitting;
  const challenge = () => store.snapshot().twoFactor;
  const fido2 = () => props.twoFactor && store.selectedProvider() === 7;
  const fidoStatus = () => store.fido2Status() ?? challenge()?.fido2Status ?? null;

  const primaryLabel = () => {
    if (!props.twoFactor) {
      return submitting() ? "Logging in…" : "Log In";
    }
    if (!fido2()) {
      return submitting() ? "Verifying…" : "Verify";
    }
    if (fidoStatus() === "tool_not_found") {
      return "Install libfido2";
    }
    if (fidoStatus() === "no_device") {
      return "Insert Security Key to Verify";
    }
    return submitting() ? "Waiting for key touch…" : "Verify with Security Key";
  };
  const primaryTestID = () => {
    if (!props.twoFactor) {
      return "login-submit";
    }
    return fido2() ? "twofactor-retry-fido2" : "twofactor-submit";
  };
  const primaryDisabled = () => submitting() || (fido2() && fidoStatus() === "no_device");
  const primaryPress = () => {
    if (!props.twoFactor) {
      submitLogin();
      return;
    }
    if (fido2() && fidoStatus() === "tool_not_found") {
      store.installFido2();
      return;
    }
    submitTwoFactor();
  };

  return (
    <View style={{ gap: 10 }}>
      {serverPanelOpen() ? <ServerPanel /> : null}

      <View style={{ flexDirection: "row", justifyContent: "center", gap: 6 }}>
        <TabButton
          label="Master Password"
          active={loginTab() === "password"}
          disabled={submitting() || props.twoFactor}
          onPress={() => loginTab.set("password")}
          testID="login-tab-password"
        />
        <TabButton
          label="API Key"
          active={loginTab() === "apiKey"}
          disabled={submitting() || props.twoFactor}
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
            onSubmit={() => primaryPress()}
            style={inputStyle()}
          />
          {props.twoFactor ? <TwoFactorSection /> : null}
          <AuthCheckbox
            testID="login-remember-email"
            checked={rememberEmail()}
            disabled={submitting()}
            label="Remember email"
            fontSize={store.type().base}
            onChange={(checked) => rememberEmail.set(checked)}
          />
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
        label={primaryLabel()}
        testID={primaryTestID()}
        tone="primary"
        disabled={primaryDisabled()}
        onPress={primaryPress}
      />
    </View>
  );
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

/** The submit action shared by the password form's primary button and Enter. */
function submitTwoFactor(): void {
  if (store.isSubmitting()) {
    return;
  }
  const challenge = store.snapshot().twoFactor;
  if (!challenge) {
    return;
  }
  const provider = store.selectedProvider();
  const fido2 = provider === 7;
  store.authenticate({
    kind: challenge.newDevice ? "newDevice" : "twoFactor",
    email: store.snapshot().email || email(),
    password: password() || pendingPassword(),
    clientId: "",
    clientSecret: "",
    code: fido2 ? "" : twoFactorCode(),
    provider,
    rememberEmail: rememberEmail(),
    // FIDO2 has no typed code: send none so the engine performs the
    // assertion instead of treating a blank OTP as a real code.
    newDeviceOtp: fido2 ? null : newDeviceOtp(),
  });
}

function providerTabLabel(id: number): string {
  switch (id) {
    case 7:
      return "Security Key";
    case 1:
      return "Email";
    case 3:
      return "YubiKey OTP";
    default:
      return "Authenticator";
  }
}

function codeLabel(newDevice: boolean, id: number | undefined): string {
  if (newDevice) {
    return "New Device Email Verification Code:";
  }
  switch (id) {
    case 1:
      return "Email 2FA Verification Code:";
    case 3:
      return "Touch YubiKey or Enter OTP:";
    default:
      return "Two-Factor Authentication (2FA) Code:";
  }
}

/**
 * The challenge the login form grows into once the password is accepted, laid
 * out as the plugin's: the method tabs, then the code field or the security-key
 * card, with the primary button below the form.
 */
function TwoFactorSection() {
  const palette = store.palette;
  const challenge = () => store.snapshot().twoFactor;
  const providers = () => challenge()?.providers ?? [];
  const provider = () => store.selectedProvider();
  const active = () => providers().find((entry) => entry.id === provider()) ?? providers()[0];
  const isEmail = () => active()?.id === 1;
  const isFido2 = () => active()?.id === 7;
  const newDevice = () => challenge()?.newDevice === true;
  const code = () => (newDevice() ? newDeviceOtp() : twoFactorCode());
  const setCode = (value: string) => {
    if (newDevice()) {
      newDeviceOtp.set(value);
    } else {
      twoFactorCode.set(value);
    }
  };

  return (
    <View testID="auth-view-twoFactor" style={{ gap: 6 }}>
      {providers().length > 1 ? (
        <View style={{ flexDirection: "row", gap: 4 }}>
          <Each of={providers()} key="index">
            {(entry) => (
              <TabButton
                fill
                label={providerTabLabel(entry().id)}
                active={entry().id === provider()}
                disabled={!entry().available || store.isSubmitting()}
                onPress={() => store.selectTwoFactorProvider(entry().id)}
                testID={`twofactor-provider-${entry().id}`}
              />
            )}
          </Each>
        </View>
      ) : null}

      {isFido2() ? (
        <Fido2Card />
      ) : (
        <View style={{ gap: 6 }}>
          <Text style={{ color: palette().popups.text, fontSize: store.type().sm }}>
            {codeLabel(newDevice(), active()?.id)}
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Input
              testID="twofactor-code"
              value={code()}
              placeholder="123456"
              autoCapitalize="none"
              autoCorrect={false}
              readonly={store.isSubmitting()}
              submitBehavior="submit"
              onSubmit={submitTwoFactor}
              onChange={({ value }) => setCode(value)}
              style={{ ...inputStyle(), flex: 1 }}
            />
            {isEmail() ? (
              <SmallButton
                testID="twofactor-resend"
                label={store.twoFactorEmailSent() ? "Resend Email" : "Send Email"}
                disabled={store.isSubmitting()}
                paddingVertical={6}
                onPress={() =>
                  store.sendTwoFactorEmail(
                    store.snapshot().email || email(),
                    password() || pendingPassword(),
                  )
                }
              />
            ) : null}
          </View>
        </View>
      )}
    </View>
  );
}

/** The plugin's security-key status card, with its install command when missing. */
function Fido2Card() {
  const palette = store.palette;
  const status = () => store.fido2Status() ?? store.snapshot().twoFactor?.fido2Status ?? null;
  const missingTool = () => status() === "tool_not_found";
  const title = () => {
    if (missingTool()) {
      return "libfido2 not installed";
    }
    return status() === "no_device" ? "No Security Key Detected" : "Security Key Detected";
  };
  const description = () => {
    if (missingTool()) {
      return "Install 'libfido2' to use security keys, or select another method:";
    }
    if (store.isSubmitting()) {
      return "Waiting for security key touch…";
    }
    return status() === "no_device"
      ? "Insert your USB security key. It will be detected automatically."
      : "Click 'Verify with Security Key' and touch your key.";
  };
  const accent = () => (missingTool() ? palette().warning : palette().menu.selectedText);

  return (
    <View
      testID="twofactor-fido2-card"
      style={{
        backgroundColor: tint(palette().menu.text, palette().menu.background, 0.06),
        borderColor: accent(),
        borderWidth: 1,
        borderRadius: 8,
        padding: 10,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 10 }}>
        <Icon name={missingTool() ? "zap" : "key"} size={18} color={accent()} />
        <View style={{ flex: 1, gap: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Text
              style={{
                flex: 1,
                color: palette().menu.text,
                fontSize: store.type().sm,
                fontWeight: "bold",
              }}
            >
              {title()}
            </Text>
            {missingTool() || status() === "no_device" ? (
              <SmallButton
                testID="twofactor-check-fido2"
                label="Check Again"
                paddingVertical={1}
                onPress={() => store.checkFido2Status()}
              />
            ) : null}
          </View>
          <Text style={{ color: palette().muted, fontSize: store.type().xs }}>
            {description()}
          </Text>
          {missingTool() ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                backgroundColor: tint(palette().menu.text, palette().menu.background, 0.12),
                borderColor: palette().popups.border,
                borderWidth: 1,
                borderRadius: 6,
                paddingHorizontal: 6,
                paddingVertical: 3,
              }}
            >
              <Text
                style={{
                  flex: 1,
                  color: palette().popups.text,
                  fontSize: store.type().xs,
                  fontFamily: "monospace",
                }}
              >
                sudo pacman -S libfido2
              </Text>
              <SmallButton
                testID="twofactor-install-fido2"
                label="Install"
                paddingVertical={1}
                onPress={() => store.installFido2()}
              />
              <SmallButton
                testID="twofactor-copy-install"
                label="Copy"
                paddingVertical={1}
                onPress={() => store.copyText("sudo pacman -S libfido2", "Install command", false)}
              />
            </View>
          ) : null}
        </View>
      </View>
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
  /** Fill the row evenly, as the two-factor method tabs do. */
  fill?: boolean;
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
        flex: props.fill ? 1 : undefined,
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
