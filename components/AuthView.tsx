import { Text, View } from "nsh";
import { Button, Checkbox, Input } from "nsh/base";
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
  mtlsOpen,
  newDeviceOtp,
  password,
  pendingPassword,
  rememberEmail,
  twoFactorCode,
  unlockPassword,
} from "../store/authForm";
import { isOfficialServer } from "../store/IconPolicy";
import { tint, textOnTint } from "../theme/palette";
import {
  actionID,
  ActionButton,
  Chip,
  focusOutline,
  Panel,
  SectionTitle,
  SmallButton,
  useAction,
} from "./ui";

export type AuthMode = "login" | "twoFactor" | "locked";

export function AuthView(props: { mode: AuthMode }) {
  const palette = store.palette;
  const snap = store.snapshot;

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
      <View style={{ width: "100%", maxWidth: 460, gap: 14 }}>
        <View style={{ alignItems: "center", gap: 4 }}>
          <Text style={{ color: palette().menu.text, fontSize: 28, fontWeight: "bold" }}>
            Omawarden
          </Text>
          <Text style={{ color: palette().muted, fontSize: 13 }}>
            {props.mode === "login"
              ? "Sign in to your Bitwarden vault"
              : props.mode === "twoFactor"
                ? "Two-Factor Verification"
                : "Vault Locked"}
          </Text>
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
                fontSize: 12,
              }}
            >
              {snap().error}
            </Text>
          </View>
        ) : null}

        {props.mode === "login" ? (
          <LoginForm
            serverUrl={snap().serverUrl}
            identityUrl={snap().identityUrl ?? ""}
          />
        ) : null}
        {props.mode === "twoFactor" ? <TwoFactorForm /> : null}
        {props.mode === "locked" ? <UnlockForm /> : null}
      </View>
    </View>
  );
}

function LoginForm(props: { serverUrl: string; identityUrl: string }) {
  const palette = store.palette;
  const submitting = store.isSubmitting;
  const selfHosted = () => !isOfficialServer(props.serverUrl);

  return (
    <Panel>
      <View style={{ flexDirection: "row", gap: 6 }}>
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
          <Text style={{ color: palette().muted, fontSize: 12 }}>Email</Text>
          <Input
            testID="login-email"
            value={email()}
            placeholder="you@example.com"
            autoCapitalize="none"
            autoCorrect={false}
            readonly={submitting()}
            submitBehavior="submit"
            onChange={(text: string) => email.set(text)}
            style={inputStyle()}
          />
          <Text style={{ color: palette().muted, fontSize: 12 }}>Master Password</Text>
          <Input
            testID="login-password"
            value={password()}
            placeholder="Master password"
            masked
            autoCapitalize="none"
            autoCorrect={false}
            readonly={submitting()}
            submitBehavior="submit"
            onChange={(text: string) => password.set(text)}
            onSubmit={() => submitLogin()}
            style={inputStyle()}
          />
          <Checkbox
            testID="login-remember-email"
            checked={rememberEmail()}
            disabled={submitting()}
            onChange={(checked: boolean) => rememberEmail.set(checked)}
            indicator={
              <Text style={{ color: palette().menu.selectedText, fontSize: 12 }}>
                {rememberEmail() ? "✓" : " "}
              </Text>
            }
          >
            <Text style={{ color: palette().popups.text, fontSize: 12 }}>Remember email</Text>
          </Checkbox>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          <Text style={{ color: palette().muted, fontSize: 12 }}>Client ID</Text>
          <Input
            testID="login-client-id"
            value={clientId()}
            placeholder="user.client-id"
            autoCapitalize="none"
            autoCorrect={false}
            readonly={submitting()}
            submitBehavior="submit"
            onChange={(text: string) => clientId.set(text)}
            style={inputStyle()}
          />
          <Text style={{ color: palette().muted, fontSize: 12 }}>Client Secret</Text>
          <Input
            testID="login-client-secret"
            value={clientSecret()}
            placeholder="Client secret"
            masked
            autoCapitalize="none"
            autoCorrect={false}
            readonly={submitting()}
            submitBehavior="submit"
            onChange={(text: string) => clientSecret.set(text)}
            style={inputStyle()}
          />
        </View>
      )}

      {selfHosted() ? <MtlsCard /> : null}

      <ActionButton
        label={submitting() ? "Signing in…" : "Log In"}
        testID="login-submit"
        tone="primary"
        disabled={submitting()}
        onPress={submitLogin}
      />

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: palette().popups.border,
          paddingTop: 8,
          gap: 4,
        }}
      >
        <Text style={{ color: palette().muted, fontSize: 11 }}>Server</Text>
        <Text selectable style={{ color: palette().popups.text, fontSize: 12 }}>
          {props.serverUrl || "https://vault.bitwarden.com"}
        </Text>
        {props.identityUrl ? (
          <Text selectable style={{ color: palette().muted, fontSize: 11 }}>
            Identity: {props.identityUrl}
          </Text>
        ) : null}
        <SmallButton
          testID="login-open-settings"
          alignSelf="flex-start"
          paddingVertical={2}
          onPress={store.openSettings}
        >
          <Text style={{ color: palette().popups.selectedText, fontSize: 12 }}>
            Open Settings (Ctrl+,)
          </Text>
        </SmallButton>
      </View>
    </Panel>
  );
}

