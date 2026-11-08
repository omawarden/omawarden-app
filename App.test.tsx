import { expect, open, test } from "nsh/test";
import { OmawardenBridge } from "omawarden-app/native";

type MockState = Record<string, unknown>;

function openMock(mockState: MockState, params: Record<string, unknown> = {}) {
  return open("./App.tsx", {
    width: 1440,
    height: 960,
    platform: "linux",
    host: { params: { mock: true, mockState, ...params } },
  });
}

function openMockWithClock(mockState: MockState, params: Record<string, unknown> = {}) {
  return open("./App.tsx", {
    width: 1440,
    height: 960,
    platform: "linux",
    clock: {},
    host: { params: { mock: true, mockState, ...params } },
  });
}

function openMockAt(width: number, height: number, mockState: MockState) {
  return open("./App.tsx", {
    width,
    height,
    platform: "linux",
    host: { params: { mock: true, mockState } },
  });
}

const LOGIN_ITEM: Record<string, unknown> = {
  id: "login1",
  title: "GitHub",
  category: "login",
  username: "octocat",
  password: "hunter2",
  totp: "JBSWY3DPEHPK3PXP",
  uris: ["https://github.com/login"],
  favorite: true,
  organization: "Acme",
  folder: "Work",
  passwordHistory: [
    { password: "old-password", changedAt: "2026-01-01" },
    { password: "older-password", changedAt: "2025-06-01" },
  ],
  fields: [
    { name: "API Token", value: "token-abc-123", kind: "hidden" },
    { name: "Region", value: "us-east-1", kind: "text" },
  ],
  attachments: [{ id: "att1", filename: "notes.txt", size: 2048 }],
};

const MAIL_ITEM: Record<string, unknown> = {
  id: "login2",
  title: "Personal Mail",
  category: "login",
  username: "me@example.com",
  password: "mail-pass",
};

const CARD_ITEM: Record<string, unknown> = {
  id: "card1",
  title: "Travel Card",
  category: "card",
  card: {
    cardholderName: "Ada Lovelace",
    brand: "Visa",
    number: "4111111111111111",
    expMonth: "5",
    expYear: "2030",
    code: "123",
  },
};

const IDENTITY_ITEM: Record<string, unknown> = {
  id: "identity1",
  title: "Passport",
  category: "identity",
  identity: {
    fullName: "Ada Lovelace",
    username: "ada",
    company: "Analytical Engines",
    email: "ada@example.com",
    phone: "+44 20 7946 0000",
    ssn: "111-22-3333",
    passportNumber: "P1234567",
    licenseNumber: "L7654321",
    address1: "1 St James's Square",
    city: "London",
    postalCode: "SW1Y 4LE",
    country: "United Kingdom",
  },
};

const NOTE_ITEM: Record<string, unknown> = {
  id: "note1",
  title: "Recovery Codes",
  category: "secureNote",
  notes: "code-one\ncode-two",
};

const SSH_ITEM: Record<string, unknown> = {
  id: "ssh1",
  title: "Work Key",
  category: "sshKey",
  ssh: {
    keyType: "ED25519",
    fingerprint: "SHA256:abcdefghijklmnop",
    publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExample",
    privateKey:
      "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret-material\n-----END OPENSSH PRIVATE KEY-----",
  },
};

const VAULT_ITEMS: Array<Record<string, unknown>> = [
  LOGIN_ITEM,
  MAIL_ITEM,
  CARD_ITEM,
  IDENTITY_ITEM,
  NOTE_ITEM,
  SSH_ITEM,
];

const IMAGE_ATTACHMENT_ITEM: Record<string, unknown> = {
  id: "img1",
  title: "Photos",
  category: "login",
  username: "ada",
  password: "photo-pass",
  attachments: [{ id: "imgatt", filename: "photo.png", size: 4096 }],
};

const REPROMPT_ITEM: Record<string, unknown> = {
  ...LOGIN_ITEM,
  id: "secure1",
  title: "Protected Login",
  organization: null,
  folder: null,
  reprompt: 1,
};

// ---------------------------------------------------------------------------
// Dependency check
// ---------------------------------------------------------------------------

test("dependency check lists packages and launches the installer", async () => {
  const app = await openMock({
    phase: "dependencyCheck",
    dependenciesMissing: ["libsecret"],
  });

  expect(app.shows("id:dependency-check-view")).toBe(true);
  expect(app.shows("id:dependency-omawarden")).toBe(true);
  expect(app.shows("id:dependency-libsecret")).toBe(true);
  expect(app.shows("id:dependency-wl-clipboard")).toBe(true);
  expect(app.shows("id:dependency-libfido2")).toBe(true);
  expect(app.texts()).toContain("System Dependencies Required");
  expect(app.texts()).toContain("Prerequisite Setup");
  expect(app.texts()).toContain("✗ Missing");
  expect(app.texts()).toContain("⚡ Install Missing Packages (libsecret)");

  await app.press("id:install-dependencies");
  expect(app.shows("id:toast")).toBe(true);
  expect(app.texts()).toContain("Installing missing packages in a floating terminal.");

  await app.press("id:recheck-dependencies");
  expect(app.shows("id:dependency-check-view")).toBe(true);
});

test("dependency check reports when every required package is installed", async () => {
  const app = await openMock({ phase: "dependencyCheck" });

  expect(app.texts()).toContain("✓ Ready");
  expect(app.texts()).toContain("✓ All Dependencies Installed");
  expect(app.enabled("id:install-dependencies")).toBe(false);
});

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

test("master password login unlocks the vault", async () => {
  const app = await openMock({ phase: "login", serverUrl: "https://vault.example.com" });

  expect(app.shows("id:auth-view-login")).toBe(true);
  expect(app.texts()).toContain("https://vault.example.com");

  await app.type("id:login-email", "user@example.com");
  await app.type("id:login-password", "correct horse battery staple");
  await app.press("id:login-submit");

  expect(app.shows("id:vault-workspace")).toBe(true);
  expect(app.shows("id:search-header")).toBe(true);
  expect(app.shows("id:empty-inspector")).toBe(true);
});

test("login validates a missing email and password", async () => {
  const app = await openMock({ phase: "login" });

  expect(app.shows("id:auth-logo")).toBe(true);
  await app.press("id:login-submit");
  expect(app.shows("id:auth-view-login")).toBe(true);
  expect(app.texts()).toContain("Email and master password are required.");
  // The form already shows the failure inline; a toast would repeat it.
  expect(app.shows("id:toast")).toBe(false);
});

test("failed login preserves typed credentials and a success clears them", async () => {
  const app = await openMock({ phase: "login" });

  await app.type("id:login-password", "hunter2");
  await app.press("id:login-submit");
  expect(app.texts()).toContain("Email and master password are required.");
  expect(app.value("id:login-password")).toBe("hunter2");

  await app.type("id:login-email", "user@example.com");
  await app.press("id:login-submit");
  expect(app.shows("id:vault-workspace")).toBe(true);

  await app.press("id:lock-vault");
  expect(app.shows("id:auth-view-locked")).toBe(true);
  await app.press("id:logout");
  await app.press("id:logout-confirm");
  expect(app.shows("id:auth-view-login")).toBe(true);
  expect(app.value("id:login-password")).toBe("");
});

