# Performance Baseline

Measured on 2026-11-08 on one machine, against one vault. It exists so the next
change can be compared against the same numbers instead of against an impression.

The numbers are from two rounds. The first round recorded each state once; the
second, later the same day, re-took them with one fresh process per state and
paired the two states back to back. The two rounds agree, so the table below is
the first round's numbers with the second round as confirmation.

A reading of 155.1 MB locked, taken between the rounds, is **not** used. It came
from a session that had been idle long enough to lock, so the window was never
painted. See "Why 155 MB was wrong".

## Machine and builds

| | Value |
| --- | --- |
| CPU | AMD Ryzen 7 8845HS, 8 cores / 16 threads |
| RAM | 27 GiB |
| Kernel | 7.2.15-1-omarchy |
| Session | Hyprland 0.56.2 on Wayland, every output at scale 2 |
| GTK | 4.24.1 |
| Node | 26.13.0 |

| Product | Version | Build |
| --- | --- | --- |
| `omawarden` | 0.11.0 (`57b2f1c`, 2026-11-08) | release |
| `omawarden-app` | 0.4.0 | `nsh package --target linux`, release profile |
| `omawarden-app` | 0.4.0-dev.04843ff | the same command on the CI runner (ubuntu-24.04) |
| Bitwarden desktop | 2026.3.1-2 | Electron 39 |
| Bitwarden CLI | 2026.2.0-1 | `bw serve`, Node 26 |

`nsh package` compiles `[profile.release]` — `opt-level = "s"`, `lto = "thin"`,
`codegen-units = 1`, stripped. It is the same command the dev release workflow
runs, so the local package and the published artifact are the same build
configuration, not two.

## Vault

1049 items on a self-hosted Vaultwarden instance, read by both products with the
same account.

`omawarden vault list` returns 1,338,064 bytes of JSON. The equivalent `bw`
listing returns 823,055 bytes. The byte counts differ because the two serialize
different field sets, not because they hold different items.

## Method

**One fresh process per state.** Start the app, let the screen settle, take three
samples two seconds apart, quit. Never sample two states in one process: glibc
does not return freed memory to the kernel, so a locked sample taken after an
unlock inherits the unlock's footprint.

**The session must be unlocked and the displays on.** A window on a locked, dark
session still allocates its surfaces, but nothing paints it. The heap stays at
about half its real size and Mesa loads less shader code, so the process reads
roughly 30 MB low. The signature is an identical anonymous mapping with a much
smaller `[heap]`.

Each row records `Rss`, `Pss` and `Pss_Anon` from `/proc/<pid>/smaps_rollup`, plus
the `[heap]` mapping's `Rss` from `/proc/<pid>/smaps`. Where a product is more
than one process, `RSS` is summed over the process tree.

Geometry is 948 × 1046 logical pixels on an output at scale 2, so the window is
1896 × 2092 device pixels. Record the geometry and the scale: both move the
number, and the scale is the one that is easy to forget.

Record what else is running. `Pss` is proportional to sharing, so it moves with
the rest of the session; `Rss` does not. The two rounds were taken with different
background load, which is why their PSS values differ by about 15 MB while their
RSS values agree to 1 MB.

## Resident memory

| Binary | State | Processes | RSS | PSS | Pss_Anon | `[heap]` |
| --- | --- | --- | --- | --- | --- | --- |
| local package | locked, fresh process | 1 | 185.2 MB | 101.2 MB | 64.5 MB | 18.5 MB |
| CI artifact | locked, fresh process | 1 | 185.4 MB | 101.2 MB | 64.4 MB | 18.5 MB |
| local package | unlocked, 1049 items, fresh process | 1 | 213.9 MB | 118.9 MB | 78.0 MB | 22.6 MB |
| CI artifact | unlocked, 1049 items, fresh process | 1 | 212.4 MB | 117.3 MB | 76.2 MB | 21.7 MB |

The two binaries agree to 1.5 MB in both states, and `[heap]` agrees to 0.1 MB
locked and 0.9 MB unlocked. The build channel is not a variable here; see below.

The `omawarden` daemon was running and unlocked for the unlocked rows. Its own
footprint is counted in the single-sample table below, not here.

## The vault costs about 29 MB

Subtracting the paired rows, local package:

