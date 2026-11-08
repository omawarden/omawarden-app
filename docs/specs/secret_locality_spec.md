# Omawarden App: Secret Locality Specification

> **Target Repository**: `omawarden/omawarden-app`
> **Status**: Deferred. The gate is in "Why this is deferred".
> **Primary Goal**: Keep decrypted secrets in the daemon. The UI process keeps
> rows, never the vault.

---

## Problem Statement

The UI process caches the whole decrypted vault for the length of an unlocked
session.

`real_snapshot` calls `real_items()` (`src/vault.rs:123`), which sends
`{"action":"list"}` to the daemon and deserializes the reply into
`Vec<VaultItem>`. That type carries `login.password`, `login.totp`,
`card.number`, `card.code`, `notes`, `identity`, `fields` and `search_text`. The
vector is stored in the process-global `CachedVault` (`src/vault.rs:139`) and
survives until something clears it.

Three readers serve secrets from that copy:

- `src/clipboard.rs:117` — copying a password, TOTP, card number or CVV.
- `src/inspector.rs:259` — building the inspector for the selected item.
- `src/inspector.rs:300` — refreshing the live TOTP code.

The consequences are:

1. **Residency.** The UI heap grows with the vault, not with what is on screen.
   `CachedVault.rows` already carries everything the list renders; `items` is a
   second representation of the same data, with the secrets still attached. At
   1049 items that second representation measured 3.4 MB in the first round — an
   upper bound until the delta is re-taken — and it stays there for the length of
   the session, which means it is what a core dump, a swap file or a read of
   `/proc/<pid>/mem` would find.
2. **Blast radius.** The UI process is the one running QuickJS, parsing
   attachments and handing strings to GTK for display. Every password in the
   vault sits in that process's heap, so any read primitive there reaches all of
   them without waiting for anything.
3. **A second representation.** `rows` and `items` describe the same vault, and a
   new reader added against `items` cannot be spotted from `rows`. The list, the
   inspector and the clipboard each pick one of the two today.

`parse_items` also materializes a second full copy through `value.clone()`
(`src/projection.rs:67`). That copy is in scope here only because removing
`Vec<VaultItem>` removes it as a side effect.

The lock hole that used to be the third consequence now has its own spec
(`docs/specs/daemon_lock_tick_spec.md`). It ships first, it does not depend on
this one, and this one does not depend on it.

## Solution

`CachedVault` keeps rows and scalars. Secrets live in the daemon; the UI fetches
one item at a time and drops it when the call returns.

Rows are projected straight from the daemon's JSON, so `Vec<VaultItem>` is never
constructed in the UI process at all — not on the cold path, not in the cache.

This is a residency change, not an isolation change. The daemon's `list` action
still returns plaintext, so a cold path still carries the whole vault through the
UI process before the projection drops it. Closing that gap needs a metadata-only
list in the engine, which is why this spec is deferred until it exists.

## User Stories

1. As a user with a large vault, I want the app's memory to depend on what I am
   looking at, not on how many items I have saved.
2. As a user, I want copying a password to keep working after the change, with
   the same toast and the same clipboard TTL.
3. As a user, I want the inspector to keep showing the same fields, the same
   masked card number and the same live TOTP code.
4. As a user who types in the search box while an item is selected, I do not want
   the app to re-read that item on every keystroke.
5. As a user with an item that has no TOTP configured, I want the code area to
   say so and stop ticking, rather than retrying forever.
6. As a user whose daemon is not running, I want copy, the inspector and the TOTP
   area to each say so in place, without the app crashing or silently doing
   nothing.
7. As a maintainer, I want one representation of the vault in the UI process, so
   that a new reader cannot quietly reintroduce a second one.
8. As a maintainer, I want the cache's shape enforced by the compiler, so that
   "keep secrets out of the UI process" is a property of the type rather than a
   convention in review.
9. As a maintainer, I want the hot-path contract in `GLOSSARY.md` to match the
   code, so that the next reader is not told to serve decryption from a cache
   that no longer holds it.