test("self-hosted login offers mutual TLS configuration", async () => {
  const app = await openMock({ phase: "login", serverUrl: "https://vault.example.com" });

  await app.press("id:login-server-chip");
  expect(app.shows("id:login-server-panel")).toBe(true);
  expect(app.value("id:login-server-url")).toBe("https://vault.example.com");
  expect(app.shows("id:login-mtls-toggle")).toBe(true);
  expect(app.shows("id:login-mtls-cert")).toBe(false);

  await app.press("id:login-mtls-toggle");
  expect(app.shows("id:login-mtls-cert")).toBe(true);
  expect(app.shows("id:login-mtls-key")).toBe(true);

  await app.press("id:login-mtls-cert-browse");
  expect(app.value("id:login-mtls-cert")).toBe("/tmp/omawarden-mock/client.pem");
  await app.press("id:login-mtls-key-browse");
  expect(app.value("id:login-mtls-key")).toBe("/tmp/omawarden-mock/client.pem");
});

test("official Bitwarden login hides mutual TLS configuration", async () => {
  const app = await openMock({ phase: "login", serverUrl: "https://vault.bitwarden.com" });

  await app.press("id:login-server-chip");
  expect(app.shows("id:login-server-panel")).toBe(true);
  expect(app.shows("id:login-mtls-toggle")).toBe(false);
  expect(app.texts()).toContain(
    "Official Bitwarden cloud uses standard HTTPS and does not require client certificates.",
  );
});

test("the server panel saves a self-hosted URL and resets to the official one", async () => {
  const app = await openMock({ phase: "login", serverUrl: "https://vault.bitwarden.com" });

  await app.press("id:login-server-chip");
  await app.clear("id:login-server-url");
  await app.type("id:login-server-url", "https://vault.example.com");
  await app.press("id:login-server-save");
  expect(app.shows("id:login-server-panel")).toBe(false);
  expect(app.texts()).toContain("Server settings saved.");
  expect(app.texts()).toContain("https://vault.example.com");

  await app.press("id:login-server-chip");
  expect(app.value("id:login-server-url")).toBe("https://vault.example.com");
  await app.press("id:login-server-reset");
  expect(app.shows("id:login-server-panel")).toBe(false);
  expect(app.texts()).toContain("https://vault.bitwarden.com");
});

test("API key login unlocks the vault", async () => {
  const app = await openMock({ phase: "login" });

  await app.press("id:login-tab-api");
  expect(app.shows("id:login-client-id")).toBe(true);

  await app.type("id:login-client-id", "user.client-id");
  await app.type("id:login-client-secret", "client-secret");
  await app.press("id:login-submit");

  expect(app.shows("id:vault-workspace")).toBe(true);
});

test("two-factor verification supports email resend and completes login", async () => {
  const app = await openMock({
    phase: "login",
    email: "user@example.com",
    twoFactorRequired: true,
  });

  await app.type("id:login-email", "user@example.com");
  await app.type("id:login-password", "master-password");
  await app.press("id:login-submit");

  expect(app.shows("id:auth-view-twoFactor")).toBe(true);
  expect(app.shows("id:twofactor-provider-0")).toBe(true);
  expect(app.shows("id:twofactor-provider-1")).toBe(true);

  await app.press("id:twofactor-provider-1");
  expect(app.shows("id:twofactor-resend")).toBe(true);
  await app.press("id:twofactor-resend");
  expect(app.texts()).toContain("Verification email sent.");

  await app.type("id:twofactor-code", "123456");
  await app.press("id:twofactor-submit");
  expect(app.shows("id:vault-workspace")).toBe(true);
});

test("two-factor verification rejects an empty code", async () => {
  const app = await openMock({
    phase: "login",
    email: "user@example.com",
    twoFactorRequired: true,
  });

  await app.type("id:login-email", "user@example.com");
  await app.type("id:login-password", "master-password");
  await app.press("id:login-submit");

  await app.press("id:twofactor-submit");
  expect(app.shows("id:auth-view-twoFactor")).toBe(true);
  expect(app.texts()).toContain("Enter a verification code.");

  await app.type("id:twofactor-code", "654321");
  await app.press("id:twofactor-submit");
  expect(app.shows("id:vault-workspace")).toBe(true);
});

test("two-factor selects the server's default FIDO2 provider", async () => {
  const app = await openMock({
    phase: "login",
    email: "user@example.com",
    twoFactorRequired: true,
    twoFactor: {
      email: "user@example.com",
      providers: [
        { id: 0, name: "authenticator", label: "Authenticator App", available: true },
        { id: 7, name: "fido2", label: "FIDO2 Security Key", available: true },
      ],
      selectedProvider: 7,
      fido2Status: "available",
    },
  });

  await app.type("id:login-email", "user@example.com");
  await app.type("id:login-password", "master-password");
  await app.press("id:login-submit");

  expect(app.shows("id:auth-view-twoFactor")).toBe(true);
  expect(app.shows("id:twofactor-retry-fido2")).toBe(true);
  expect(app.shows("id:twofactor-code")).toBe(false);
  expect(app.texts()).toContain("Security Key Detected");
  expect(app.texts()).toContain("Click 'Verify with Security Key' and touch your key.");
});

test("FIDO2 retry performs the security key assertion and unlocks", async () => {
  const app = await openMock({
    phase: "login",
    email: "user@example.com",
    twoFactorRequired: true,
    twoFactor: {
      email: "user@example.com",
      providers: [
        { id: 0, name: "authenticator", label: "Authenticator App", available: true },
        { id: 7, name: "fido2", label: "FIDO2 Security Key", available: true },
      ],
      selectedProvider: 7,
      fido2Status: "available",
    },
  });

  await app.type("id:login-email", "user@example.com");
  await app.type("id:login-password", "master-password");
  await app.press("id:login-submit");

  expect(app.shows("id:twofactor-retry-fido2")).toBe(true);
  await app.press("id:twofactor-retry-fido2");
  expect(app.shows("id:vault-workspace")).toBe(true);
});

test("locked vault offers quick unlock and master password unlock", async () => {
  const app = await openMock({
    phase: "locked",
    email: "vault@example.com",
    serverUrl: "https://vault.example.com",
    quickUnlockReady: true,
  });

  expect(app.shows("id:auth-view-locked")).toBe(true);
  expect(app.texts()).toContain("Logged in as vault@example.com");
  expect(app.shows("id:quick-unlock")).toBe(true);

  await app.press("id:quick-unlock");
  expect(app.shows("id:vault-workspace")).toBe(true);
});

test("locked vault unlocks with the master password and can log out", async () => {
  const app = await openMock({
    phase: "locked",
    email: "vault@example.com",
    quickUnlockReady: false,
  });

  expect(app.shows("id:quick-unlock")).toBe(false);

  await app.type("id:unlock-password", "master-password");
  await app.press("id:unlock-submit");
  expect(app.shows("id:vault-workspace")).toBe(true);

  await app.press("id:lock-vault");
  expect(app.shows("id:auth-view-locked")).toBe(true);
  expect(app.texts()).toContain("Vault locked.");

  await app.press("id:logout");
  expect(app.shows("id:logout-confirm")).toBe(true);
  await app.press("id:logout-confirm");
  expect(app.shows("id:auth-view-login")).toBe(true);
});

// ---------------------------------------------------------------------------
// Vault filtering
// ---------------------------------------------------------------------------

