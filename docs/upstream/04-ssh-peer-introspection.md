# Engine follow-up: the SSH approval card cannot identify the requester off Linux

**Repository**: `icyleaf/omarchy-bitwarden`
**Issue**: icyleaf/omarchy-bitwarden#435
**Affects**: `src/ssh_agent.rs` (`Peer::of`)

## Symptom

On macOS, an SSH signing request reaches the approval card with the client shown
as the literal string `A program` and the command field empty. The user is asked
to approve a signature with no way to tell which program asked, or what it wants
to run.

That placeholder is deliberate, not a defect: `Peer::describe()` returns
`"A program"` when `comm` is empty and appends `" in <app>"` only when the app
name is known. Off Linux both are unknown, so the fallback is all that is left.
The request is therefore not "stop showing nothing" but "make the fallback the
best it can be on macOS, and be honest about what it cannot know".

`omawarden-app` cannot compensate: `components/SshApprovalModal.tsx` renders
`client` and `command` verbatim from what the engine reports, so the engine's
placeholder is what the user sees. Its test fixtures seed
`client: "git (ssh)"` only so a mock snapshot is not empty; a real request is
not seeded.

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
keys its remembered approvals on `{scope}|{fingerprint}|{exe}|{app}`, and it
explicitly refuses to remember when `peer.exe` is empty (the code comments say
why: without `/proc/<pid>/exe` the requester cannot be told apart from any
other). So on macOS, `first-use` also degrades to prompting every time.

## What to change

Either name the requester on macOS — `LOCAL_PEERPID` on the accepted socket via
`getsockopt(..., LOCAL_PEERPID, ...)`, then the process's executable and
arguments through `proc_pidpath` and `KERN_PROCARGS2` — or finish the
stated-unknown story.

The `client` field already has one: `A program`. The other two do not. `command`
renders empty, which reads as "we looked and found nothing" rather than "this
host cannot look", and the `first-use` policy silently declines to remember, so
the user is re-prompted on every request with no explanation. Either say the
approval cannot be remembered on this host, or let the user remember it keyed on
the key alone.

The second path is the smaller change and the more honest one if naming the
requester is more work than it is worth.

## Why it belongs in this repository

`omawarden-app` renders the card from whatever the engine reports — `client` and
`command` verbatim. It cannot invent a requester, and guessing one would be worse
than the placeholder.