## Why this is deferred

The measurements are in "Baseline Measurements" below. Read together, they say
this:

- The second representation costs the UI process 3.4 MB of malloc heap at 1049
  items, about 3.3 KB per item. That is the first-round figure and it is an upper
  bound; the delta it comes from has not been re-taken, so the share of the
  process it accounts for is not known either.
- Removing it does not remove the row list, which the first round put at the
  larger part of the anonymous growth between the locked and unlocked screens.
  That split is structural, not measured: the row list survives either way.
- The blast-radius win is real but partial. `list` still returns plaintext on
  every cold path, and the bridge is reachable from the script the UI process
  runs, so a reader there can trigger a cold path and see the vault pass through.
  The residency window shrinks from the length of the session to the few hundred
  milliseconds a cold path takes. That is worth something — it is the difference
  between what a core dump contains and what it does not — but it is not the
  isolation the title suggests.
- The change is not small. It rewrites the projection, changes `CachedVault`, and
  moves three readers onto a round-trip each. It needs the seven decisions below
  and their tests.

Either of these reopens it:

1. The engine ships a metadata-only `list`, so the UI process stops receiving
   secrets on cold paths. At that point the app-side half becomes the other half
   of a real isolation, instead of a residency improvement that a cold path can
   undo.
2. The vault reaches the ten-thousand-item scale, where the first-round figure of
   3.3 KB per item is about 33 MB and the memory argument stands on its own —
   subject to the same re-measurement, which at that scale would be worth doing
   anyway.

Neither has happened. The lock tick ships without this, and the numbers above are
what the next reader should check before deciding to start.

## Implementation Decisions

### 1. `CachedVault` holds rows, not items

`CachedVault` (`src/vault.rs:131-142`) loses `items: Vec<VaultItem>` and
`reprompts: HashMap<String, u32>`. It keeps the scalars and `rows:
Vec<CipherRowView>`.

`reprompts` becomes redundant: `row_from_json` reads `reprompt` from the same
JSON entry, and `CipherRowView.reprompt` (`src/types.rs:219`) already carries it
for the TS `repromptRequired` computed (`store/appStore.ts:321`). The
`InspectorView.reprompt` value comes from the `get_item` reply, which the daemon
path already reads (`src/inspector.rs:281-284`).

`CachedVault::item()` and `CachedVault::reprompt()` are deleted. `real_snapshot`
stores only `rows` and the scalars.

### 2. Rows are projected from JSON

`parse_items` (`src/projection.rs:56`) changes from
`(Vec<VaultItem>, HashMap<String, u32>)` to `Vec<CipherRowView>`.

A new `row_from_json(entry: &Value) -> Option<CipherRowView>` reads exactly the
fields `row_from_item` reads today (`src/projection.rs:73-131`):

- `id`, `name`, `sub_title`, `type_name`, `type`, `favorite`
- `attachments` length
- `organization_name`, `folder_name`
- `login.totp` presence (non-empty after trim)
- `login.passwordHistory` presence (non-empty array)
- `login.uris[].uri`
- `card.brand`, and `card.number` through `mask_card_number_for`
- `ssh_key` presence, or `type == 5`, for the SSH-key category
- `reprompt`

`category_of` takes `(item_type: i64, has_ssh_key: bool)` instead of
`&VaultItem`. Both callers pass scalars: `row_from_json` from the JSON entry, and
`vault_item_inspector` (`src/inspector.rs:558`) from the fetched item.

`row_from_item` is deleted once nothing calls it. The mock adapter builds its
rows from `MockItem` through `MockItem::row` (`src/lib.rs:489`), so it does not
need it.

After this, `VaultItem` is not imported by `src/vault.rs` or
`src/projection.rs`. It remains only in `src/clipboard.rs` and `src/inspector.rs`,
for the single item each of them fetches.

### 3. Copy reads one item and drops it

`real_copy_cipher_field` (`src/clipboard.rs:109`) drops the cache branch and
always asks the daemon:

```
{"action": "get_item", "query": <id>, "touch": false}
```