test("vault filters by category, search text, scope, and folder", async () => {
  const app = await openMock({ phase: "unlocked", items: VAULT_ITEMS });

  expect(app.shows("id:vault-workspace")).toBe(true);
  expect(app.texts().join(" ")).toContain("All (6)");
  expect(app.texts().join(" ")).toContain("Logins (2)");
  expect(app.texts().join(" ")).toContain("Cards (1)");

  await app.press("id:category-card");
  expect(app.shows("id:cipher-row-card1")).toBe(true);
  expect(app.shows("id:cipher-row-login1")).toBe(false);

  await app.press("id:category-all");
  expect(app.shows("id:cipher-row-login1")).toBe(true);

  await app.type("id:vault-search", "github");
  expect(app.shows("id:cipher-row-login1")).toBe(true);
  expect(app.shows("id:cipher-row-card1")).toBe(false);

  await app.clear("id:vault-search");
  expect(app.shows("id:cipher-row-card1")).toBe(true);

  await app.press("id:scope-trigger");
  expect(app.shows("id:scope-dropdown")).toBe(true);
  await app.press("id:scope-personal");
  expect(app.shows("id:cipher-row-login1")).toBe(false);
  expect(app.shows("id:cipher-row-login2")).toBe(true);

  await app.press("id:scope-trigger");
  await app.press("id:scope-all");
  expect(app.shows("id:cipher-row-login1")).toBe(true);

  await app.press("id:scope-trigger");
  await app.press("text:Work");
  expect(app.shows("id:cipher-row-login1")).toBe(true);
  expect(app.shows("id:cipher-row-ssh1")).toBe(false);
});

test("filter changes preserve the mounted workspace and update rows instantly", async () => {
  const app = await openMock({ phase: "unlocked", items: VAULT_ITEMS });

  expect(app.shows("id:vault-workspace")).toBe(true);
  expect(app.texts()).toContain("6 of 6");

  await app.press("id:category-card");
  expect(app.shows("id:vault-workspace")).toBe(true);
  expect(app.texts()).toContain("1 of 1");
  expect(app.shows("id:cipher-row-card1")).toBe(true);
  expect(app.shows("id:cipher-row-login1")).toBe(false);

  await app.press("id:category-all");
  expect(app.shows("id:vault-workspace")).toBe(true);
  expect(app.texts()).toContain("6 of 6");

  await app.type("id:vault-search", "git");
  expect(app.shows("id:vault-workspace")).toBe(true);
  expect(app.texts()).toContain("1 of 1");
  expect(app.shows("id:cipher-row-login1")).toBe(true);
  expect(app.shows("id:cipher-row-card1")).toBe(false);

  await app.clear("id:vault-search");
  expect(app.shows("id:vault-workspace")).toBe(true);
  expect(app.texts()).toContain("6 of 6");
});

test("empty search results show an empty hint", async () => {
  const app = await openMock({ phase: "unlocked", items: VAULT_ITEMS });

  await app.type("id:vault-search", "zzzzz-no-such-item");
  expect(app.texts()).toContain("No items match this search.");
});

test("category counts follow the current search and stay stable across category tabs", async () => {
  const app = await openMock({ phase: "unlocked", items: VAULT_ITEMS });

  expect(app.texts().join(" ")).toContain("All (6)");
  expect(app.texts().join(" ")).toContain("Logins (2)");
  expect(app.texts().join(" ")).toContain("Cards (1)");

  await app.type("id:vault-search", "github");
  expect(app.texts().join(" ")).toContain("All (1)");
  expect(app.texts().join(" ")).toContain("Logins (1)");
  expect(app.texts().join(" ")).toContain("Cards (0)");
  expect(app.texts().join(" ")).toContain("Identities (0)");

  await app.press("id:category-card");
  expect(app.texts().join(" ")).toContain("All (1)");
  expect(app.texts().join(" ")).toContain("Logins (1)");

  await app.clear("id:vault-search");
  await app.press("id:category-all");
  expect(app.texts().join(" ")).toContain("All (6)");
});

test("vault rows fall back to category icons when website icons are off", async () => {
  const app = await openMock({
    phase: "unlocked",
    items: [LOGIN_ITEM, CARD_ITEM],
    settings: { showWebsiteIcons: false },
  });

  expect(app.shows("id:cipher-category-icon-login1")).toBe(true);
  expect(app.shows("id:cipher-icon-login1")).toBe(false);
  expect(app.texts()).toContain("Visa · •••• •••• •••• 1111");
});

// ---------------------------------------------------------------------------
// Inspector
// ---------------------------------------------------------------------------

test("login inspector reveals, copies TOTP, and shows history", async () => {
  const app = await openMock({ phase: "unlocked", items: [LOGIN_ITEM] });

  await app.press("id:cipher-row-login1");
  expect(app.shows("id:item-inspector")).toBe(true);
  expect(app.shows("id:inspector-login")).toBe(true);
  expect(app.texts()).toContain("octocat");

  await app.press("id:reveal-password");
  expect(app.texts()).toContain("hunter2");

  await app.press("id:copy-password");
  expect(app.texts()).toContain("Copied password to clipboard (clears in 30s).");

  expect(app.shows("id:inspector-totp")).toBe(true);
  await app.press("id:copy-totp");
  expect(app.texts()).toContain("Copied TOTP code to clipboard (clears in 30s).");

  expect(app.texts()).toContain("github.com");
  await app.press("id:copy-uri-github.com");
  expect(app.texts()).toContain("Copied website URL to clipboard.");

  await app.press("id:open-password-history");
  expect(app.shows("id:password-history-modal")).toBe(true);
  expect(app.texts()).toContain("old-password");
  await app.press("id:copy-history-password-0");
  expect(app.texts()).toContain("Copied previous password to clipboard (clears in 30s).");
  await app.press("id:password-history-close");
  expect(app.shows("id:password-history-modal")).toBe(false);

  expect(app.shows("id:inspector-fields")).toBe(true);
  expect(app.texts()).toContain("••••••••");
  await app.press("id:reveal-field-0");
  expect(app.texts()).toContain("token-abc-123");
  await app.press("id:copy-field-0");
  expect(app.texts()).toContain("Copied API Token to clipboard (clears in 30s).");

  await app.press("id:preview-attachment-att1");
  expect(app.shows("id:attachment-preview")).toBe(true);
  expect(app.texts()).toContain("Mock attachment preview");
  expect(app.shows("id:copy-attachment-content")).toBe(true);
  await app.press("id:close-attachment-preview");
  expect(app.shows("id:attachment-preview")).toBe(false);

  await app.press("id:download-attachment-att1");
  expect(app.texts()).toContain("Saved to /tmp/omawarden-mock/notes.txt");
});

test("live TOTP ticks down and auto-refreshes when the period ends", async () => {
  const app = await openMockWithClock({
    phase: "unlocked",
    items: [{ ...LOGIN_ITEM, totpRemaining: 2, totpPeriod: 30 }],
  });

  await app.press("id:cipher-row-login1");
  expect(app.shows("id:inspector-totp")).toBe(true);
  expect(app.texts()).toContain("2s");

  await app.wait(1000);
  expect(app.texts()).toContain("1s");

  await app.wait(1000);
  expect(app.texts()).toContain("30s");
});

test("master password re-prompt hides secrets until confirmed", async () => {
  const app = await openMock({ phase: "unlocked", items: [REPROMPT_ITEM] });

  await app.press("id:cipher-row-secure1");
  expect(app.shows("id:inspector-reprompt")).toBe(true);
  expect(app.texts()).toContain("••• •••");
  expect(app.texts()).not.toContain("hunter2");

  await app.press("id:reveal-password");
  expect(app.shows("id:reprompt-modal")).toBe(true);

  await app.type("id:reprompt-password", "wrong password");
  await app.press("id:reprompt-submit");
  expect(app.shows("id:reprompt-error")).toBe(true);
  expect(app.texts()).toContain("Incorrect master password.");

  await app.clear("id:reprompt-password");
  await app.type("id:reprompt-password", "correct horse battery staple");
  await app.press("id:reprompt-submit");
  expect(app.shows("id:reprompt-modal")).toBe(false);
  expect(app.texts()).toContain("hunter2");
});

