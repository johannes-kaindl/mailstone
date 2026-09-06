import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, loadSettings, newAccount, secretIdFor, slugifyAccountId, uniqueAccountId } from "../../src/core/settings";
import type { TrustedSender } from "../../src/core/api/types";

describe("settings", () => {
  it("Defaults", () => {
    expect(DEFAULT_SETTINGS.accounts).toEqual([]);
    expect(DEFAULT_SETTINGS.profile.folder).toBe("Mail");
    expect(DEFAULT_SETTINGS.language).toBe("auto");
  });
  it("loadSettings merged unvollstaendige Daten und repariert das Profil", () => {
    const s = loadSettings({ accounts: [{ id: "a", label: "A" }], profile: { folder: "Post" } });
    expect(s.accounts[0]?.imap.port).toBe(993);
    expect(s.accounts[0]?.secretId).toBe("mailstone-a");
    expect(s.profile.folder).toBe("Post");
    expect(s.profile.fields.from).toBe("from");
  });
  // Fix-Runde 1, Task 7: taskPreset kennt keinen boolean mehr (toFm/needsQuoting machen daraus
  // immer die Zeichenkette "false", nie ein echtes YAML-Bool — s. Kommentar an
  // MailstoneSettings). loadSettings darf an einem aelteren data.json mit einem solchen Wert
  // trotzdem nicht hart brechen.
  it("loadSettings behaelt gueltige taskPreset-Werte (string/number)", () => {
    const s = loadSettings({ taskPreset: { status: "open", prio: 1 } });
    expect(s.taskPreset).toEqual({ status: "open", prio: 1 });
  });
  it("loadSettings wirft einen booleschen taskPreset-Wert aus einem aelteren data.json still weg", () => {
    const s = loadSettings({ taskPreset: { status: "open", archived: true } });
    expect(s.taskPreset).toEqual({ status: "open" });
  });
  it("loadSettings faellt bei fremdem taskPreset (Array/Objekt/null) auf {} zurueck, ohne zu werfen", () => {
    expect(() => loadSettings({ taskPreset: ["junk"] })).not.toThrow();
    expect(loadSettings({ taskPreset: ["junk"] }).taskPreset).toEqual({});
    expect(loadSettings({ taskPreset: null }).taskPreset).toEqual({});
  });
  it("newAccount + secretIdFor", () => {
    const a = newAccount("privat");
    expect(a.secretId).toBe(secretIdFor("privat"));
    expect(a.folders).toEqual({ inbox: "INBOX", allowlist: "Vault", archive: "Archive", sent: "Sent" });
    expect(a.smtp).toEqual({ host: "", port: 465, tls: "implicit" });
  });
  it("loadSettings repariert verschachtelte Konto-Objekte (partial imap)", () => {
    const s = loadSettings({ accounts: [{ id: "a", imap: { host: "imap.example.net" } }] });
    expect(s.accounts[0]?.imap).toEqual({ host: "imap.example.net", port: 993, tls: "implicit" });
    expect(s.accounts[0]?.smtp.port).toBe(465);
    expect(s.accounts[0]?.folders.allowlist).toBe("Vault");
    expect(s.accounts[0]?.sync.intervalMin).toBe(5);
  });
  it("loadSettings repariert Profil-Felder feldweise", () => {
    const s = loadSettings({ profile: { fields: { cc: null } } });
    expect(s.profile.fields.cc).toBeNull();
    expect(s.profile.fields.from).toBe("from");
    expect(s.profile.folder).toBe("Mail");
  });
  it("loadSettings filtert ungültige Identitäten", () => {
    const s = loadSettings({ accounts: [{ id: "a", identities: [{ id: "m", address: "mail@example.net", name: "M" }, "junk"] }] });
    expect(s.accounts[0]?.identities).toHaveLength(1);
    expect(s.accounts[0]?.identities[0]).toEqual({ id: "m", address: "mail@example.net", name: "M" });
  });
  it("slugifyAccountId transliteriert Umlaute und faellt auf 'account' zurueck", () => {
    expect(slugifyAccountId("Büro Mail")).toBe("buero-mail");
    expect(slugifyAccountId("  ")).toBe("account");
    expect(slugifyAccountId("!!!")).toBe("account");
  });
  it("loadSettings faellt bei ungueltigem tls (Tippfehler/Leerzeichen) auf den Default zurueck", () => {
    const s = loadSettings({ accounts: [{ id: "a", imap: { tls: "starttls " } }] });
    expect(s.accounts[0]?.imap.tls).toBe("implicit");
  });
  it("loadSettings faellt bei port als String auf den Default zurueck", () => {
    const s = loadSettings({ accounts: [{ id: "a", smtp: { port: "465" } }] });
    expect(s.accounts[0]?.smtp.port).toBe(465);
  });
  it("loadSettings uebernimmt gueltiges tls/port unveraendert", () => {
    const s = loadSettings({ accounts: [{ id: "a", imap: { tls: "starttls", port: 143 } }] });
    expect(s.accounts[0]?.imap.tls).toBe("starttls");
    expect(s.accounts[0]?.imap.port).toBe(143);
  });
  it("uniqueAccountId haengt bei Kollision -2, -3, … an", () => {
    expect(uniqueAccountId("Privat", [])).toBe("privat");
    expect(uniqueAccountId("Privat", ["privat"])).toBe("privat-2");
    expect(uniqueAccountId("Privat", ["privat", "privat-2"])).toBe("privat-3");
  });
});

