# Engine follow-up: the SSH approval card cannot name the requester off Linux

**Repository**: `icyleaf/omarchy-bitwarden`
**Affects**: `src/ssh_agent.rs` (peer introspection)

## Symptom

On macOS, an SSH signing request reaches the app's approval card with no client
name and no command. The user is asked "Sign this?" without being told who is
asking, which is the one piece of information the card exists to show.
`omawarden-app`'s own test fixture avoids the empty card
(`src/lib.rs` seeds `client: "git (ssh)"`), but a real request does not.

The engine's peer introspection reads Linux-specific process metadata to find
the requesting process. Off Linux it returns nothing, so the card degrades to a
fingerprint and a key name.

## What to change

Either name the requester on macOS (audit-token / `LOCAL_PEERPID`-style lookup
on the accepted socket, then the process's executable and arguments), or report
explicitly that the requester is unknown so the interface can say so instead of
showing a blank.

The second is the smaller change and the more honest one if the first is more
work than it is worth; an empty field reads as a bug, a stated unknown does not.

## Why it belongs in this repository

`omawarden-app` renders the card from whatever the engine reports. It cannot
invent a requester, and guessing one would be worse than the blank.