test("image attachments show an inline preview and a system viewer action", async () => {
  const app = await openMock({ phase: "unlocked", items: [IMAGE_ATTACHMENT_ITEM] });

  await app.press("id:cipher-row-img1");
  await app.press("id:preview-attachment-imgatt");
  expect(app.shows("id:attachment-preview")).toBe(true);
  expect(app.shows("id:attachment-image")).toBe(true);
  expect(app.shows("id:open-attachment-external")).toBe(true);
  expect(app.shows("id:copy-attachment-content")).toBe(false);
});

test("card inspector masks, reveals, and copies card fields", async () => {
  const app = await openMock({ phase: "unlocked", items: [CARD_ITEM] });

  await app.press("id:cipher-row-card1");
  expect(app.shows("id:inspector-card")).toBe(true);
  expect(app.shows("id:inspector-card-number")).toBe(true);
  expect(app.texts()).toContain("•••• •••• •••• 1111");

  await app.press("id:reveal-card-number");
  expect(app.texts()).toContain("4111 1111 1111 1111");

  await app.press("id:copy-card-number");
  expect(app.texts()).toContain("Copied card number to clipboard (clears in 30s).");

  await app.press("id:reveal-cvv");
  expect(app.texts()).toContain("123");
  await app.press("id:copy-cvv");
  expect(app.texts()).toContain("Copied card security code to clipboard (clears in 30s).");

  expect(app.texts()).toContain("05 / 2030");
  await app.press("id:copy-expiration");
  expect(app.texts()).toContain("Copied expiration to clipboard.");
});

test("identity inspector shows fields and copies sensitive numbers", async () => {
  const app = await openMock({ phase: "unlocked", items: [IDENTITY_ITEM] });

  await app.press("id:cipher-row-identity1");
  expect(app.shows("id:inspector-identity")).toBe(true);
  expect(app.texts()).toContain("Ada Lovelace");
  expect(app.texts()).toContain("Analytical Engines");
  expect(app.texts()).toContain("111-22-3333");

  await app.press("id:copy-ssn");
  expect(app.texts()).toContain("Copied SSN to clipboard (clears in 30s).");

  await app.press("id:copy-identity-email");
  expect(app.texts()).toContain("Copied email to clipboard.");
});

test("secure note inspector copies the note body", async () => {
  const app = await openMock({ phase: "unlocked", items: [NOTE_ITEM] });

  await app.press("id:cipher-row-note1");
  expect(app.shows("id:inspector-notes")).toBe(true);
  expect(app.texts()).toContain("code-one\ncode-two");

  await app.press("id:copy-notes");
  expect(app.texts()).toContain("Copied secure note to clipboard (clears in 30s).");
});

test("SSH inspector reveals, copies, and exports the private key", async () => {
  const app = await openMock({ phase: "unlocked", items: [SSH_ITEM] });

  await app.press("id:cipher-row-ssh1");
  expect(app.shows("id:inspector-ssh")).toBe(true);
  expect(app.texts()).toContain("SHA256:abcdefghijklmnop");

  await app.press("id:reveal-private-key");
  expect(app.texts()).toContain(
    "-----BEGIN OPENSSH PRIVATE KEY-----\nsecret-material\n-----END OPENSSH PRIVATE KEY-----",
  );

  await app.press("id:copy-private-key");
  expect(app.texts()).toContain("Copied private key to clipboard (clears in 30s).");

  await app.press("id:export-ssh-key");
  expect(app.shows("id:ssh-key-modal")).toBe(true);
  expect(app.shows("id:ssh-export-panel")).toBe(true);
  await app.press("id:ssh-export-save");
  expect(app.shows("id:ssh-key-modal")).toBe(false);
  expect(app.texts()).toContain("Exported to ~/.ssh/id_ed25519");
});

test("timestamps read on the reader's clock", async () => {
  const app = await openMock({
    phase: "unlocked",
    items: [LOGIN_ITEM],
    lastSync: "2026-03-04T05:06:07Z",
  });

  const stamps = app.texts().filter((text) => text.includes(" GMT"));
  expect(stamps.length).toBe(1);
  expect(stamps[0]).toMatch(/^Synced \d{4}-\d{2}-\d{2} \d{2}:\d{2} GMT[+-]\d+(:\d{2})?$/);

  await app.press("id:cipher-row-login1");
  await app.press("id:open-password-history");
  const hints = app.texts().filter((text) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2} GMT[+-]\d/.test(text));
  expect(hints.length).toBe(2);
});

// ---------------------------------------------------------------------------
// Password generator
// ---------------------------------------------------------------------------

test("password generator rejects out-of-range lengths without clamping", async () => {
  const app = await openMock({ phase: "unlocked", items: [LOGIN_ITEM] });

  await app.press("id:open-generator");
  expect(app.shows("id:password-generator-modal")).toBe(true);
  expect(app.value("id:generator-length")).toBe("20");

  await app.clear("id:generator-length");
  await app.type("id:generator-length", "4");
  await app.press("id:generator-generate");
  expect(app.shows("id:generator-error")).toBe(true);
  expect(app.texts()).toContain(
    "Password length must be between 5 and 128 characters. Use 14 or more characters for a strong password.",
  );
  expect(app.value("id:generator-length")).toBe("4");

  await app.clear("id:generator-length");
  await app.type("id:generator-length", "129");
  await app.press("id:generator-generate");
  expect(app.value("id:generator-length")).toBe("129");
  expect(app.shows("id:generator-error")).toBe(true);

  await app.clear("id:generator-length");
  await app.type("id:generator-length", "24");
  await app.press("id:generator-generate");
  expect(app.shows("id:generator-error")).toBe(false);

  await app.press("id:generator-uppercase");
  await app.press("id:generator-min-numbers-increase");
  await app.press("id:generator-min-special-decrease");
  await app.press("id:generator-generate");
  expect(app.shows("id:generator-error")).toBe(false);

  await app.press("id:generator-copy-close");
  expect(app.shows("id:password-generator-modal")).toBe(false);
  expect(app.texts()).toContain("Copied generated secret to clipboard (clears in 30s).");
});

test("passphrase generator rejects out-of-range word counts without clamping", async () => {
  const app = await openMock({ phase: "unlocked", items: [LOGIN_ITEM] });

  await app.press("id:open-generator");
  await app.press("id:generator-tab-passphrase");
  expect(app.shows("id:generator-words")).toBe(true);
  expect(app.value("id:generator-words")).toBe("5");

  await app.clear("id:generator-words");
  await app.type("id:generator-words", "2");
  await app.press("id:generator-generate");
  expect(app.texts()).toContain("Passphrase word count must be between 3 and 20 words.");
  expect(app.shows("id:generator-error")).toBe(true);

  await app.clear("id:generator-words");
  await app.type("id:generator-words", "21");
  await app.press("id:generator-generate");
  expect(app.shows("id:generator-error")).toBe(true);

  await app.clear("id:generator-words");
  await app.type("id:generator-words", "6");
  await app.clear("id:generator-separator");
  await app.type("id:generator-separator", "|");
  await app.press("id:generator-capitalize");
  await app.press("id:generator-generate");
  expect(app.shows("id:generator-error")).toBe(false);

  await app.press("id:generator-copy-close");
  expect(app.shows("id:password-generator-modal")).toBe(false);
});

