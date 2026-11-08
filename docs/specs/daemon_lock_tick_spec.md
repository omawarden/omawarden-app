# Omawarden App: Daemon Lock Tick Specification

> **Target Repository**: `omawarden/omawarden-app`
> **Status**: Ready for Implementation
> **Primary Goal**: Make a daemon-side lock reach the interface within two
> seconds, so a locked vault cannot be copied from.

---

## Problem Statement

The daemon locks the vault on its own timer. The app never learns about it.

`real_tick` (`src/daemon.rs:106`) already asks the daemon for status, and already
calls `vault::clear_cached_vault()` when the answer is `unlocked: false`
(`src/daemon.rs:159-161`). The bridge exposes that as `poll_daemon_tick`
(`src/lib.rs:985`). Nothing in the interface calls it.

The only timers in `store/appStore.ts` are the TOTP ticker
(`setInterval(tickTotp, 1000)`, line 973) and the FIDO2 poller. Neither reads the
daemon's lock state.

So the sequence is:

1. The vault has been idle for the daemon's auto-lock period.
2. The daemon locks and drops the user key.
3. The app still shows the unlocked vault, with every password in `CachedVault`.
4. The user presses copy. `real_copy_cipher_field` (`src/clipboard.rs:114`)
   serves the secret from the cache and the clipboard fills.

The copy succeeds after the vault is locked. That is the defect this spec closes.
It is not a memory question: the same cache is what makes the failure silent.

## Solution

While the app is unlocked, a two-second timer asks the daemon whether it is still
unlocked. When the answer is no, the app applies a fresh snapshot, which moves it
to the locked screen and clears the cache. The next copy finds no cache, falls
through to the daemon (`src/clipboard.rs:122`), and fails with the daemon's own
message.

Two seconds is the upper bound on how long a locked vault stays readable from the
interface. The tick costs two local round-trips every two seconds, and it touches
nothing, so it cannot postpone the lock it is watching for.

## User Stories

1. As a user whose vault locks itself after a period of inactivity, I want the app
   to show the locked screen within a couple of seconds, so that I am not typing
   into a window that is no longer unlocked.
2. As a user who presses copy after the vault has locked, I want a clear error
   instead of a password that should no longer be available.
3. As a user, I want the lock to arrive without touching anything and without the
   app restarting.
4. As a user whose daemon has stopped, I want the interface to stay as it is,
   because a missing daemon is not a lock.
5. As a maintainer, I want one transition into the locked screen, shared with the
   explicit lock, so that the two cannot drift.
6. As a maintainer, I want the daemon's lock to reach the interface through an
   existing bridge call, so that the fix does not invent a second status path.

## Implementation Decisions

### 1. A two-second tick, only while unlocked

`store/appStore.ts` gains `syncLockTicker()`, next to `syncTotpTicker()`
(line 969), called at the end of `applySnapshot` (line 493) where the new phase
is already set:

- `phase() === "unlocked"` and no timer → `setInterval(tickDaemon, 2000)`.
- any other phase → clear the timer.

`tickDaemon` calls `OmawardenBridge.pollDaemonTick(null)`.

The argument is the active cipher id, which `real_tick` uses only to compute a
TOTP code (`src/daemon.rs:127`). Passing `null` skips that round-trip, because
this spec does not read the code; the TOTP ticker refreshes it on its own
schedule.

Only `online` and `unlocked` are read. `quick_unlock_ready`, `ssh_prompt`,
`ssh_pending_count` and `totp` on `DaemonTickView` stay unused until their own
spec.

### 2. A lock is handled by re-reading the snapshot

When `online && !unlocked`, the tick does what `lockOrLogout` does minus the
daemon call (`store/appStore.ts:850-861`):

```
applySnapshot(OmawardenBridge.boot(null));
selectedIndex.set(0);
activeModal.set("none");
```

`boot(null)` is the path the app already takes at start-up, and its real branch
is `vault::real_snapshot` (`src/vault.rs:195`), which reads the daemon's status,
returns `AppPhase::Locked`, and calls `clear_cached_vault()` itself
(`src/vault.rs:297-299`). Reusing it is the point: `applySnapshot` already stops
the TOTP ticker, drops the inspector and clears action focus when the phase
leaves `unlocked` (`store/appStore.ts:506-511`, `536-538`). A second hand-written
cleanup would be a second thing to keep in step.

