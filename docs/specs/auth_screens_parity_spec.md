# Omawarden App: Auth & Dependency Screens Match the Plugin

> **Target Repository**: `omawarden/omawarden-app`
> **Status**: Ready for Implementation
> **Primary Goal**: Rebuild the first-run, server-configuration, login, two-factor and lock screens on the plugin's layout, so the app looks like the plugin it was ported from.

---

## Problem Statement

The app's `AuthView.tsx` and `DependencyCheckView.tsx` were ported from `omarchy-bitwarden`'s `AuthView.qml` and `DependencyCheckView.qml` in behaviour but not in layout. Side by side they read as two different products:

- **Dependency check.** The plugin draws a wrench glyph, `System Dependencies Required`, a `Prerequisite Setup` badge and a paragraph, then status-tinted cards (green when installed, red when missing) with a state dot, a package tag, a version, the description and a `✓ Ready` / `✗ Missing` / `⏳ Checking` pill, then `↻ Recheck` and one full-width install button that spells the state. The app draws a plain `System Dependencies` heading, neutral panels with a `Required`/`Optional` chip, and three buttons, one of which (`Continue`) the plugin does not have.
- **Login.** The plugin is a flat centred column (max 360) with a key glyph, `Log In to Bitwarden`, the server URL and a `Server` chip that opens an inline `SERVER & mTLS CLIENT CERTIFICATE` panel (server URL, official-server note, mTLS toggle, certificate and key paths, `Save & Apply`, `Reset to Official`). The app puts a wordmark above a bordered card (max 460), moves the server to a footer line behind an `Open Settings (Ctrl+,)` link, and keeps a separate collapsible mTLS card inside the form.
- **Lock.** The plugin shows a lock glyph, `Vault is Locked`, `Logged in as <email>`, the master-password field, the quick-unlock button **above** `Unlock Vault`, and a right-aligned `Log out from account` link. The app shows the email and server URL inside a card, the primary button first, the quick-unlock button below with a hint line, and a full `Log Out` button that expands into a confirm row.

## Solution

Rebuild both views on the plugin's layout, using the app's own primitives and type scale. Structural parity, not pixel parity: the arrangement, hierarchy, copy and the states each screen shows come from the plugin; the inputs, buttons, checkboxes and sizes stay the app's (`inputStyle()`, `ActionButton`, `Checkbox`, `Icon`, `store.type()`).

The three app-only behaviours are settled as follows:

- `Continue` goes. The plugin has no skip, and the screen is a prerequisite gate.
- The login screen gets the plugin's inline server panel. The `Open Settings (Ctrl+,)` link and the separate mTLS card go with it; Settings keeps the same fields for the vault view.
- `Log Out` keeps its confirm step. It becomes a right-aligned text button in the plugin's bottom row, and expands into Confirm/Cancel in place.

## User Stories

1. As a user whose system is missing a package, I want the dependency screen to say what is missing in the plugin's words, so that the app and the plugin tell me the same thing.
2. As a user, I want each package card tinted by its state with a status dot and a `✓ Ready` / `✗ Missing` pill, so that I can see the state without reading.
3. As a user, I want one install button whose label carries the state and the missing package names, so that the screen has one obvious action.
4. As a user, I want no `Continue` on that screen, so that a missing required package is not something I can click past.
5. As a user on a self-hosted server, I want to change the server URL and the mTLS certificate before logging in, so that I do not have to find a settings dialog first.
6. As a user on the official server, I want the panel to tell me that client certificates are unnecessary, so that I do not go looking for them.
7. As a user, I want `Save & Apply` to persist the server and the certificate paths, so that the next request already uses them.
8. As a user, I want `Reset to Official` to put the server back to `https://vault.bitwarden.com` and clear the certificate paths, so that I can undo a bad server entry.
9. As a user, I want the login screen to lead with `Log In to Bitwarden` and the server it will talk to, so that I know where my password is going.
10. As a user, I want the lock screen to lead with `Vault is Locked` and the account it belongs to, so that I know which vault I am unlocking.
11. As a user with quick unlock enabled, I want it above the master-password button, so that the cheaper path is the one I reach first.
12. As a user, I want `Log Out` to still ask before it logs me out, so that a stray click does not end my session.
13. As a user, I want the login, two-factor and lock screens to share one centred column and one header, so that moving between them does not move the form.
14. As a maintainer, I want the app-level tests to keep covering login, two-factor, lock and dependency behaviour, so that a layout rewrite cannot quietly drop a flow.

## Implementation Decisions

### One auth shell

`AuthView` renders one flat, centred column — `maxWidth: 360`, the plugin's width — instead of the current 460 and the bordered `Panel`. Each mode renders the same header shape: an accent `Icon` (key, shield or lock), a title (`Log In to Bitwarden`, `Two-Factor Verification`, `Vault is Locked`) and a subtitle. The wordmark goes: the plugin leads with the action, and the app's name already lives in the window title and the footer.

The error banner stays, between the header and the form, because the app surfaces engine errors there and the plugin surfaces them inline.

### Inline server panel

A `Server` chip sits beside the server URL in the login header and toggles the panel, which renders between the header and the method tabs exactly as the plugin's does. It holds:

- the `SERVER & mTLS CLIENT CERTIFICATE` caption,
- a `Server URL:` field,
- the official-server note, or (self-hosted) the mTLS toggle, the `Client Certificate Path (.pem / .crt):` and `Client Private Key Path (optional if merged):` fields with their browse buttons, and the `0600`/`0400` note,
- `Save & Apply` and `Reset to Official`.

`Save & Apply` writes the server URL and the certificate paths in one `updateSettings` call, so the first login already presents the certificate. `Reset to Official` writes `https://vault.bitwarden.com`, clears both paths, and closes the panel. The panel keeps the existing test IDs (`login-mtls-toggle`, `login-mtls-cert`, `login-mtls-cert-browse`, `login-mtls-key`, `login-mtls-key-browse`) and gains `login-server-chip`, `login-server-url`, `login-server-save`, `login-server-reset`.

The draft lives in `store/authForm.ts` beside the other form signals, seeded from the snapshot when the panel opens. `identityUrl` stays a Settings-only field; the plugin has no identity field on this screen either.

### Login

The method tabs move to the centre (the plugin centres them), the field labels gain their colons (`Email:`, `Master Password:`, `Client ID:`, `Client Secret:`), Remember Email stays where it is, and the submit button stays full width with `Log In` / `Logging in…`.

### Lock

`Logged in as <email>` becomes the subtitle. Quick unlock renders **above** `Unlock Vault` and loses its hint line (the label already says what it does). The bottom row is right-aligned: `Log out from account` as a small text button, which expands in place into `Confirm Log Out` / `Cancel`, keeping the existing `logout`, `logout-confirm` and `logout-cancel` test IDs. The server URL line goes; the plugin does not show it here.

### Dependency check

The view keeps its data model (`PackageStatusView`: name, description, required, installed, version) and gains the plugin's presentation:

- header: a wrench-shaped accent glyph — the app's `terminal` icon stands in, since the icon set has no wrench — `System Dependencies Required`, a `Prerequisite Setup` badge, and the plugin's explanatory paragraph in the app's voice,
- cards: background and border tinted by state, a state dot, the package name, a `Required`/`Optional` tag (standing in for the plugin's `AUR:`/`Core System Package` tag, which the app's model does not carry), the installed version, the description, and a `✓ Ready` / `✗ Missing` pill,
- actions: `↻ Recheck` and one full-width install button labelled `⚡ Install Missing Packages (…)` when something is missing, or `✓ All Dependencies Installed` when nothing is,
- footer: the plugin's line about the floating terminal.

`Continue` and the `SectionTitle` summary go. The engine's minimum-version check is out of scope: the app ships its own engine, so there is no separate engine version to floor. The existing test IDs (`dependency-check-view`, `dependency-<name>`, `install-dependencies`, `recheck-dependencies`) stay.

### Two-factor

The screen keeps its own phase — the engine drives it, and folding it into the login form the way the plugin does would change the flow, not the layout. It inherits the shared header and column, and keeps its provider tabs, code field, resend and back control as they are.

## Testing Decisions

One seam: the app-level suite in `App.test.tsx`, where these screens already live. The rewrite updates the assertions that encode the old layout and adds the new paths:

- **Dependency check** — the install button's label carries the state (`⚡ Install Missing Packages (libsecret)` / `✓ All Dependencies Installed`), `Continue` no longer exists, and a missing package still reaches `install-dependencies`.
- **Server panel** — the chip opens it, `login-server-url` starts at the snapshot's URL, `Save & Apply` persists (assert via a following login attempt or the saved toast), and `Reset to Official` writes the official URL and hides the mTLS fields.
- **mTLS** — the existing tests open the panel first; the toggle and both browse buttons still work, and the official server still hides the mTLS fields.
- **Login / two-factor / lock** — the existing flow tests pass unchanged apart from the new entry points; the logout confirm test keeps its three test IDs.

## Out of Scope

- **Inline two-factor inside the login form.** The engine exposes a `twoFactor` phase; merging the two screens changes the flow, not the layout, and belongs in its own ticket.
- **Pixel parity.** The plugin's 32-point fields, 5-point radii and 14-point checkboxes are not copied; the app keeps its own primitives and type scale.
- **An engine minimum version on the dependency screen.** The plugin checks its bundled engine against `0.8.1`; the app ships its own engine.
- **Removing the server fields from Settings.** They stay there for the vault view; the login panel is a second way in, exactly as the plugin has both.
- **The identity URL on the login screen.** It stays a Settings field.

## Further Notes

Facts gathered while designing this:

- The plugin's login column is `Math.min(parent.width - 48, 360)`; the dependency cards tint their background and border with `StatusPalette.tint(state, 0.2 / 0.4)` and sit in a 10-point column.
- The plugin's server panel is `visible: showServerConfig`, toggled by the `Server`/`Close` chip in the login header; the mTLS toggle is `visible: !isOfficialServer`, and the certificate fields additionally require the toggle.
- The plugin saves through `serverConfigSaved(url, cert, key)`; the app's panel writes the same three fields in one `updateSettings` call.
- The plugin's quick-unlock button is `Layout.preferredHeight: 32` and sits above the accent `Unlock Vault`; its logout is a right-aligned `Text` link.
- The app's dependency model has no AUR package name, so the `Required`/`Optional` distinction is the only tag the cards can carry.