// ---------------------------------------------------------------------------
// Action palette and keyboard shortcuts
// ---------------------------------------------------------------------------

test("action palette lists context actions, filters, syncs, and opens modals", async () => {
  const app = await openMock({ phase: "unlocked", items: [LOGIN_ITEM] });

  await app.press("id:cipher-row-login1");
  await app.keyboard.press("mod+k");
  expect(app.shows("id:action-palette-modal")).toBe(true);
  expect(app.shows("id:action-copy-password")).toBe(true);
  expect(app.shows("id:action-copy-username")).toBe(true);
  expect(app.shows("id:action-copy-totp")).toBe(true);
  expect(app.shows("id:action-reveal-password")).toBe(true);
  expect(app.shows("id:action-password-history")).toBe(true);
  expect(app.shows("id:action-open-url")).toBe(true);
  expect(app.shows("id:action-sync")).toBe(true);
  expect(app.shows("id:action-generator")).toBe(true);
  expect(app.shows("id:action-create-ssh-key")).toBe(true);
  expect(app.shows("id:action-lock")).toBe(true);
  expect(app.shows("id:action-settings")).toBe(true);

  await app.type("id:action-palette-search", "sync vault");
  expect(app.shows("id:action-sync")).toBe(true);
  expect(app.shows("id:action-copy-password")).toBe(false);

  await app.press("id:action-sync");
  expect(app.shows("id:action-palette-modal")).toBe(false);
  expect(app.texts()).toContain("Vault synchronized.");

  await app.keyboard.press("mod+k");
  await app.type("id:action-palette-search", "not-a-command");
  expect(app.shows("id:action-palette-empty")).toBe(true);

  await app.press("id:action-palette-close");
  expect(app.shows("id:action-palette-modal")).toBe(false);

  await app.keyboard.press("mod+k");
  await app.type("id:action-palette-search", "generator");
  await app.press("id:action-generator");
  expect(app.shows("id:password-generator-modal")).toBe(true);

  await app.press("id:modal-close");
  expect(app.shows("id:password-generator-modal")).toBe(false);

  await app.keyboard.press("mod+k");
  await app.press("id:action-lock");
  expect(app.shows("id:auth-view-locked")).toBe(true);
  expect(app.texts()).toContain("Vault locked.");
});

test("action palette selects with arrows, runs with enter, and honors direct shortcuts", async () => {
  const app = await openMock({ phase: "unlocked", items: [LOGIN_ITEM] });

  await app.press("id:cipher-row-login1");
  await app.keyboard.press("mod+k");
  expect(app.shows("id:action-palette-modal")).toBe(true);
  expect(app.texts()).not.toContain("Run");

  await app.keyboard.press("down");
  await app.keyboard.press("enter");
  expect(app.shows("id:action-palette-modal")).toBe(false);
  expect(app.texts()).toContain("Copied username to clipboard.");

  await app.keyboard.press("mod+k");
  await app.keyboard.press("mod+enter");
  expect(app.shows("id:action-palette-modal")).toBe(false);
  expect(app.texts()).toContain("Copied TOTP code to clipboard (clears in 30s).");

  await app.keyboard.press("mod+k");
  await app.type("id:action-palette-search", "sync");
  await app.keyboard.press("enter");
  expect(app.shows("id:action-palette-modal")).toBe(false);
  expect(app.texts()).toContain("Vault synchronized.");
});

test("global shortcuts copy TOTP, username, and toggle the password reveal", async () => {
  const app = await openMock({ phase: "unlocked", items: [LOGIN_ITEM] });

  await app.press("id:cipher-row-login1");

  await app.keyboard.press("mod+enter");
  expect(app.texts()).toContain("Copied TOTP code to clipboard (clears in 30s).");

  await app.keyboard.press("mod+u");
  expect(app.texts()).toContain("Copied username to clipboard.");

  expect(app.texts()).not.toContain("hunter2");
  await app.keyboard.press("mod+t");
  expect(app.texts()).toContain("hunter2");
  await app.keyboard.press("mod+t");
  expect(app.texts()).not.toContain("hunter2");

  await app.keyboard.press("mod+o");
  expect(app.texts()).not.toContain("This URL is not safe to open.");
});

test("a failed sync keeps the vault unlocked and surfaces the error", async () => {
  const app = await openMock({
    phase: "unlocked",
    items: [LOGIN_ITEM],
    syncError: "Network unavailable.",
  });

  await app.press("id:cipher-row-login1");
  expect(app.shows("id:item-inspector")).toBe(true);

  await app.press("id:sync-vault");
  expect(app.texts()).toContain("Network unavailable.");
  expect(app.shows("id:item-inspector")).toBe(true);
  expect(app.shows("id:auth-view-locked")).toBe(false);
});

test("TOTP reads as a normal inspector field and SSH primary copy uses the public key", async () => {
  const app = await openMock({ phase: "unlocked", items: [LOGIN_ITEM, SSH_ITEM] });

  await app.press("id:cipher-row-login1");
  expect(app.texts()).toContain("TOTP Code");
  expect(app.texts()).not.toContain("Live TOTP");

  await app.press("id:category-sshKey");
  await app.press("id:cipher-row-ssh1");
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Copied public key to clipboard.");
});

test("SSH quick actions live on the SSH tab, not the search header", async () => {
  const app = await openMock({ phase: "unlocked", items: [SSH_ITEM] });

  expect(app.shows("id:open-ssh-key")).toBe(false);
  await app.press("id:category-sshKey");
  expect(app.shows("id:open-ssh-key")).toBe(true);
  expect(app.shows("id:import-ssh-key")).toBe(true);
});

test("tab moves focus between action controls and enter activates them", async () => {
  const app = await openMock({ phase: "unlocked", items: VAULT_ITEMS });

  await app.keyboard.press("tab");
  await app.keyboard.press("space");
  expect(app.shows("id:item-inspector")).toBe(true);

  await app.keyboard.press("mod+g");
  expect(app.shows("id:password-generator-modal")).toBe(true);
  await app.keyboard.press("tab");
  await app.keyboard.press("enter");
  expect(app.shows("id:password-generator-modal")).toBe(false);
});

test("keyboard shortcuts navigate, copy, open modals, and lock", async () => {
  const app = await openMock({ phase: "unlocked", items: [LOGIN_ITEM, MAIL_ITEM] });

  await app.keyboard.press("down");
  expect(app.shows("id:item-inspector")).toBe(true);
  await app.keyboard.press("enter");
  expect(app.texts()).toContain("Copied password to clipboard (clears in 30s).");

  await app.keyboard.press("mod+g");
  expect(app.shows("id:password-generator-modal")).toBe(true);
  await app.keyboard.press("escape");
  expect(app.shows("id:password-generator-modal")).toBe(false);

  await app.keyboard.press("mod+r");
  expect(app.texts()).toContain("Vault synchronized.");

  await app.keyboard.press("mod+,");
  expect(app.shows("id:settings-modal")).toBe(true);
  await app.keyboard.press("escape");
  expect(app.shows("id:settings-modal")).toBe(false);

  await app.keyboard.press("mod+l");
  expect(app.shows("id:auth-view-locked")).toBe(true);

  await app.keyboard.press("mod+g");
  expect(app.shows("id:password-generator-modal")).toBe(false);
});

// ---------------------------------------------------------------------------
// Vault search focus
// ---------------------------------------------------------------------------