`"touch": false` is an invariant, not an incidental detail: copying must not
count as user activity, so it cannot postpone the inactivity lock. The daemon's
default for `get_item` is to touch (`src/daemon.rs:766-783`); the app opts out.

The fetched `VaultItem` is a local binding and is dropped when the function
returns. `custom_index` keeps working — the custom fields come from the same
reply.

Failures keep the existing `CopyOutcomeView { ok: false, error }` shape, so the
existing toast path is unchanged.

### 4. The inspector reads one item and drops it

`real_inspect` (`src/inspector.rs:256`) drops the cache branch. The daemon branch
already reads `reprompt` from the reply, so no cache lookup is needed.

`real_totp` (`src/inspector.rs:295`) drops the cache branch and calls
`{"action":"totp","query":<id>,"touch":false}`.

`InspectorView` still carries `password`, `notes`, `card` and `totp`
(`src/types.rs:465-477`). That is the one item the user is looking at, and it is
bounded to one: `selectCipher` replaces it, and the lock path clears it.

### 5. TOTP comes from the daemon

`tickTotp` already calls `refreshTotp` only when the current period ends
(`store/appStore.ts:988-995`), so the cost is one round-trip per period (30 s),
not one per second. The one-second interval only decrements locally.

`"totp"` is absent from `should_touch_activity`'s default set
(`src/daemon.rs:766-783`), so refreshing a code cannot postpone the inactivity
lock.

On `ok: false`, `real_totp` returns `TotpLiveView { valid: false, error }`;
`tickTotp` stops the ticker (`store/appStore.ts:997-999`) and does not retry. A
new selection restarts it through `syncTotpTicker`. The error string distinguishes
"no TOTP configured", "item not found" and "vault is locked" as the daemon
reports them; the app passes it through rather than inventing wording.

### 6. The inspector refreshes only when the selection changes

`query()` (`store/appStore.ts:867`) calls `refreshInspector()` on every
keystroke. With no cache behind it, that would be one `get_item` per keystroke.

Guard: `query()` calls `refreshInspector()` only when the selected cipher id
differs from `inspector()?.id`. Reveal changes keep calling `refreshInspector`
directly (`store/appStore.ts:1008-1031`), so they are unaffected.
`selectCipher` (`store/appStore.ts:925`) keeps calling it unconditionally,
because the selection genuinely changed.

This guard is a prerequisite for decision 1, not an optional optimization:
without it, removing the cache converts a local read into a bridge call on the
hottest path in the app.

### 7. The hot-path contract is redefined

`GLOSSARY.md:101-104` currently reads:

> **Hot path**: per-interaction work such as category/scope/folder switches,
> search keystrokes, row selection, and inspector refreshes. Hot paths must be
> served from the in-memory `CachedVault` on the Rust side and from
> `FilterProjection` signals on the TSX side.

It becomes:

> **Hot path**: per-interaction work such as category/scope/folder switches,
> search keystrokes, row selection, and inspector refreshes. Hot paths are served
> from the in-memory `CachedVault.rows` on the Rust side and from
> `FilterProjection` signals on the TSX side. Decryption is never a hot path: the
> UI process holds rows, and asks the daemon for a single item when an interaction
> needs one.

This revision ships with the code, in this repository's spec directory; the
project has no ADR directory and this note governs the modules it describes.

## Baseline Measurements

This section exists for comparison, not for scoring. It records what the four
products cost on one machine in one session, so the change can be measured
against the same numbers instead of against an impression.

The canonical record, with the reproduction steps and the caveats, is
`docs/PERFORMANCE.md`. This section keeps the numbers the argument depends on;
that file is where the next round gets appended.

**The `omawarden-app` rows below are superseded.** They were sampled from a
process that had already been unlocked, so they carry 31 MB that a fresh locked
process does not have; see `docs/PERFORMANCE.md`. The locked row re-measures at
155.1 MB, not 186.1 MB, and the locked → unlocked delta this section leans on has
not been re-taken yet. The other three products have only ever been single
samples.