| | RSS | PSS | Pss_Anon | `[heap]` |
| --- | --- | --- | --- | --- |
| unlocked | 213.9 MB | 118.9 MB | 78.0 MB | 22.6 MB |
| locked | 185.2 MB | 101.2 MB | 64.5 MB | 18.5 MB |
| difference | +28.7 MB | +17.7 MB | +13.5 MB | +4.1 MB |

At 1049 items that is 3.9 KB of heap per item. The first round put the same
difference at +25.6 MB RSS, +16.5 MB PSS, +13.1 MB `Pss_Anon` and +3.4 MB heap
(3.3 KB per item). The two rounds agree within run-to-run variation; the PSS
deltas differ because PSS tracks sharing.

## Build channel is not the variable

The two binaries, same source tree:

| | text | data | bss | file |
| --- | --- | --- | --- | --- |
| CI (ubuntu-24.04) | 39.78 MB | 2.13 MB | 13.4 KB | 41.9 MB |
| local (Arch) | 39.79 MB | 2.13 MB | 12.7 KB | 41.9 MB |

11 KiB of text, 0.03%, which is the difference between two glibc and two linker
versions, not between two build profiles. A release build of this app is a
release build; the only thing "dev" about the published artifact is the channel
name.

## Why 155 MB was wrong

Between the two rounds, the same locked binary read 155.1 MB RSS and 8.4 MB of
heap. That reading was taken while the machine had been left unattended: the
session locks after 150 seconds idle, the lock screen covers the output and the
display goes off. The app had allocated its window surfaces — the largest
anonymous mapping is 24,492 kB in both readings — but the compositor never
painted it, so the heap never filled and the software rasterizer never loaded its
shader code.

| | RSS | PSS | Pss_Anon | `[heap]` |
| --- | --- | --- | --- | --- |
| dark session | 155.1 MB | 94.6 MB | 52.4 MB | 8.4 MB |
| painted | 185.2 MB | 101.2 MB | 64.5 MB | 18.5 MB |

The gap is concentrated in exactly the two places painting touches: the heap
doubles, and the Mesa rasterizer mappings (`libLLVM`, `libgallium`) grow by about
10 MB. That is why the reading looked like a fresh process rather than a stale
one — it was fresh, it just never drew.

Two things follow:

- A memory number is only comparable when it states whether the window was
  painted. "Fresh process" alone is not enough.
- The first round was not inflated. The 31 MB difference was the dark session,
  not the first round.

## First round, single samples

These products were measured once each and have not been re-measured. Treat them
as an order of magnitude, not a reference.

| Product | State | Processes | RSS | PSS | Pss_Anon |
| --- | --- | --- | --- | --- | --- |
| `omawarden` daemon | unlocked, 1049 items | 1 | 52.7 MB | unreadable | — |
| Bitwarden desktop | locked, account signed in | 8 | 849 MB | unreadable | — |
| Bitwarden desktop | unlocked, 1049 items | 8 | 1192–1198 MB | unreadable | — |
| `bw serve` | signed in, locked | 1 | 267.9 MB | 263.4 MB | 210.4 MB |
| `bw serve` | unlocked, 1049 items | 1 | 396.9 MB | 391.8 MB | 335.2 MB |

The daemon row was re-read during the second round at 52.5 MB, which confirms it
within a rounding error. The daemon runs with `dumpable=0`, so its `smaps_rollup`
is unreadable even to the same user; only `ps` RSS is available.

## One-shot command cost

Also from the first round. Wall clock varies more than memory between runs.

| Command | Items | Wall clock | Peak RSS |
| --- | --- | --- | --- |
| `omawarden vault list` | 1049 | 0.50 s, range 0.40–0.55 over 5 runs | 36.0 MB |
| `bw list items --raw` | 1049 | 3.78 s, single run | 379.0 MB |

## What the numbers say

- A locked `omawarden-app` is about 185 MB of resident memory, and the shipped
  artifact matches a local package within 1.5 MB.
- The vault adds about 29 MB of RSS and 4 MB of heap at 1049 items, roughly
  3.9 KB of heap per item.
- Against Bitwarden desktop's 849 MB locked and 1.19 GB unlocked, the `omawarden`
  app is the smaller of the two by a wide margin, and the daemon adds 53 MB.

## Caveats

**A process cannot be sampled in two states.** Covered above, and worth repeating
because glibc's refusal to return freed pages is what makes the second state look
like the first.

**A window that is not painted is not a measurement.** Covered above. The screen
must be on and the session unlocked.

