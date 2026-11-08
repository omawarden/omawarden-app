# Performance Baseline

Measured on 2026-11-08 on one machine, in one session, against one vault. This is
a snapshot, not a target: it exists so the next change can be compared against the
same numbers instead of against an impression.

It records resident memory and the cost of a full-vault command. It does not
record interface latency, which has no baseline yet.

## Machine and builds

| | Value |
| --- | --- |
| CPU | AMD Ryzen 7 8845HS, 8 cores / 16 threads |
| RAM | 27 GiB |
| Kernel | 7.2.15-1-omarchy |
| Session | Hyprland 0.56.2 on Wayland |
| GTK | 4.24.1 |
| Node | 26.13.0 |

| Product | Version | Build |
| --- | --- | --- |
| `omawarden` | 0.11.0 (`57b2f1c`, 2026-11-08) | release |
| `omawarden-app` | 0.4.0 | `nsh package --target linux`, release runner, 42 MB binary |
| Bitwarden desktop | 2026.3.1-2 | Electron 39 |
| Bitwarden CLI | 2026.2.0-1 | `bw serve`, Node 26 |

## Vault

1049 items on a self-hosted Vaultwarden instance, read by both products with the
same account.

`omawarden vault list` returns 1,338,064 bytes of JSON. The equivalent `bw`
listing returns 823,055 bytes. The byte counts differ because the two serialize
different field sets, not because they hold different items.

## Method

Resident memory comes from `/proc/<pid>/smaps_rollup`: `Rss`, `Pss` and
`Pss_Anon`, three samples two seconds apart, taken once the vault had finished
loading. Where a product is more than one process, `RSS` is summed over the
process tree.

The one-shot rows come from a Python wrapper around `subprocess.run`, reading
`resource.getrusage(RUSAGE_CHILDREN).ru_maxrss` after the child exits, and wall
clock from `time.monotonic()`. GNU `time` is not installed on this machine, so
`/usr/bin/time -v` is not an option.

## Resident memory

| Product | State | Processes | RSS | PSS | Pss_Anon |
| --- | --- | --- | --- | --- | --- |
| `omawarden-app` | locked screen, no daemon | 1 | 186.1 MB | 117.0 MB | 63.8 MB |
| `omawarden-app` | unlocked, 1049 items | 1 | 211.7 MB | 133.5 MB | 76.9 MB |
| `omawarden` daemon | unlocked, 1049 items | 1 | 52.7 MB | unreadable | — |
| `omawarden` app + daemon | unlocked | 2 | 264.4 MB | — | — |
| Bitwarden desktop | locked, account signed in | 8 | 849 MB | unreadable | — |
| Bitwarden desktop | unlocked, 1049 items | 8 | 1192–1198 MB | unreadable | — |
| `bw serve` | signed in, locked | 1 | 267.9 MB | 263.4 MB | 210.4 MB |
| `bw serve` | unlocked, 1049 items | 1 | 396.9 MB | 391.8 MB | 335.2 MB |

Both `omawarden-app` rows were taken at the same window size, 948 × 1046, so the
difference between them is the vault rather than the geometry.

## One-shot command cost

| Command | Items | Wall clock | Peak RSS |
| --- | --- | --- | --- |
| `omawarden vault list` | 1049 | 0.50 s, range 0.40–0.55 over 5 runs | 36.0 MB |
| `bw list items --raw` | 1049 | 3.78 s, single run | 379.0 MB |

## What the numbers say

The `omawarden-app` pair, which is the only pair taken under identical geometry:

| | RSS | PSS | Pss_Anon | `[heap]` |
| --- | --- | --- | --- | --- |
| locked | 186.1 MB | 117.0 MB | 63.8 MB | 18.3 MB |
| unlocked | 211.7 MB | 133.5 MB | 76.9 MB | 21.7 MB |
| difference | +25.6 MB | +16.5 MB | +13.1 MB | +3.4 MB |

The 3.4 MB of heap is `Vec<VaultItem>` — every password, note, card number and
search string in the vault, at 3.3 KB per item. The rest of the anonymous growth
is the row list the TypeScript side keeps, which is the larger half.

Three things follow from that:

- The secrets in the UI process are a few megabytes at this vault size. The
  memory argument for removing them is about the slope, not the constant.
- The whole product costs 264.4 MB across two processes, against 1192–1198 MB
  across eight for the Bitwarden desktop app. Most of both numbers is runtime,
  not vault.
- The one-shot CLI is a different story: `bw list items` costs about seven times
  the wall clock and ten times the peak memory of `omawarden vault list` for the
  same 1049 items.

## Caveats

**PSS is unavailable for Electron.** Its `smaps_rollup` is not readable by the
same user (`dumpable=0`), so the Bitwarden desktop rows carry RSS only. The two
products cannot be compared on PSS.

**Summed RSS overstates multi-process products.** Shared pages are counted once
per process, so the 8-process Bitwarden row is an upper bound, not a sum of
distinct memory. The `omawarden` rows are single-process and unaffected.

**Window geometry changes the numbers.** Rendering surfaces and font atlases move
RSS by tens of megabytes between window sizes. An earlier locked run at
798 × 1046 read 194.9 MB and is not used here. Pin the geometry before comparing.

**The debug host binary is not a baseline.** `target/debug/nsh-app-*-linux-host`
never loads the bundle — it shows a "Connecting to ws://127.0.0.1:8790" screen —
and reports about 145 MB. Use `nsh package --target linux`; `nsh run` needs a
development server and cannot be measured.

**`bw serve` does not unlock from `BW_SESSION`.** The variable supplies the key,
but the state still reports `locked` and every read returns `Vault is locked.`
The only way in is `POST /unlock` with `{"password": "..."}` — the field is
`password`, not `masterPassword`, and a wrong value returns the misleading
`The provided key is not the expected type`. The measurement above required a
fresh `bw login` first: the stored access token had expired, and `bw unlock`
fails with `invalid_grant` against an expired token while leaving the CLI
unauthenticated.

**Wall clock varies more than memory.** `omawarden vault list` ranged from 0.35 s
to 0.91 s across runs on the same vault, with five consecutive runs landing
between 0.40 s and 0.55 s. Peak RSS stayed within a megabyte. Treat the memory
figure as the measurement and the wall clock as an order of magnitude; the
`bw` row is a single run and has no spread at all.

**The Bitwarden desktop window cannot be captured here.** `grim` returns a black
frame for it on this multi-monitor setup, so "unlocked" was confirmed by the
memory delta (849 MB → 1192 MB) rather than by a screenshot.

## Reproducing

Resident memory, single process:

```bash
pid=$(pgrep -f 'omawardenApp$')
for i in 1 2 3; do
  grep -E '^(Rss|Pss|Pss_Anon):' /proc/$pid/smaps_rollup | tr '\n' ' '
  echo
  sleep 2
done
```

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

## Related

- `docs/specs/secret_locality_spec.md` — the deferred change these numbers are
  the argument for, and the gate it waits on.
- `docs/specs/daemon_lock_tick_spec.md` — the change that ships first. It has no
  memory goal; its cost is two local round-trips every two seconds.
