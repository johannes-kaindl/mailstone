import { describe, it, expect } from "vitest";
import { followAccounts, followRunDeps } from "../../src/obsidian/follow-ups";
import { followContext } from "../../src/obsidian/follow-context";
import { newAccount } from "../../src/core/settings";
import { defaultMailProfile } from "../../src/core/mirror/profile";
import { createBusyGuard } from "../../src/vendor/code-kit/busy-guard";
import { makeApp } from "../helpers/memory-vault";

describe("followAccounts", () => {
  it("nimmt Posteingang und Gesendet-Ordner je Konto, der Anzeigename faellt auf die ID zurueck", () => {
    const a = newAccount("a");
    a.label = "Work";
    a.folders = { inbox: "INBOX", allowlist: "Vault", archive: "Archive", sent: "Gesendet" };
    const b = newAccount("b");
    b.label = "";
    delete b.folders.sent;
    expect(followAccounts([a, b])).toEqual([
      { id: "a", label: "Work", folders: { inbox: "INBOX", sent: "Gesendet" } },
      { id: "b", label: "b", folders: { inbox: "INBOX", sent: "" } },
    ]);
  });
});

describe("followRunDeps.connect", () => {
  const app = makeApp();
  function deps(accounts: ReturnType<typeof newAccount>[], secret: (id: string) => string | null) {
    const host = { app, busy: createBusyGuard(), profile: () => defaultMailProfile(), accounts: () => accounts, secret };
    return followRunDeps(host, followContext(app, defaultMailProfile()));
  }
  it("meldet ein Konto, das es nicht mehr gibt, und ein fehlendes Passwort mit eigenem Code, ohne eine Verbindung zu oeffnen", async () => {
    const a = newAccount("a");
    const d = deps([a], () => null);
    expect(await d.connect({ id: "weg", label: "x", folders: { inbox: "INBOX", sent: "" } })).toMatchObject({ ok: false, code: "connect" });
    expect(await d.connect({ id: "a", label: "x", folders: { inbox: "INBOX", sent: "" } })).toMatchObject({ ok: false, code: "no-secret" });
  });
});