**Machine.** AMD Ryzen 7 8845HS, 27 GiB RAM, kernel 7.2.15-1-omarchy, Hyprland
0.56.2 on Wayland, GTK 4.24.1, Node 26.13.0.

**Builds.** `omawarden` 0.11.0 (`57b2f1c`), `omawarden-app` 0.4.0 packaged with
`nsh package --target linux` (release runner, 42 MB binary), Bitwarden desktop
2026.3.1, Bitwarden CLI 2026.2.0.

**Vault.** 1049 items on a self-hosted Vaultwarden instance, read by both
products with the same account. `omawarden vault list` returns 1,338,064 bytes
of JSON; the equivalent `bw` listing returns 823,055 bytes. The byte counts
differ because the two serialize different field sets, not because they hold
different items.

**Method.** `Rss`, `Pss` and `Pss_Anon` from `/proc/<pid>/smaps_rollup`, three
samples two seconds apart, one fresh process per state — a process that has been
unlocked and locked again keeps the unlock's freed pages, so sampling one process
across two states mixes them. Where a product is more than one process, `RSS` is
summed over the process tree; summing RSS double-counts shared pages, so those
rows overstate the product's real cost. `Pss` is unavailable for Electron — its
`smaps_rollup` is not readable by the same user (`dumpable=0`) — so the Bitwarden
desktop rows carry RSS only.

The first round predates that rule and broke it for `omawarden-app`; the other
products were sampled once each and have not been checked against it.

| Product | State | Processes | RSS | PSS | Pss_Anon |
| --- | --- | --- | --- | --- | --- |
| `omawarden-app` † | locked screen, no daemon | 1 | 186.1 MB | 117.0 MB | 63.8 MB |
| `omawarden-app` † | unlocked, 1049 items | 1 | 211.7 MB | 133.5 MB | 76.9 MB |
| `omawarden` daemon | unlocked, 1049 items | 1 | 52.7 MB | unreadable | — |
| `omawarden` app + daemon | unlocked | 2 | 264.4 MB | — | — |
| Bitwarden desktop | locked | 8 | 849 MB | unreadable | — |
| Bitwarden desktop | unlocked | 8 | 1192–1198 MB | unreadable | — |
| `bw serve` | logged in, locked | 1 | 267.9 MB | 263.4 MB | 210.4 MB |
| `bw serve` | unlocked, 1049 items | 1 | 396.9 MB | 391.8 MB | 335.2 MB |

† Both rows come from one process that had been unlocked before it was sampled,
so they are not comparable with the rest of the table and the delta between them
is an upper bound. See the paragraph below.

Both `omawarden-app` rows were taken at the same window size, 948 × 1046, so the
difference between them is the vault rather than the geometry. That reasoning
holds only if both rows come from the same process lifecycle, which is exactly
what the re-measurement found to be false: a fresh locked process reads 155.1 MB
and 8.4 MB of heap, against 186.1 MB and 18.3 MB here. Until the delta is taken
from two fresh processes, treat +25.6 MB and 3.3 KB per item as an upper bound of
unknown size.

| One-shot command | Items | Wall clock | Peak RSS |
| --- | --- | --- | --- |
| `omawarden vault list` | 1049 | 0.50 s, range 0.40–0.55 over 5 runs | 36.0 MB |
| `bw list items --raw` | 1049 | 3.78 s, single run | 379.0 MB |

**What the app rows say.** The first round put the vault at 25.6 MB of RSS,
16.5 MB of PSS and 13.1 MB of anonymous memory, of which 3.4 MB was the malloc
heap holding `Vec<VaultItem>` — 3.3 KB per item. The rest of the anonymous growth
was the row list the TypeScript side already keeps, which this spec does not
remove. None of those five figures survive as measurements: the locked row they
subtract from is 31 MB too high, so each is an upper bound of unknown size until
both rows are re-taken from fresh processes.

The memory argument is therefore about the slope, not the constant. At 1049
items the first round put the secrets in the UI process at a few megabytes; at
ten times the vault they would be tens. That ordering is what the spec rests on,
and it does not depend on the absolute value.

