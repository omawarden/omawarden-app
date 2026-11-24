# Engine follow-up: the SSH approval card cannot name the requester off Linux

**Repository**: `icyleaf/omarchy-bitwarden`
**Affects**: `src/ssh_agent.rs` (`Peer::of`)

## Symptom

On macOS, an SSH signing request reaches the approval card with no client name
and no command. The user is asked "Sign this?" without being told who is asking,
which is the one piece of information the card exists to show.

`omawarden-app` cannot compensate: it renders `client` and `command` from what
the engine reports, and its own test fixtures seed `client: "git (ssh)"` only so
the mock snapshot is not empty. A real request is not seeded.

## Why it happens

`Peer::of` has two arms:

```rust
#[cfg(target_os = "linux")]
fn of(stream: &UnixStream) -> Peer { /* SO_PEERCRED, then /proc/<pid> */ }

#[cfg(not(target_os = "linux"))]
fn of(_stream: &UnixStream) -> Peer { Peer::default() }
```

The Linux arm reads `SO_PEERCRED` for the peer pid and then walks `/proc/<pid>`
for `exe`, `comm` and `cmdline`. `find_app()` walks the process tree the same
way. Off Linux there is no `/proc`, so `Peer::default()` returns empty `exe`,
`comm`, `cmdline` and `app`, and the card degrades to a fingerprint and a key
name.

There is a second consequence worth knowing: the `first-use` confirmation policy
keys its remembered approvals on `fingerprint|client exe|app exe`, and it
explicitly refuses to remember when `peer.exe` is empty (the code comments say
why: without `/proc/<pid>/exe` the requester cannot be told apart from any
other). So on macOS, `first-use` also degrades to prompting every time.

## What to change

Either name the requester on macOS — `LOCAL_PEERPID` on the accepted socket via
`getsockopt(..., LOCAL_PEERPID, ...)`, then the process's executable and
arguments through `proc_pidpath` and `KERN_PROCARGS2` — or report explicitly that
the requester is unknown.

The second is the smaller change and the more honest one if the first is more
work than it is worth. An empty field reads as a bug; a stated unknown does not,
and it would also tell the `first-use` policy that it cannot key on the
requester, instead of silently prompting forever.

## Why it belongs in this repository

`omawarden-app` renders the card from whatever the engine reports. It cannot
invent a requester, and guessing one would be worse than the blank.