The two extra calls cover what `applySnapshot` leaves alone: the selection and an
open modal, which would otherwise sit on top of the locked screen.

`boot(null)` does not start a daemon: `real_snapshot` never calls
`ensure_app_daemon_running` (`src/lib.rs:842`).

There is no toast. The screen changes without a user action, and a toast raised
when the lock happened would be stale by the time the user looks at the window.
The locked screen is the notice.

### 3. `!online` is not a lock

When the daemon is gone, the tick returns `online: false` with an error
(`src/daemon.rs:109-117`). The tick then does nothing: no snapshot, no phase
change, no cleanup. A daemon that exited is not evidence that the session ended,
and reacting to it would fight the daemon's own idle exit. Copy, inspect and TOTP
already report the missing daemon in place.

### 4. One tick in flight

`poll_daemon_tick` is synchronous and blocks the script thread for its
round-trips. A module-level flag drops a tick that arrives while the previous one
is still running, so a slow daemon cannot queue work behind itself.

### 5. The tick never counts as activity

`real_tick` already sends `touch: false` on all three requests it makes
(`src/daemon.rs:107`, `120`, `128`), and `real_copy_cipher_field` already does the
same on its fallback (`src/clipboard.rs:123`). Both are invariants now, not
details: a tick that touched would keep the vault alive forever, and a copy that
touched would postpone the lock that is about to make it fail.

### 6. The mock adapter can report an offline daemon, and counts its ticks

`mock_tick` (`src/daemon.rs:177`) always answers `online: true`. `MockState`
(`src/lib.rs:251`) gains two fields: `daemon_online`, defaulting to `true`, so the
`!online` branch is reachable from the test harness instead of only from a machine
with no daemon running; and `daemon_ticks`, incremented on every answer, exposed
as `OmawardenBridge::mock_daemon_ticks` so a test can see the timer stop.

The counter exists because nothing on screen shows it. The lock handler is
idempotent, so a timer that kept polling a locked vault would look exactly like
one that stopped.

## Testing Decisions

**UI, lock observed (`App.test.tsx`).** Seed the mock unlocked with one item,
select it, then re-configure the mock state with `phase: "locked"`. After
`app.wait(2000)`: the locked screen is shown, the row is gone and the inspector is
gone. Nothing is left to copy, which is the property this spec delivers — the
secret is not reachable because the item is not on screen any more.

**UI, offline is not a lock.** Seed `daemonOnline: false` while unlocked and wait
two seconds. The row and the inspector are unchanged.

**UI, ticker stopped.** After the lock, `mockDaemonTicks()` reads one; six more
seconds leave it at one. Without the counter this is invisible, because the lock
handler is idempotent and a timer that kept polling would look the same.

**Manual, not a gate.** Set the daemon's auto-lock to 30 seconds, unlock, wait,
and watch the screen change without touching the app; then press copy and confirm
the failure.

## Out of Scope

- Removing `Vec<VaultItem>` from `CachedVault`. That is the deferred half, and
  `docs/specs/secret_locality_spec.md` records why it is deferred and what it
  would cost.
- Driving SSH approval prompts from the tick.
- Refreshing the TOTP code from the tick.
- Noticing a lock while the app is on the login or two-factor screen; there is
  nothing to clear there.
- Changing the daemon's auto-lock period, which belongs to the engine.

## Further Notes

**What this closes, and what it does not.** A locked vault stops being readable
from the interface within two seconds, which is the difference between a lock
that holds and one that does not. The secrets are still in the UI process while
the vault is unlocked; that is the other spec's subject, and its measurements are
recorded there.

**Why two seconds.** Fast enough that a user who steps away and comes back gets
an error instead of a password, slow enough that the daemon sees two local
requests every two seconds. The number is not tuned against a measurement,
because there is nothing to measure: the cost is two round-trips on a socket that
is already open.

**Why this ships first.** The cache removal in the other spec is only worth its
risk once the daemon stops sending plaintext on every cold path. This one is
small, it fixes a defect that exists today, and it does not depend on that work
landing.