test("ctrl+f puts the keyboard in the vault search", async () => {
  const app = await openMock({ phase: "unlocked", items: [LOGIN_ITEM] });

  // Leave the field first, so the shortcut — not a leftover focus — is what
  // puts the keyboard there.
  await app.keyboard.press("mod+,");
  expect(app.shows("id:settings-modal")).toBe(true);
  await app.keyboard.press("escape");
  expect(app.shows("id:settings-modal")).toBe(false);

  await app.keyboard.press("mod+f");
  await app.keyboard.press("g");
  expect(app.value("id:vault-search")).toBe("g");

  // A second Ctrl+F keeps the query; selecting it is the ref's job.
  await app.keyboard.press("mod+f");
  expect(app.value("id:vault-search")).toBe("g");
});

test("ctrl+f stands down while the palette is open", async () => {
  const app = await openMock({ phase: "unlocked", items: [LOGIN_ITEM] });

  await app.keyboard.press("mod+k");
  expect(app.shows("id:action-palette-modal")).toBe(true);

  // Give the palette's filter the keyboard, as a click on it would.
  await app.type("id:action-palette-search", "");
  await app.keyboard.press("mod+f");
  await app.keyboard.press("g");
  expect(app.value("id:vault-search")).toBe("");
  expect(app.value("id:action-palette-search")).toBe("g");
});

test("the palette lists Search Vault and runs it", async () => {
  const app = await openMock({ phase: "unlocked", items: [LOGIN_ITEM] });

  await app.keyboard.press("mod+k");
  expect(app.texts()).toContain("Search Vault");
  expect(app.texts()).toContain("Ctrl+F");

  await app.type("id:action-palette-search", "search vault");
  await app.keyboard.press("enter");
  expect(app.shows("id:action-palette-modal")).toBe(false);

  await app.keyboard.press("g");
  expect(app.value("id:vault-search")).toBe("g");
});

test("unlocking puts the keyboard in the vault search", async () => {
  const app = await openMock({
    phase: "locked",
    email: "vault@example.com",
    serverUrl: "https://vault.example.com",
    quickUnlockReady: true,
  });

  await app.press("id:quick-unlock");
  expect(app.shows("id:vault-workspace")).toBe(true);

  await app.keyboard.press("g");
  expect(app.value("id:vault-search")).toBe("g");
});

