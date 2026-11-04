import { Text, View } from "nsh";
import { Button, Checkbox, Input } from "nsh/base";
import { signal } from "nsh";
import * as store from "../store/appStore";
import { tint, textOnTint } from "../theme/palette";
import { ActionButton, Chip, Panel, SectionTitle } from "./ui";

const loginTab = signal<"password" | "apiKey">("password");
const email = signal("");
const password = signal("");
const clientId = signal("");
const clientSecret = signal("");
const rememberEmail = signal(true);
const pendingPassword = signal("");
const twoFactorCode = signal("");
const newDeviceOtp = signal("");
const unlockPassword = signal("");
const confirmLogout = signal(false);

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

  return (
    <Panel>
      <View style={{ flexDirection: "row", gap: 6 }}>
        <TabButton
          label="Master Password"
          active={loginTab() === "password"}
          onPress={() => loginTab.set("password")}
          testID="login-tab-password"
        />
        <TabButton
          label="API Key"
          active={loginTab() === "apiKey"}
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
            onChange={(text: string) => password.set(text)}
            onSubmit={() => submitLogin()}
            style={inputStyle()}
          />
          <Checkbox
            testID="login-remember-email"
            checked={rememberEmail()}
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
            onChange={(text: string) => clientSecret.set(text)}
            style={inputStyle()}
          />
        </View>
      )}

      <ActionButton
        label="Log In"
        testID="login-submit"
        tone="primary"
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
        <Button
          testID="login-open-settings"
          onPress={store.openSettings}
          style={{ alignSelf: "flex-start", paddingVertical: 2 }}
        >
          <Text style={{ color: palette().popups.selectedText, fontSize: 12 }}>
            Open Settings (Ctrl+,)
          </Text>
        </Button>
      </View>
    </Panel>
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
  password.set("");
}

function TwoFactorForm() {
  const palette = store.palette;
  const snap = store.snapshot;
  const challenge = () => snap().twoFactor;
  const providers = () => challenge()?.providers ?? [];
  const provider = () => store.selectedProvider();
  const active = () =>
    providers().find((entry) => entry.id === provider()) ?? providers()[0];
  const isEmail = () => active()?.id === 1;
  const isFido2 = () => active()?.id === 7;

  const submit = () => {
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
      newDeviceOtp: newDeviceOtp(),
    });
    twoFactorCode.set("");
    newDeviceOtp.set("");
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
          <ActionButton
            label="Retry Security Key"
            testID="twofactor-retry-fido2"
            onPress={submit}
          />
        </View>
      ) : null}

      {challenge()?.newDevice ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: palette().muted, fontSize: 12 }}>Verification code</Text>
          <Input
            testID="twofactor-code"
            value={newDeviceOtp()}
            placeholder="Enter the code from your email"
            autoCapitalize="none"
            autoCorrect={false}
            onChange={(text: string) => newDeviceOtp.set(text)}
            style={inputStyle()}
          />
        </View>
      ) : (
        <View style={{ gap: 6 }}>
          <Text style={{ color: palette().muted, fontSize: 12 }}>
            {isFido2() ? "Security key code (optional)" : "Code"}
          </Text>
          <Input
            testID="twofactor-code"
            value={twoFactorCode()}
            placeholder={isEmail() ? "Email verification code" : "123456"}
            autoCapitalize="none"
            autoCorrect={false}
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
          onPress={() => store.sendTwoFactorEmail(snap().email || email(), pendingPassword())}
        />
      ) : null}

      <ActionButton label="Verify" testID="twofactor-submit" tone="primary" onPress={submit} />
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

  const unlock = () => {
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
    unlockPassword.set("");
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
        onChange={(text: string) => unlockPassword.set(text)}
        onSubmit={unlock}
        style={inputStyle()}
      />

      <ActionButton label="Unlock Vault" testID="unlock-submit" tone="primary" onPress={unlock} />

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
  return (
    <Button
      testID={props.testID}
      disabled={props.disabled}
      onPress={props.onPress}
      style={{
        backgroundColor: props.active
          ? palette().popups.selectedBackground
          : palette().popups.background,
        borderColor: palette().popups.border,
        borderWidth: 1,
        borderRadius: 8,
        paddingHorizontal: 10,
        paddingVertical: 5,
      }}
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