function MtlsCard() {
  const palette = store.palette;
  const open = mtlsOpen;
  const enabled = mtlsEnabled;

  return (
    <View
      style={{
        borderColor: palette().popups.border,
        borderWidth: 1,
        borderRadius: 8,
        padding: 10,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <SmallButton
          testID="login-mtls-toggle"
          paddingVertical={2}
          onPress={() => open.set(!open())}
        >
          <Text style={{ color: palette().popups.selectedText, fontSize: 12 }}>
            {open() ? "▾" : "▸"} Mutual TLS (mTLS) Client Certificate
          </Text>
        </SmallButton>
      </View>

      {open() ? (
        <View style={{ gap: 8 }}>
          <Checkbox
            testID="login-mtls-enabled"
            checked={enabled()}
            onChange={(checked: boolean) => enabled.set(checked)}
            indicator={
              <Text style={{ color: palette().menu.selectedText, fontSize: 12 }}>
                {enabled() ? "✓" : " "}
              </Text>
            }
          >
            <Text style={{ color: palette().popups.text, fontSize: 12 }}>
              Use a client certificate
            </Text>
          </Checkbox>

          <Text style={{ color: palette().muted, fontSize: 11 }}>Client Certificate (PEM)</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Input
              testID="login-mtls-cert"
              value={mtlsCertPath()}
              placeholder="~/.config/omawarden/client.crt"
              autoCapitalize="none"
              autoCorrect={false}
              onChange={(text: string) => mtlsCertPath.set(text)}
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
                  enabled.set(true);
                }
              }}
            />
          </View>

          <Text style={{ color: palette().muted, fontSize: 11 }}>Private Key (PEM)</Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Input
              testID="login-mtls-key"
              value={mtlsKeyPath()}
              placeholder="~/.config/omawarden/client.key"
              autoCapitalize="none"
              autoCorrect={false}
              onChange={(text: string) => mtlsKeyPath.set(text)}
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
                  enabled.set(true);
                }
              }}
            />
          </View>

          <Text style={{ color: palette().muted, fontSize: 10 }}>
            Keep the private key readable only by you (chmod 600). The certificate must match the
            server's hostname and origin.
          </Text>
        </View>
      ) : null}
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
  // Persist the mutual-TLS material before the engine opens a connection, so
  // the very first request already presents the client certificate.
  if (mtlsEnabled()) {
    store.saveMtlsConfig(mtlsCertPath().trim(), mtlsKeyPath().trim());
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
    <Panel>
      <SectionTitle hint={challenge()?.email ?? snap().email}>
        {challenge()?.newDevice ? "New Device Verification" : "Enter a verification code"}
      </SectionTitle>

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
          <Text style={{ color: palette().muted, fontSize: 12 }}>
            {fido2StatusText(challenge()?.fido2Status)}
          </Text>
          <Text style={{ color: palette().muted, fontSize: 11 }}>
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
          <Text style={{ color: palette().muted, fontSize: 12 }}>Verification code</Text>
          <Input
            testID="twofactor-code"
            value={newDeviceOtp()}
            placeholder="Enter the code from your email"
            autoCapitalize="none"
            autoCorrect={false}
            readonly={submitting()}
            onChange={(text: string) => newDeviceOtp.set(text)}
            onSubmit={submit}
            style={inputStyle()}
          />
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          <Text style={{ color: palette().muted, fontSize: 12 }}>Code</Text>
          <Input
            testID="twofactor-code"
            value={twoFactorCode()}
            placeholder={isEmail() ? "Email verification code" : "123456"}
            autoCapitalize="none"
            autoCorrect={false}
            readonly={submitting()}
            onChange={(text: string) => twoFactorCode.set(text)}
            onSubmit={submit}
            style={inputStyle()}
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
    </Panel>
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
    <Panel>
      <View style={{ gap: 4 }}>
        <Text style={{ color: palette().popups.text, fontSize: 14, fontWeight: "bold" }}>
          {snap().email || "Signed in"}
        </Text>
        <Text selectable style={{ color: palette().muted, fontSize: 12 }}>
          {snap().serverUrl}
        </Text>
      </View>

      <Text style={{ color: palette().muted, fontSize: 12 }}>Master Password</Text>
      <Input
        testID="unlock-password"
        value={unlockPassword()}
        placeholder="Master password"
        masked
        autoCapitalize="none"
        autoCorrect={false}
        readonly={submitting()}
        onChange={(text: string) => unlockPassword.set(text)}
        onSubmit={unlock}
        style={inputStyle()}
      />

      <ActionButton
        label={submitting() ? "Unlocking…" : "Unlock Vault"}
        testID="unlock-submit"
        tone="primary"
        disabled={submitting()}
        onPress={unlock}
      />

      {snap().quickUnlockReady ? (
        <View style={{ gap: 4 }}>
          <ActionButton
            label="Quick Unlock (System Auth)"
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
          <Text style={{ color: palette().muted, fontSize: 11 }}>
            Uses your system's authentication prompt.
          </Text>
        </View>
      ) : null}

      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        {confirmLogout() ? (
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            <ActionButton
              label="Confirm Log Out"
              testID="logout-confirm"
              tone="danger"
              onPress={() => {
                confirmLogout.set(false);
                store.lockOrLogout(true);
              }}
            />
            <ActionButton
              label="Cancel"
              testID="logout-cancel"
              onPress={() => confirmLogout.set(false)}
            />
          </View>
        ) : (
          <ActionButton label="Log Out" testID="logout" onPress={() => confirmLogout.set(true)} />
        )}
      </View>
    </Panel>
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
          fontSize: 12,
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
    fontSize: 13,
    minHeight: 36,
  };
}

export function AuthChip(props: { label: string; color: string }) {
  return <Chip label={props.label} color={props.color} />;
}