test("the minimum window gate takes the keyboard out of the vault search", async () => {
  const app = await openMock({ phase: "unlocked", items: [LOGIN_ITEM] });

  await app.setViewport(800, 600);
  expect(app.shows("id:minimum-window-gate")).toBe(true);
  await app.keyboard.press("g");
  expect(app.value("id:vault-search")).toBe("");

  await app.setViewport(1440, 960);
  expect(app.shows("id:minimum-window-gate")).toBe(false);
  await app.keyboard.press("g");
  expect(app.value("id:vault-search")).toBe("g");
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

test("settings modal exposes general, appearance, security, diagnose, and about tabs", async () => {
  const app = await openMock({
    phase: "unlocked",
    items: [LOGIN_ITEM],
    settings: {
      serverUrl: "https://vault.example.com",
      identityUrl: "https://identity.example.com",
      autoLockMinutes: 15,
      clipboardClearSeconds: 30,
      quickUnlock: true,
      sshAgentEnabled: false,
      sshAgentConfirm: "firstUse",
    },
  });

  await app.press("id:open-settings");
  expect(app.shows("id:settings-modal")).toBe(true);
  expect(app.shows("id:settings-general")).toBe(true);
  expect(app.value("id:settings-server-url")).toBe("https://vault.example.com");
  expect(app.value("id:settings-identity-url")).toBe("https://identity.example.com");

  await app.press("id:settings-tab-appearance");
  expect(app.shows("id:settings-appearance")).toBe(true);
  expect(app.shows("id:settings-theme-dark")).toBe(true);
  expect(app.shows("id:settings-text-size")).toBe(true);

  await app.press("id:settings-tab-security");
  expect(app.shows("id:settings-security")).toBe(true);
  expect(app.value("id:settings-auto-lock")).toBe("15");
  expect(app.value("id:settings-clipboard-timeout")).toBe("30");
  await app.press("id:settings-policy-always");
  await app.press("id:settings-quick-unlock");
  await app.press("id:settings-save");
  expect(app.texts()).toContain("Settings saved.");

  await app.press("id:settings-tab-diagnose");
  expect(app.shows("id:settings-diagnose")).toBe(true);
  expect(app.shows("id:health-check-0")).toBe(true);
  expect(app.texts()).toContain("https://vault.example.com");
  await app.press("id:refresh-health");
  await app.press("id:copy-diagnostics");
  expect(app.texts()).toContain("Copied diagnostic report to clipboard.");

  await app.press("id:settings-tab-about");
  expect(app.shows("id:settings-about")).toBe(true);
  expect(app.shows("id:about-app-version")).toBe(true);
  expect(app.shows("id:about-engine-version")).toBe(true);
  expect(app.shows("id:about-memory")).toBe(true);
  expect(app.shows("id:check-updates")).toBe(true);
  expect(app.shows("id:view-release-notes")).toBe(true);

  await app.press("id:check-updates");
  expect(app.texts()).toContain("You are running the latest version.");

  await app.press("id:view-release-notes");
  expect(app.shows("id:release-notes-modal")).toBe(true);
  expect(app.texts()).toContain(
    "You are running the latest version. No newer release notes are available.",
  );
});

test("settings scrolls to the lower rows at the minimum window size", async () => {
  const app = await openMockAt(900, 620, { phase: "unlocked", items: [LOGIN_ITEM] });

  await app.press("id:open-settings");
  expect(app.shows("id:settings-modal")).toBe(true);

  // The panel is taller than a 620-point window, so the body has a bounded
  // scroll range and reaches its end. A body sized to its content has no
  // range at all: the drag is refused outright, which leaves the lower rows
  // unreachable however far the user drags.
  await app.scroll("id:settings-modal", 5000);
  await expect(app.scroll("id:settings-modal", 100)).rejects.toThrow();
  await app.scroll("id:settings-modal", -5000);
});

test("appearance preferences get a tab of their own", async () => {
  const app = await openMock({ phase: "unlocked", items: [LOGIN_ITEM] });

  await app.press("id:open-settings");
  // How the app looks is not part of the connection form.
  expect(app.shows("id:settings-theme-dark")).toBe(false);
  expect(app.shows("id:settings-text-size")).toBe(false);

  await app.press("id:settings-tab-appearance");
  expect(app.shows("id:settings-appearance")).toBe(true);
  expect(app.shows("id:settings-theme-dark")).toBe(true);
  expect(app.shows("id:settings-theme-light")).toBe(true);
  expect(app.shows("id:settings-text-size")).toBe(true);
});

test("settings switches between dark and light themes", async () => {
  const app = await openMock({ phase: "unlocked", items: [LOGIN_ITEM] });

  await app.press("id:open-settings");
  await app.press("id:settings-tab-appearance");
  expect(app.shows("id:settings-theme-dark")).toBe(true);

  await app.press("id:settings-theme-light");
  expect(app.texts()).toContain("Theme: Light");

  // A reload starts a fresh app over the process-wide mock preferences, the
  // same way a real launch reads `ui.json`; the theme must come back.
  const reloaded = await open("./App.tsx", {
    width: 1440,
    height: 960,
    platform: "linux",
    host: { params: { mock: true } },
  });
  expect(reloaded.texts()).toContain("Theme: Light");

  await reloaded.press("id:open-settings");
  await reloaded.press("id:settings-tab-appearance");
  await reloaded.press("id:settings-theme-dark");
  expect(reloaded.texts()).toContain("Theme: Dark");
});

test("settings browse buttons fill the download and certificate paths", async () => {
  const app = await openMock({ phase: "unlocked", items: [LOGIN_ITEM] });

  await app.press("id:open-settings");
  await app.press("id:settings-download-browse");
  expect(app.value("id:settings-download-dir")).toBe("/tmp/omawarden-mock/folder");

  await app.press("id:settings-tab-security");
  await app.press("id:settings-client-cert-browse");
  expect(app.value("id:settings-client-cert")).toBe("/tmp/omawarden-mock/client.pem");
  await app.press("id:settings-client-key-browse");
  expect(app.value("id:settings-client-key")).toBe("/tmp/omawarden-mock/client.pem");
});

// ---------------------------------------------------------------------------
// Text size
// ---------------------------------------------------------------------------

test("text size scales the type and saves the factor", async () => {
  // A 1440 × 960 window fits at 100%, so enlarging the text must not gate it:
  // the drag has to stay usable all the way to 200%.
  const app = await openMock({
    phase: "unlocked",
    items: [LOGIN_ITEM],
  });

  await app.press("id:open-settings");
  await app.press("id:settings-tab-appearance");
  expect(app.shows("id:settings-text-size")).toBe(true);
  expect(app.texts()).toContain("100%");

  // The thumb sits at 100%; 200 points of drag is 200% on this track.
  await app.drag("label:Text size", { x: 200, y: 0 });

  expect(app.texts()).toContain("200%");
  // `type().base` is 12 points at 100%, so it doubles at 200%.
  expect(app.spanStyle("id:settings-text-size-value >> text:200%").fontSize).toBe(24);
  expect(OmawardenBridge.getUiPrefs().fontScale).toBe(2);
});

test("text size writes once after the slider settles", async () => {
  const app = await openMockWithClock({ phase: "unlocked", items: [LOGIN_ITEM] });

  await app.press("id:open-settings");
  await app.press("id:settings-tab-appearance");
  await app.dragAndHold("label:Text size", { x: 200, y: 0 });

  // The drag re-renders as it goes, but nothing reaches the preferences file
  // until the change ends.
  expect(app.texts()).toContain("200%");
  expect(OmawardenBridge.getUiPrefs().fontScale).toBe(1);

  await app.drop();
  expect(OmawardenBridge.getUiPrefs().fontScale).toBe(2);

  // The pending write was cancelled by the flush, so the clock moves on
  // without a second one.
  await app.clock!.runFor(1000);
  expect(OmawardenBridge.getUiPrefs().fontScale).toBe(2);
});

test("settings stays usable at 400% in a minimum window", async () => {
  const app = await openMockAt(900, 620, {
    phase: "unlocked",
    items: [LOGIN_ITEM],
    uiPrefs: { fontScale: 4 },
  });

  await app.press("id:open-settings");
  expect(app.shows("id:settings-modal")).toBe(true);
  // The header keeps its subtitle and its close control at four times the base
  // size, and the body still scrolls, so nothing strands the user.
  expect(app.texts()).toContain(
    "Configuration, appearance, security, diagnostics, and release information.",
  );
  await app.scroll("id:settings-modal", 5000);
  await app.press("id:modal-close");
  expect(app.shows("id:settings-modal")).toBe(false);
});

test("release notes load when an update is available", async () => {
  const app = await openMock({
    phase: "unlocked",
    items: [LOGIN_ITEM],
    updateAvailable: true,
  });

  await app.press("id:open-settings");
  await app.press("id:settings-tab-about");
  await app.press("id:check-updates");
  expect(app.texts()).toContain("Latest: 0.4.0");

  await app.press("id:modal-close");
  expect(app.shows("id:update-badge")).toBe(true);

  await app.press("id:update-badge");
  expect(app.shows("id:release-notes-modal")).toBe(true);
  expect(app.shows("id:release-notes-content")).toBe(true);
  expect(app.texts()).toContain("Omawarden 0.4.0");
  expect(app.texts()).toContain("v0.4.0");
  expect(app.shows("id:open-release-page")).toBe(true);

  await app.press("id:open-release-page");
  await app.press("id:release-notes-close");
  expect(app.shows("id:release-notes-modal")).toBe(false);
});

// ---------------------------------------------------------------------------
// SSH key modal
// ---------------------------------------------------------------------------

test("SSH key modal previews, reveals, copies, and saves a generated key", async () => {
  const app = await openMock({ phase: "unlocked", items: [LOGIN_ITEM] });

  await app.press("id:category-sshKey");
  await app.press("id:open-ssh-key");
  expect(app.shows("id:ssh-key-modal")).toBe(true);
  expect(app.shows("id:ssh-create-panel")).toBe(true);
  expect(app.shows("id:ssh-algorithm-ed25519")).toBe(true);
  expect(app.shows("id:ssh-algorithm-rsa-2048")).toBe(true);
  expect(app.shows("id:ssh-algorithm-ecdsa-p256")).toBe(true);

  await app.press("id:ssh-preview");
  expect(app.shows("id:ssh-key-preview")).toBe(true);
  expect(app.texts()).toContain("Ready");

  await app.press("id:ssh-reveal-private");
  expect(app.texts().join("\n")).toContain("-----BEGIN OPENSSH PRIVATE KEY-----");

  await app.press("id:ssh-copy-public-key");
  expect(app.texts()).toContain("Copied public key to clipboard.");

  await app.press("id:ssh-save");
  expect(app.shows("id:ssh-key-modal")).toBe(false);
  expect(app.texts()).toContain("Saved SSH key to the vault.");
});

test("SSH key modal rejects an invalid imported key and blocks empty export", async () => {
  const app = await openMock({ phase: "unlocked", items: [LOGIN_ITEM] });

  await app.press("id:category-sshKey");
  await app.press("id:open-ssh-key");
  await app.press("id:ssh-mode-import");
  expect(app.shows("id:ssh-private-key-input")).toBe(true);
  expect(app.enabled("id:ssh-save")).toBe(false);

  await app.type("id:ssh-private-key-input", "not a private key");
  expect(app.enabled("id:ssh-save")).toBe(true);

  await app.press("id:ssh-preview");
  expect(app.shows("id:ssh-key-preview")).toBe(true);
  expect(app.texts()).toContain("Failed");

  await app.press("id:ssh-save");
  expect(app.shows("id:ssh-key-modal")).toBe(true);
  expect(app.texts()).toContain("Could not prepare the SSH key.");

  await app.press("id:ssh-mode-export");
  expect(app.shows("id:ssh-export-panel")).toBe(true);
  expect(app.shows("id:ssh-export-empty")).toBe(true);
  expect(app.enabled("id:ssh-export-save")).toBe(false);
});

test("SSH key modal imports a key file and picks an export directory", async () => {
  const app = await openMock({ phase: "unlocked", items: [LOGIN_ITEM] });

  await app.press("id:category-sshKey");
  await app.press("id:open-ssh-key");
  await app.press("id:ssh-mode-import");
  await app.press("id:ssh-import-browse");
  expect(app.value("id:ssh-private-key-input")).toContain("BEGIN OPENSSH PRIVATE KEY");

  await app.press("id:ssh-mode-export");
  expect(app.value("id:ssh-export-dir")).toBe("~/.ssh");
  await app.press("id:ssh-export-dir-browse");
  expect(app.value("id:ssh-export-dir")).toBe("/tmp/omawarden-mock/folder");
});

// ---------------------------------------------------------------------------
// SSH approval
// ---------------------------------------------------------------------------

test("SSH approval shows forwarded warnings and resolves a request", async () => {
  const app = await openMock({
    phase: "unlocked",
    items: [SSH_ITEM],
    sshPrompt: {
      id: 42,
      title: "Sign a Git commit?",
      action: "SSH login as git@github.com",
      keyName: "GitHub",
      fingerprint: "SHA256:abcdefghijklmnop",
      client: "git (ssh)",
      command: "git push origin main",
      forwarded: true,
      remembered: false,
      remaining: 2,
    },
  });

  expect(app.shows("id:ssh-approval-modal")).toBe(true);
  expect(app.shows("id:ssh-forwarded-warning")).toBe(true);
  expect(app.texts()).toContain("Sign a Git commit?");
  expect(app.texts()).toContain("2 more requests queued.");

  await app.press("id:ssh-approve");
  expect(app.shows("id:ssh-approval-modal")).toBe(false);
  expect(app.texts()).toContain("SSH request approved.");
});

test("SSH approval denies a request and handles a summon payload", async () => {
  const app = await openMock(
    { phase: "locked" },
    { payload: { view: "ssh-approval", id: 7 } },
  );

  expect(app.shows("id:vault-workspace")).toBe(true);
  expect(app.shows("id:ssh-approval-modal")).toBe(true);

  await app.press("id:ssh-deny");
  expect(app.shows("id:ssh-approval-modal")).toBe(false);
  expect(app.texts()).toContain("SSH request denied.");
});

// ---------------------------------------------------------------------------
// Minimum window gate
// ---------------------------------------------------------------------------

test("a large text size never makes a fitting window too small", async () => {
  // 900 × 620 is exactly the floor, and the floor does not move with the text
  // size: 400% has to fit as well as 100% does.
  const app = await openMockAt(900, 620, {
    phase: "unlocked",
    items: [LOGIN_ITEM],
    uiPrefs: { fontScale: 4 },
  });

  expect(app.shows("id:minimum-window-gate")).toBe(false);
  expect(app.texts()).not.toContain("Window too small");

  await app.press("id:open-settings");
  await app.press("id:settings-tab-appearance");
  expect(app.texts()).toContain("400%");
  // The dialog still scrolls at 400% in a minimum window, so every row stays
  // reachable even though the text is four times its base size.
  await app.scroll("id:settings-modal", 300);

  // The reporter's case: a 4K display at 2× is 1920 × 1080 points, and 400%
  // used to demand 3600 × 2480 there.
  await app.setViewport(1920, 1080);
  expect(app.shows("id:minimum-window-gate")).toBe(false);
});

test("the window floor does not follow the text size", async () => {
  const app = await openMock({
    phase: "unlocked",
    items: [LOGIN_ITEM],
    uiPrefs: { fontScale: 4 },
  });

  // 400% does not raise the floor: the same 900 × 620 gate applies, and only
  // a resize clears it.
  await app.setViewport(800, 600);
  expect(app.shows("id:minimum-window-gate")).toBe(true);
  expect(app.texts()).toContain("Minimum: 900 × 620");

  await app.setViewport(900, 620);
  expect(app.shows("id:minimum-window-gate")).toBe(false);
});

test("minimum window gate covers a too-small window and clears when it grows", async () => {
  const app = await openMock({ phase: "unlocked", items: [LOGIN_ITEM] });

  expect(app.shows("id:minimum-window-gate")).toBe(false);

  await app.setViewport(800, 600);
  expect(app.shows("id:minimum-window-gate")).toBe(true);
  expect(app.shows("id:minimum-window-gate-size")).toBe(true);
  expect(app.texts()).toContain("Window too small");
  expect(app.texts()).toContain("Current size: 800 × 600");
  expect(app.texts()).toContain("Minimum: 900 × 620");
  expect(app.texts()).toContain("Resize the window to continue.");
  expect(app.shows("id:vault-workspace")).toBe(true);

  await app.setViewport(850, 650);
  expect(app.shows("id:minimum-window-gate")).toBe(true);
  expect(app.texts()).toContain("Current size: 850 × 650");

  await app.setViewport(900, 620);
  expect(app.shows("id:minimum-window-gate")).toBe(false);

  await app.setViewport(1440, 960);
  expect(app.shows("id:minimum-window-gate")).toBe(false);
  expect(app.shows("id:vault-workspace")).toBe(true);
});

test("minimum window gate leaves the keyboard inert", async () => {
  const app = await openMock({ phase: "unlocked", items: [LOGIN_ITEM] });

  await app.setViewport(800, 600);

  await app.keyboard.press("mod+k");
  expect(app.shows("id:action-palette-modal")).toBe(false);

  await app.keyboard.press("mod+,");
  expect(app.shows("id:settings-modal")).toBe(false);

  await app.keyboard.press("tab");
  await app.keyboard.press("space");
  expect(app.shows("id:item-inspector")).toBe(false);

  await app.setViewport(1440, 960);
  await app.keyboard.press("mod+k");
  expect(app.shows("id:action-palette-modal")).toBe(true);

  await app.setViewport(800, 600);
  await app.keyboard.press("down");
  await app.keyboard.press("enter");
  expect(app.shows("id:minimum-window-gate")).toBe(true);
  expect(app.shows("id:action-palette-modal")).toBe(true);
  expect(app.texts()).not.toContain("Copied password to clipboard (clears in 30s).");

  await app.setViewport(1440, 960);
  expect(app.shows("id:minimum-window-gate")).toBe(false);
  await app.keyboard.press("enter");
  expect(app.shows("id:action-palette-modal")).toBe(false);
  expect(app.texts()).toContain("Copied password to clipboard (clears in 30s).");
});

test("minimum window gate covers the app when it starts too small", async () => {
  const app = await open("./App.tsx", {
    width: 800,
    height: 600,
    platform: "linux",
    host: { params: { mock: true, mockState: { phase: "login" } } },
  });

  expect(app.shows("id:minimum-window-gate")).toBe(true);
  expect(app.texts()).toContain("Current size: 800 × 600");
  expect(app.shows("id:auth-view-login")).toBe(true);
});

test("minimum window gate leaves form input and open dialogs mounted", async () => {
  const app = await openMock({ phase: "login" });

  await app.type("id:login-password", "half-typed");
  await app.keyboard.press("mod+,");
  expect(app.shows("id:settings-modal")).toBe(true);

  await app.setViewport(800, 600);
  expect(app.shows("id:minimum-window-gate")).toBe(true);

  await app.keyboard.press("escape");
  expect(app.shows("id:settings-modal")).toBe(true);

  await app.setViewport(1440, 960);
  expect(app.shows("id:minimum-window-gate")).toBe(false);
  expect(app.shows("id:settings-modal")).toBe(true);
  expect(app.value("id:login-password")).toBe("half-typed");
});

// ---------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------

test("footer shows shortcut hints, theme, and engine version", async () => {
  const app = await openMock({ phase: "unlocked", items: [LOGIN_ITEM] });

  expect(app.shows("id:footer-bar")).toBe(true);
  expect(app.shows("id:open-actions")).toBe(true);
  expect(app.shows("id:open-generator")).toBe(true);
  expect(app.shows("id:sync-vault")).toBe(true);
  expect(app.shows("id:lock-vault")).toBe(true);
  expect(app.shows("id:open-settings")).toBe(true);
  expect(app.texts()).toContain("Ctrl+K");
  expect(app.texts()).toContain("Ctrl+,");
  expect(app.texts()).toContain("Theme: Dark");
  expect(app.texts()).toContain("Engine 0.4.0");
});
