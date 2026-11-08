# Performance Baseline

Measured on 2026-11-08 on one machine, against one vault. It exists so the next
change can be compared against the same numbers instead of against an impression.

**Status: the first round is superseded.** The locked rows were re-taken later the
same day and came out 31 MB lower, because the first round sampled a process that
had already been unlocked. See "Why the first round is not used". The unlocked
rows and the locked-to-unlocked delta still need the same treatment, and that
needs the vault unlocked.

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
| `omawarden-app` | 0.4.0-dev.034e8ba | the same command on the CI runner (ubuntu-24.04) |
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
unlock inherits the unlock's footprint. That mistake is what the first round made,
and it cost 31 MB.

Each row records `Rss`, `Pss` and `Pss_Anon` from `/proc/<pid>/smaps_rollup`, plus
the `[heap]` mapping's `Rss` from `/proc/<pid>/smaps`. Where a product is more
than one process, `RSS` is summed over the process tree.

Geometry is 948 × 1046 logical pixels on an output at scale 2, so the window is
1896 × 2092 device pixels. Record the geometry and the scale: both move the
number, and the scale is the one that is easy to forget.

Record what else is running. `Pss` is proportional to sharing, so it moves with
the rest of the session; `Rss` does not.

## Resident memory, re-measured (locked)

| Binary | State | Processes | RSS | PSS | Pss_Anon | `[heap]` |
| --- | --- | --- | --- | --- | --- | --- |
| local package, fix commit tree | locked, fresh process | 1 | 155.1 MB | 94.6 MB | 52.4 MB | 8.4 MB |
| CI artifact (`034e8ba`) | locked, fresh process | 1 | 155.2 MB | 94.9 MB | 52.4 MB | 8.4 MB |

The two binaries agree to 0.7 MB. `[heap]` is identical at 8,644 kB in both, which
is the clearest sign that this is the steady state of a locked screen rather than
a leftover: a process that has only ever drawn the locked screen reaches the same
heap size every time.

The `omawarden` daemon was running and locked for both rows. Its own footprint is
counted in the single-sample table below, not here.

## Build channel is not the variable

Same source tree (the fix commit), CI artifact against the local package:

| | text | data | bss | file |
| --- | --- | --- | --- | --- |
| CI (ubuntu-24.04) | 39.78 MB | 2.13 MB | 13.4 KB | 41.9 MB |
| local (Arch) | 39.90 MB | 2.13 MB | 12.1 KB | 42.0 MB |

120 KiB of text, 0.31%, which is the difference between two glibc and two linker
versions, not between two build profiles. A release build of this app is a
release build; the only thing "dev" about the published artifact is the channel
name.

## Why the first round is not used

The first round recorded, for the same binary at the same geometry:

| | RSS | PSS | Pss_Anon | `[heap]` |
| --- | --- | --- | --- | --- |
| first round, locked | 186.1 MB | 117.0 MB | 63.8 MB | 18.3 MB |
| re-measured, locked | 155.1 MB | 94.6 MB | 52.4 MB | 8.4 MB |
| difference | −31.0 MB | −22.4 MB | −11.4 MB | −9.9 MB |

The heap gap is the tell. A process that has only drawn the locked screen ends at
8.4 MB; the first round read 18.3 MB, which is what the heap looks like after an
unlock has filled it and a lock has emptied it without giving the pages back.

Two things follow:

- The first round's locked row was inflated, so the locked → unlocked delta it
  produced (+25.6 MB RSS, +3.4 MB heap, 3.3 KB per item) cannot be used as it
  stands. The delta has to be re-taken, one fresh process per state.
- Every absolute number in this file needs the process history stated next to it.
  A number without "fresh process" or "after an unlock" is not comparable.

## First round, single samples (not re-taken)

These products were measured once each in the first round and have not been
re-measured. Treat them as an order of magnitude, not a reference.

| Product | State | Processes | RSS | PSS | Pss_Anon |
| --- | --- | --- | --- | --- | --- |
| `omawarden` daemon | unlocked, 1049 items | 1 | 52.7 MB | unreadable | — |
| Bitwarden desktop | locked, account signed in | 8 | 849 MB | unreadable | — |
| Bitwarden desktop | unlocked, 1049 items | 8 | 1192–1198 MB | unreadable | — |
| `bw serve` | signed in, locked | 1 | 267.9 MB | 263.4 MB | 210.4 MB |
| `bw serve` | unlocked, 1049 items | 1 | 396.9 MB | 391.8 MB | 335.2 MB |

## One-shot command cost

Also from the first round. Neither command can be re-run while the vault is
locked, and wall clock varies more than memory between runs.

| Command | Items | Wall clock | Peak RSS |
| --- | --- | --- | --- |
| `omawarden vault list` | 1049 | 0.50 s, range 0.40–0.55 over 5 runs | 36.0 MB |
| `bw list items --raw` | 1049 | 3.78 s, single run | 379.0 MB |

## What the numbers say so far

- A locked `omawarden-app` is 155 MB of resident memory, and the same number on
  the shipped artifact as on a local package.
- The 31 MB the first round added was measurement error, not vault content: a
  locked screen has no vault in it.
- The cost of the vault itself is still unmeasured. The deferred secret-locality
  change rests on that number, so it waits on the re-measurement.

## Caveats

**A process cannot be sampled in two states.** Covered above, and worth repeating
because it is the mistake that produced the first round.

**PSS is unavailable for Electron.** Its `smaps_rollup` is not readable by the
same user (`dumpable=0`), so the Bitwarden desktop rows carry RSS only. The two
products cannot be compared on PSS.

**Summed RSS overstates multi-process products.** Shared pages are counted once
per process, so the 8-process Bitwarden row is an upper bound, not a sum of
distinct memory.

**Geometry and scale both move the number.** Rendering surfaces and font atlases
move RSS by tens of megabytes between window sizes, and the output scale multiplies
the device-pixel count. Pin both before comparing.

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
memory delta rather than by a screenshot. On the re-measurement day `grim` failed
outright on this session — `ext_image_copy_capture` never delivered a frame — so
screen contents were read through AT-SPI instead.

**Wall clock varies more than memory.** `omawarden vault list` ranged from 0.35 s
to 0.91 s across runs on the same vault, with five consecutive runs landing
between 0.40 s and 0.55 s. Peak RSS stayed within a megabyte. Treat the memory
figure as the measurement and the wall clock as an order of magnitude; the
`bw` row is a single run and has no spread at all.

## Reproducing

Resident memory, one fresh process, with the heap mapping:

```bash
./omawardenApp --window-size 948x1046 &
pid=$(pgrep -x omawardenApp)
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

- The unlocked rows for `omawarden-app`, one fresh process each, at the same
  geometry and scale.
- The locked → unlocked delta, from those two fresh processes.
- The 3.3 KB per item figure, which is that delta divided by 1049.
- The daemon and Bitwarden rows above, which have only ever been single samples.

## Related

- `docs/specs/secret_locality_spec.md` — the deferred change these numbers are
  the argument for, and the gate it waits on.
- `docs/specs/daemon_lock_tick_spec.md` — the change that ships first. It has no
  memory goal; its cost is two local round-trips every two seconds.