**PSS is unavailable for Electron.** Its `smaps_rollup` is not readable by the
same user (`dumpable=0`), so the Bitwarden desktop rows carry RSS only. The two
products cannot be compared on PSS.

**Summed RSS overstates multi-process products.** Shared pages are counted once
per process, so the 8-process Bitwarden row is an upper bound, not a sum of
distinct memory.

**Geometry and scale both move the number.** Rendering surfaces and font atlases
move RSS by tens of megabytes between window sizes, and the output scale
multiplies the device-pixel count. Pin both before comparing.

**The debug host binary is not a baseline.** `target/debug/nsh-app-*-linux-host`
never loads the bundle — it shows a "Connecting to ws://127.0.0.1:8790" screen —
and reports about 145 MB. Use `nsh package --target linux`; `nsh run` needs a
development server and cannot be measured.

**`bw serve` does not unlock from `BW_SESSION`.** The variable supplies the key,
but the state still reports `locked` and every read returns `Vault is locked.`
The only way in is `POST /unlock` with `{"password": "..."}` — the field is
`password`, not `masterPassword`, and a wrong value returns the misleading
`The provided key is not the expected type`. The first round needed a fresh
`bw login` first: the stored access token had expired, and `bw unlock` fails with
`invalid_grant` against an expired token while leaving the CLI unauthenticated.

**The Bitwarden desktop window cannot be captured here.** `grim` returned a black
frame for it on this multi-monitor setup, so "unlocked" was confirmed by the
memory delta rather than by a screenshot.

**Wall clock varies more than memory.** `omawarden vault list` ranged from 0.35 s
to 0.91 s across runs on the same vault, with five consecutive runs landing
between 0.40 s and 0.55 s. Peak RSS stayed within a megabyte. Treat the memory
figure as the measurement and the wall clock as an order of magnitude; the
`bw` row is a single run and has no spread at all.

## Reproducing

Resident memory, one fresh process, with the heap mapping. The session must be
unlocked and the displays on:

```bash
./Omawarden --window-size 948x1046 &
pid=$(pgrep -x Omawarden)
for i in 1 2 3; do
  grep -E '^(Rss|Pss|Pss_Anon):' /proc/$pid/smaps_rollup | tr '\n' ' '
  echo
  sleep 2
done
awk '/^[0-9a-f]+-[0-9a-f]+ /{name=$6} /^Rss:/{if(name=="[heap]") print "heap:", $2, "kB"}' \
  /proc/$pid/smaps
kill $pid
```

The `[heap]` name sits in the mapping header, not at the start of a line, so the
`smaps_rollup` alone will not give it to you.

For the unlocked row, unlock the vault in the app and wait for the list to
render before sampling. For the locked row, lock the daemon first
(`omawarden auth lock`) and start a new process; do not reuse the unlocked one.

Resident memory, process tree:

```bash
root=$(pgrep -f 'electron39 /usr/lib/bitwarden/app.asar' | head -1)
ps -eo pid,ppid --no-headers | python3 -c '
import sys
root = int(sys.argv[1])
edges = {}
for line in sys.stdin:
    pid, ppid = line.split()
    edges.setdefault(int(ppid), []).append(int(pid))
out, stack = [], [root]
while stack:
    pid = stack.pop()
    out.append(pid)
    stack.extend(edges.get(pid, []))
print(" ".join(map(str, out)))
' "$root"
```

Then sum `VmRSS` from `/proc/<pid>/status` over that list.

One-shot cost:

```bash
python3 -c "
import subprocess, resource, time
t0 = time.monotonic()
p = subprocess.run(['omawarden', 'vault', 'list'], stdout=subprocess.DEVNULL)
wall = time.monotonic() - t0
print('exit=%d wall=%.3fs peak_rss=%.1f MB' % (
    p.returncode, wall, resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss / 1024))
"
```

## Pending

- The Bitwarden desktop and `bw serve` rows, which have only ever been single
  samples.
- p95 latency of copy, inspect and TOTP over the local socket, which the
  deferred secret-locality change needs as its cost side.

## Related

- `docs/specs/secret_locality_spec.md` — the deferred change these numbers are
  the argument for, and the gate it waits on.
- `docs/specs/daemon_lock_tick_spec.md` — the change that ships first. It has no
  memory goal; its cost is two local round-trips every two seconds.