describe("Sent-Ordner", () => {
  it("neue Konten legen die Kopie im Ordner Sent ab", () => {
    expect(newAccount("privat").folders.sent).toBe("Sent");
  });

  it("ein bestehendes Konto ohne sent-Feld erbt den Default", () => {
    const s = loadSettings({ accounts: [{ id: "alt", folders: { inbox: "INBOX", allowlist: "Vault", archive: "Archive" } }] });
    expect(s.accounts[0]?.folders.sent).toBe("Sent");
  });

  it("ein leerer sent-Ordner ueberlebt die Reparatur — sonst liesse sich die Kopie nicht abschalten", () => {
    const s = loadSettings({ accounts: [{ id: "aus", folders: { inbox: "INBOX", allowlist: "Vault", archive: "Archive", sent: "" } }] });
    expect(s.accounts[0]?.folders.sent).toBe("");
  });
});

describe("trustedSenders", () => {
  it("ist per Default leer", () => {
    expect(loadSettings({}).trustedSenders).toEqual([]);
  });

  it("uebernimmt gueltige Eintraege", () => {
    const raw = { trustedSenders: [{ pluginId: "calendar-notes", transportId: "privat/mail" }] };
    expect(loadSettings(raw).trustedSenders).toEqual([{ pluginId: "calendar-notes", transportId: "privat/mail" }]);
  });

  // Wie repairTaskPreset: ein Hand-Edit darf den Ladevorgang nicht brechen. Ein unbrauchbarer
  // Eintrag faellt weg — er war nie funktional.
  it("wirft unbrauchbare Eintraege weg statt zu brechen", () => {
    const raw = {
      trustedSenders: [
        { pluginId: "gut", transportId: "a/b" },
        { pluginId: "", transportId: "a/b" },        // leere Id
        { pluginId: "ohne-transport" },               // Feld fehlt
        { pluginId: 42, transportId: "a/b" },         // falscher Typ
        "kein objekt",
        null,
      ],
    };
    expect(loadSettings(raw).trustedSenders).toEqual([{ pluginId: "gut", transportId: "a/b" }]);
  });

  it("faellt bei einem Nicht-Array auf leer zurueck", () => {
    expect(loadSettings({ trustedSenders: { pluginId: "x" } }).trustedSenders).toEqual([]);
  });

  // Genau ein Eintrag je Plugin — decideTrust (Task 1) verlaesst sich nicht darauf, aber die
  // Settings-Schicht stellt es her, damit ein Widerruf in der UI wirklich alles entfernt.
  it("behaelt bei doppelter pluginId nur den ersten", () => {
    const raw = {
      trustedSenders: [
        { pluginId: "a", transportId: "erste/id" },
        { pluginId: "a", transportId: "zweite/id" },
      ],
    };
    expect(loadSettings(raw).trustedSenders).toEqual([{ pluginId: "a", transportId: "erste/id" }]);
  });
});
