# Agent Instructions for Omawarden App

All coding agents working on this codebase must adhere strictly to Native Shell (NSH) design principles and architectural conventions.

## Canonical Standard

Before implementing or modifying any UI component, interaction, layout, or native binding, you **MUST ALWAYS** consult:

- **[https://nsh.dev/llms.txt](https://nsh.dev/llms.txt)**: The authoritative single source of truth for all Native Shell (NSH) development specifications, component APIs, styling rules, and platform constraints.

## This repository is public

Docs, specs, commit messages, code comments and test fixtures must not describe
a real deployment or a real person. Everything here is readable by anyone, and
history rewrites are expensive.

- No real hostnames. Use `https://vault.example.com` or `https://identity.example.com`.
- No real email addresses. Use `user@example.com`.
- No absolute home directories. Use `~/` or `/home/user/`.
- No account identifiers (user ids, organization ids, tokens) and no vault item
  titles, usernames or URLs from a real vault.

`scripts/check_privacy.py` enforces the first three over every tracked file, and
CI runs it before the Rust checks. A doc that legitimately needs a vendor
hostname gets it added to `PUBLIC_SUFFIXES` in that script; that edit is where a
reviewer sees the new host.
