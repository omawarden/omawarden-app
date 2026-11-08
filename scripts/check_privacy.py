#!/usr/bin/env python3
"""Rejects private details that must not reach a public repository.

The rules are about *shape*, not about particular values: no absolute home
directory, no real hostname, no real email address. That way the check never
has to name the thing it is protecting, which would put it back in the repo.

Run from the repository root; scans every file `git ls-files` reports.
"""

import re
import subprocess
import sys

# A hostname is fine when it is loopback, when one of its labels is `example`
# (RFC 2606 reserves example.com/.net/.org, and `sub.example.co.uk` reads as a
# placeholder), or when it belongs to a vendor the docs legitimately quote.
PUBLIC_SUFFIXES = (
    "github.com",
    "githubusercontent.com",
    "bitwarden.com",
    "bitwarden.eu",
    "bitwarden.net",
    "nsh.dev",
    "w3.org",
    "freedesktop.org",
    "gitlab.com",
    "archlinux.org",
    "omarchy.org",
    "omarchyplugins.com",
)
LOOPBACK = {"localhost", "127.0.0.1", "::1", "0.0.0.0"}

# `/home/user` and `/home/runner` are placeholders; CI runs as runner.
HOME_PLACEHOLDERS = {"user", "runner", "example"}

URL = re.compile(r"https?://([A-Za-z0-9_.\-]+)")
HOME = re.compile(r"/(?:home|Users)/([A-Za-z0-9_.\-]+)/")
EMAIL = re.compile(r"[A-Za-z0-9_.+\-]+@([A-Za-z0-9.\-]+\.[A-Za-z]{2,})")


def host_allowed(host: str) -> bool:
    host = host.rstrip(".").lower()
    if host in LOOPBACK:
        return True
    labels = host.split(".")
    if "example" in labels:
        return True
    return any(host == suffix or host.endswith("." + suffix) for suffix in PUBLIC_SUFFIXES)


def looks_like_host(host: str) -> bool:
    """False for prose such as "loopback may use http://." where the trailing
    period, not a hostname, follows the scheme."""
    if re.fullmatch(r"\d{1,3}(?:\.\d{1,3}){3}", host):
        return True
    return bool(re.search(r"[A-Za-z]", host))


def domain_allowed(domain: str) -> bool:
    domain = domain.rstrip(".").lower()
    return "example" in domain.split(".") or host_allowed(domain)


def check(line: str) -> list[str]:
    problems = []
    for match in URL.finditer(line):
        host = match.group(1)
        if looks_like_host(host) and not host_allowed(host):
            problems.append(f"real hostname in URL: {match.group(0)}")
    for match in HOME.finditer(line):
        if match.group(1) not in HOME_PLACEHOLDERS:
            problems.append(f"real home directory: {match.group(0)}")
    for match in EMAIL.finditer(line):
        if not domain_allowed(match.group(1)):
            problems.append(f"real email address: {match.group(0)}")
    return problems


def main() -> int:
    files = subprocess.run(
        ["git", "ls-files", "-z"], capture_output=True, check=True
    ).stdout.split(b"\0")
    failures = 0
    for raw in files:
        if not raw:
            continue
        path = raw.decode()
        try:
            text = open(path, "r", encoding="utf-8").read()
        except (UnicodeDecodeError, IsADirectoryError, FileNotFoundError):
            continue
        for number, line in enumerate(text.splitlines(), start=1):
            for problem in check(line):
                print(f"{path}:{number}: {problem}")
                failures += 1
    if failures:
        print(
            f"\n{failures} private detail(s) found. Use a placeholder instead:\n"
            "  https://vault.example.com, user@example.com, /home/user/ or ~/\n",
            file=sys.stderr,
        )
        return 1
    print("No private details in tracked files.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
