import { expect, test } from "nsh/test";
import {
  extractDomain,
  getIconBaseUrl,
  iconDomainFor,
  iconFor,
  isAppScheme,
  isOfficialServer,
  resolve,
  resolveIconUrl,
} from "./IconPolicy";

test("icon policy resolves official and self-hosted bases", () => {
  expect(getIconBaseUrl("https://vault.bitwarden.com")).toBe("https://icons.bitwarden.net");
  expect(getIconBaseUrl("https://bitwarden.eu")).toBe("https://icons.bitwarden.net");
  expect(getIconBaseUrl("https://vault.example.com")).toBe("https://vault.example.com/icons");
  expect(getIconBaseUrl("https://vault.example.com/api/")).toBe(
    "https://vault.example.com/icons",
  );
  expect(getIconBaseUrl("")).toBe("https://icons.bitwarden.net");
});

test("icon policy detects official servers and the config gate", () => {
  expect(isOfficialServer("https://vault.bitwarden.com")).toBe(true);
  expect(isOfficialServer("https://bitwarden.eu")).toBe(true);
  expect(isOfficialServer("https://vault.example.com")).toBe(false);
  expect(isOfficialServer("")).toBe(true);

  expect(resolve(false, true)).toBe(false);
  expect(resolve(true, undefined)).toBe(true);
  expect(resolve(true, false)).toBe(false);
});

test("icon policy extracts domains and ignores app schemes", () => {
  expect(extractDomain("https://www.github.com/login")).toBe("github.com");
  expect(extractDomain("github.com")).toBe("github.com");
  expect(extractDomain("https://sub.example.co.uk/path?q=1")).toBe("sub.example.co.uk");
  expect(extractDomain("localhost:8080")).toBe("localhost");
  expect(extractDomain("androidapp://com.example.app")).toBe("");
  expect(extractDomain("iosapp://com.example.app")).toBe("");
  expect(extractDomain("ssh://git@github.com/repo")).toBe("");
  expect(extractDomain("otpauth://totp/Example")).toBe("");
  expect(extractDomain("file:///tmp/notes.txt")).toBe("");
  expect(extractDomain("data:text/plain,hello")).toBe("");
  expect(extractDomain("not a uri")).toBe("");

  expect(isAppScheme("androidapp://x")).toBe(true);
  expect(isAppScheme("https://example.com")).toBe(false);
});

const never = () => false;

test("icon policy builds icon URLs from the first usable URI", () => {
  expect(resolveIconUrl("https://vault.example.com", "github.com")).toBe(
    "https://vault.example.com/icons/github.com/icon.png",
  );
  expect(
    iconFor("https://vault.example.com", ["androidapp://app", "https://github.com/login"], true, never),
  ).toBe("https://vault.example.com/icons/github.com/icon.png");
  expect(iconFor("https://vault.example.com", ["ssh://git@github.com"], true, never)).toBe("");
  expect(iconFor("https://vault.example.com", [], true, never)).toBe("");
});

test("icon policy resolves the first usable domain", () => {
  expect(iconDomainFor(["androidapp://app", "https://www.github.com/login"])).toBe("github.com");
  expect(iconDomainFor(["ssh://git@github.com"])).toBe("");
  expect(iconDomainFor([])).toBe("");
  expect(iconDomainFor(null)).toBe("");
});

test("icon policy honors the config gate and failed domains", () => {
  expect(iconFor("https://vault.example.com", ["https://github.com/login"], false, never)).toBe("");
  expect(
    iconFor("https://vault.example.com", ["https://github.com/login"], true, (domain) =>
      domain === "github.com",
    ),
  ).toBe("");
  expect(
    iconFor("https://vault.example.com", ["https://gitlab.com/x"], true, (domain) =>
      domain === "github.com",
    ),
  ).toBe("https://vault.example.com/icons/gitlab.com/icon.png");
});