**After the change.** Re-run the same table, on the same machine, in the same
states, and add the two numbers the baseline cannot express:

- `Pss_Anon` of `omawarden-app` after unlock, which should lose the heap that
  held `Vec<VaultItem>` (3.4 MB at 1049 items in the first round; the figure to
  compare against is the one the re-measurement produces) and keep the row list.
- p95 latency of copy, inspect and TOTP over the local socket. The baseline has
  no such number because all three were cache reads; this is the cost side of
  the trade, one round-trip each, against the 20 ms budget.

The comparison that matters is `omawarden` app plus daemon against Bitwarden
desktop, because those are the two things a user runs to look at a vault.

## Testing Decisions

**Unit, pure (`src/projection.rs`).** `row_from_json` for a login, a card, an SSH
key and a secure note; TOTP presence with and without a seed; password-history
presence; the URI list; the masked card number; `reprompt`; and absent fields
defaulting without panic.

**Structural, compile time.** `CachedVault` has no `items` field, so a reader
cannot be added back without changing the type.

**Structural, CI.** A check that `VaultItem` does not appear in `src/vault.rs` or
`src/projection.rs`. `src/clipboard.rs` and `src/inspector.rs` are allowed to name
it for the single fetched item.

**Behavioural, mock adapters.** Copy, inspect and TOTP still succeed through the
mock path, which this change does not touch. These tests pin the bridge interface,
not the real adapters.

**Behavioural, error paths.** Where the harness can run with mock mode off and no
daemon socket — a dedicated test binary, not the shared integration suite — copy
returns `ok: false` with "The Omawarden daemon is not running."; inspect returns
an `empty_inspector` carrying the same message; TOTP returns `valid: false` with
an error.

**Manual, not a gate.** With mock fixtures of 100, 1000 and 5000 items, measure
the host's RSS after unlock. After the change the slope in item count should be
row metadata only; the previous build should show a steeper slope. Record both
sets of numbers in the pull request.

**Performance, not a gate.** Copy, inspect and TOTP p95 ≤ 20 ms end to end over
the local socket, measured on this machine.

## Out of Scope

- The daemon lock tick. It ships separately as
  `docs/specs/daemon_lock_tick_spec.md`, and this spec does not depend on it.
- Removing the filtered `items` and `category_counts` from `VaultSnapshotView`,
  and the `all_rows.clone()` in `build_snapshot` (`src/projection.rs:265`). They
  have no TS reader, but they are a separate change.
- A redacted `list` in the daemon. Secrets still cross the socket once per cold
  path and are dropped after projection; a metadata-only list action belongs to
  the engine repository, and it is the first of the two gates above.
- Moving the clipboard write into the daemon. The daemon's `copy` action takes
  `{"text": ...}` today, so the app still writes the clipboard itself.
- Deleting `query_vault`, `real_query` and `cached_snapshot`.
- Selecting rows by cipher id instead of by list index.
- SSH approval prompts driven from `pollDaemonTick`.
- The two ranking implementations in Rust and TypeScript.
- Attachment preview peak memory.

## Further Notes

**What this guarantees, and what it does not.** The UI process no longer holds
the vault between cold paths. It still holds the one item on screen, including
its password and notes when the user reveals them — that is inherent to
displaying them. The difference is that the exposure is one item, chosen by the
user, for as long as they are looking at it, instead of every item for the length
of the session.

**Why `list` still carries secrets.** The projection drops them immediately, so
steady-state memory is bounded, but the peak during a cold path includes the
parsed `Value` tree. Closing that gap needs a metadata-only list action in the
daemon, and that is what this spec waits for.

**What the deferred half is worth on its own.** Without the engine change, the
win is the residency window: a core dump, a swap file or a read of
`/proc/<pid>/mem` taken while the user is reading the list finds rows and not
passwords. Taken during a cold path it still finds the vault. That is a smaller
claim than the one this spec opened with, which is why the gate exists.
