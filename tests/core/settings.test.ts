import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, hasOwnAddress, loadSettings, newAccount, onCreateInvalidValues, ownAddressesOf, rawOnCreate, secretIdFor, slugifyAccountId, uniqueAccountId } from "../../src/core/settings";
import { defaultMailProfile } from "../../src/core/mirror/profile";
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
    expect(s.profile.fields.richtung).toBe("richtung");
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
  // A1-Uebernahme: Vorgang-Folgen schreibt auf dem Server (UID COPY) und ist deshalb AUS, auch fuer bestehende Installationen.
  it("Vorgang-Folgen ist je Konto standardmaessig aus: neues Konto, altes data.json ohne den Schluessel, Muell", () => {
    expect(newAccount("a").sync.followThreads).toBe(false);
    expect(loadSettings({ accounts: [{ id: "a", sync: { enabled: true, intervalMin: 5 } }] }).accounts[0]?.sync.followThreads).toBe(false);
    for (const roh of ["true", 1, "ja", null, [], {}]) {
      expect(loadSettings({ accounts: [{ id: "a", sync: { followThreads: roh } }] }).accounts[0]?.sync.followThreads, String(roh)).toBe(false);
    }
  });
  it("Vorgang-Folgen: nur ein gespeichertes true schaltet ein", () => {
    expect(loadSettings({ accounts: [{ id: "a", sync: { followThreads: true } }] }).accounts[0]?.sync.followThreads).toBe(true);
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

describe("saveAttachments (A6, Anhaenge)", () => {
  it("Standard aus: ohne Schluessel (alte data.json) wird nichts ungefragt in den Anhangordner gelegt", () => {
    expect(loadSettings({ schemaVersion: 1, profile: { folder: "Mail" } }).profile.saveAttachments).toBe(false);
    expect(loadSettings(undefined).profile.saveAttachments).toBe(false);
  });
  it("nur ein Boolean gilt", () => {
    expect(loadSettings({ profile: { saveAttachments: true } }).profile.saveAttachments).toBe(true);
    for (const v of ["true", 1, null, "ja", []]) expect(loadSettings({ profile: { saveAttachments: v } }).profile.saveAttachments, JSON.stringify(v)).toBe(false);
  });
});

describe("saveEml (A6)", () => {
  it("eine alte data.json ohne saveEml ergibt true: bestehende Vaults behalten ihre .eml", () => {
    expect(loadSettings({ schemaVersion: 1, profile: { folder: "Mail" } }).profile.saveEml).toBe(true);
    expect(loadSettings(undefined).profile.saveEml).toBe(true);
  });
  it("ein gespeichertes false bleibt false, ein gespeichertes true bleibt true", () => {
    expect(loadSettings({ profile: { saveEml: false } }).profile.saveEml).toBe(false);
    expect(loadSettings({ profile: { saveEml: true } }).profile.saveEml).toBe(true);
  });
  it("ein Wert, der kein Boolean ist, faellt auf true zurueck (kein stilles Abschalten)", () => {
    for (const v of ["false", 0, null, "nein", []]) expect(loadSettings({ profile: { saveEml: v } }).profile.saveEml, JSON.stringify(v)).toBe(true);
  });
});

describe("pseudonymize (A5, Schritt 2)", () => {
  it("eine alte data.json ohne den Schluessel ergibt off: Vorgabe, kein Vault wird ungefragt umgestellt", () => {
    expect(loadSettings({ schemaVersion: 1, profile: { folder: "Mail" } }).profile.pseudonymize).toBe("off");
    expect(loadSettings(undefined).profile.pseudonymize).toBe("off");
    expect(defaultMailProfile().pseudonymize).toBe("off");
  });
  it("alle drei gueltigen Stellungen bleiben, wie gespeichert", () => {
    for (const v of ["off", "if-available", "required"]) expect(loadSettings({ profile: { pseudonymize: v } }).profile.pseudonymize, v).toBe(v);
  });
  it("ein unbekannter Wert faellt auf off zurueck (kein stilles Einschalten, kein stilles Verlangen)", () => {
    for (const v of ["on", "Required", "", 1, true, null, [], {}]) expect(loadSettings({ profile: { pseudonymize: v } }).profile.pseudonymize, JSON.stringify(v)).toBe("off");
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

// Enum-Pruefung fuer onCreate-Werte (Johannes, 2026-09-15): plugin-eigene, in den Settings
// konfigurierbare Liste erlaubter Werte statt eines Lesezugriffs auf eine Vault-Datei
// (_types/mail.md, Portabilitaet). Ein ungueltiger Wert wird NICHT still verworfen
// (CORE-DATA-01) — loadSettings faellt auf das Default-onCreate zurueck, die Notice dafuer
// entsteht separat in main.ts (src/core/** bleibt obsidian-frei).
describe("onCreate-Enum", () => {
  it("Default onCreateAllowedValues sind die heutigen Werte ('mail')", () => {
    expect(DEFAULT_SETTINGS.onCreateAllowedValues).toEqual(["mail"]);
  });

  it("loadSettings uebernimmt onCreate, wenn alle Werte erlaubt sind", () => {
    const s = loadSettings({ profile: { onCreate: { type: "mail" } } });
    expect(s.profile.onCreate).toEqual({ type: "mail" });
  });

  it("loadSettings faellt bei einem nicht erlaubten onCreate-Wert auf das Default-onCreate zurueck", () => {
    const s = loadSettings({ profile: { onCreate: { type: "unbekannt" } } });
    expect(s.profile.onCreate).toEqual({ type: "mail" });
  });

  it("loadSettings prueft gegen eine eigene onCreateAllowedValues-Liste, nicht nur den Default", () => {
    const s = loadSettings({ onCreateAllowedValues: ["mail", "task"], profile: { onCreate: { type: "task" } } });
    expect(s.profile.onCreate).toEqual({ type: "task" });
    expect(s.onCreateAllowedValues).toEqual(["mail", "task"]);
  });

  it("nicht-string-Werte in onCreate sind kein Enum-Fall und bleiben unangetastet", () => {
    const s = loadSettings({ profile: { onCreate: { type: "mail", prio: 3, archiviert: true } } });
    expect(s.profile.onCreate).toEqual({ type: "mail", prio: 3, archiviert: true });
  });

  it("loadSettings faellt ohne onCreate im Rohwert auf das Default-onCreate zurueck", () => {
    expect(loadSettings({}).profile.onCreate).toEqual({ type: "mail" });
  });

  it("repairOnCreateAllowedValues faellt bei leerer/fremder Liste auf ['mail'] zurueck", () => {
    expect(loadSettings({ onCreateAllowedValues: [] }).onCreateAllowedValues).toEqual(["mail"]);
    expect(loadSettings({ onCreateAllowedValues: "mail" }).onCreateAllowedValues).toEqual(["mail"]);
  });

  it("repairOnCreateAllowedValues filtert fremde Eintraege, trimmt und dedupliziert", () => {
    const s = loadSettings({ onCreateAllowedValues: [1, "", "  ", "task", "task", " mail "] });
    expect(s.onCreateAllowedValues).toEqual(["task", "mail"]);
  });

  it("onCreateInvalidValues meldet nur String-Werte ausserhalb der Liste", () => {
    expect(onCreateInvalidValues({ type: "mail", other: "task" }, ["mail"])).toEqual(["task"]);
    expect(onCreateInvalidValues({ type: "mail" }, ["mail"])).toEqual([]);
    expect(onCreateInvalidValues({ type: "mail", prio: 3 }, ["mail"])).toEqual([]);
    expect(onCreateInvalidValues(undefined, ["mail"])).toEqual([]);
  });

  it("rawOnCreate extrahiert profile.onCreate aus einem rohen Settings-Objekt", () => {
    expect(rawOnCreate({ profile: { onCreate: { type: "task" } } })).toEqual({ type: "task" });
    expect(rawOnCreate({ profile: {} })).toBeUndefined();
    expect(rawOnCreate({})).toBeUndefined();
    expect(rawOnCreate(null)).toBeUndefined();
    expect(rawOnCreate({ profile: { onCreate: "junk" } })).toBeUndefined();
  });
});

describe("showStatusBar (UI-STANDARD § 8 Statusleisten-Eintrag)", () => {
  it("Standard ist an", () => {
    expect(DEFAULT_SETTINGS.showStatusBar).toBe(true);
    expect(loadSettings(undefined).showStatusBar).toBe(true);
  });
  it("eine alte data.json ohne den Schlüssel startet mit an, ein gespeichertes aus bleibt aus", () => {
    expect(loadSettings({ language: "de", debugLog: true }).showStatusBar).toBe(true);
    expect(loadSettings({ showStatusBar: false }).showStatusBar).toBe(false);
    expect(loadSettings({ showStatusBar: true }).showStatusBar).toBe(true);
  });
  it("ein Wert, der kein Boolean ist, fällt auf den Standard", () => {
    expect(loadSettings({ showStatusBar: "nein" }).showStatusBar).toBe(true);
    expect(loadSettings({ showStatusBar: null }).showStatusBar).toBe(true);
  });
});

describe("threadField und threadTokenPattern (A3)", () => {
  it("eine alte data.json ohne die Felder ergibt: Vorgang aus, Token-Regex der Vorgabe", () => {
    const alt = loadSettings({ schemaVersion: 1, profile: { folder: "Mail", saveEml: false } });
    expect(alt.profile.threadField).toBe("");
    expect(alt.profile.threadTokenPattern).toBe("\\[Ticket#\\d+\\]");
    expect(loadSettings(undefined).profile.threadField).toBe("");
  });
  it("gespeicherte Werte bleiben", () => {
    const s = loadSettings({ profile: { threadField: "vorgang", threadTokenPattern: "\\bINC\\d+\\b" } });
    expect(s.profile.threadField).toBe("vorgang");
    expect(s.profile.threadTokenPattern).toBe("\\bINC\\d+\\b");
  });
  it("ein Wert, der kein Text ist, faellt auf die Vorgabe zurueck", () => {
    for (const v of [5, true, null, [], {}]) {
      const s = loadSettings({ profile: { threadField: v, threadTokenPattern: v } });
      expect(s.profile.threadField, JSON.stringify(v)).toBe("");
      expect(s.profile.threadTokenPattern, JSON.stringify(v)).toBe("\\[Ticket#\\d+\\]");
    }
  });
  it("ein bewusst leerer Token-Regex bleibt leer: die Regel ist aus", () => {
    expect(loadSettings({ profile: { threadTokenPattern: "" } }).profile.threadTokenPattern).toBe("");
  });
  it("ein ungueltiger Regex und ein unbrauchbarer Feldname bleiben stehen (die Einstellung zeigt den Hinweis), laden aber ohne Wurf", () => {
    const s = loadSettings({ profile: { threadField: "mail_id", threadTokenPattern: "[" } });
    expect(s.profile.threadField).toBe("mail_id");
    expect(s.profile.threadTokenPattern).toBe("[");
  });
});

describe("followField (A1)", () => {
  it("eine alte data.json ohne das Feld ergibt den Standard mail_follow", () => {
    const alt = loadSettings({ schemaVersion: 1, profile: { folder: "Mail", saveEml: false } });
    expect(alt.profile.followField).toBe("mail_follow");
    expect(loadSettings(undefined).profile.followField).toBe("mail_follow");
  });
  it("ein gespeicherter Wert bleibt, auch ein leerer (aus)", () => {
    expect(loadSettings({ profile: { followField: "folgen" } }).profile.followField).toBe("folgen");
    expect(loadSettings({ profile: { followField: "" } }).profile.followField).toBe("");
  });
  it("ein Wert, der kein Text ist, faellt auf den Standard zurueck", () => {
    for (const v of [5, true, null, [], {}]) {
      expect(loadSettings({ profile: { followField: v } }).profile.followField, JSON.stringify(v)).toBe("mail_follow");
    }
  });
  it("ein unbrauchbarer Feldname bleibt stehen (die Einstellung zeigt den Hinweis), laedt aber ohne Wurf", () => {
    expect(loadSettings({ profile: { followField: "mail_id" } }).profile.followField).toBe("mail_id");
  });
});

describe("inheritFields (A2)", () => {
  it("eine alte data.json ohne das Feld ergibt die leere Liste", () => {
    expect(loadSettings({ schemaVersion: 1, profile: { folder: "Mail", saveEml: false } }).profile.inheritFields).toEqual([]);
    expect(loadSettings(undefined).profile.inheritFields).toEqual([]);
  });
  it("eine gespeicherte Liste bleibt", () => {
    expect(loadSettings({ profile: { inheritFields: ["projekt", "kunde"] } }).profile.inheritFields).toEqual(["projekt", "kunde"]);
  });
  it("kein Array wird zur leeren Liste", () => {
    for (const v of ["projekt", 5, true, null, {}]) {
      expect(loadSettings({ profile: { inheritFields: v } }).profile.inheritFields, JSON.stringify(v)).toEqual([]);
    }
  });
  it("Nicht-Texte und Duplikate fliegen raus, die Reihenfolge bleibt", () => {
    expect(loadSettings({ profile: { inheritFields: ["a", 5, null, "b", "a", { x: 1 }, ["c"], "b"] } }).profile.inheritFields).toEqual(["a", "b"]);
  });
  it("ein unbrauchbarer Name bleibt stehen (die Einstellung zeigt den Hinweis), laedt aber ohne Wurf", () => {
    expect(loadSettings({ profile: { inheritFields: ["mail_id", "prüfung"] } }).profile.inheritFields).toEqual(["mail_id", "prüfung"]);
  });
  it("die Standardliste ist je Aufruf ein eigenes Array", () => {
    const a = loadSettings(undefined).profile.inheritFields;
    a.push("x");
    expect(loadSettings(undefined).profile.inheritFields).toEqual([]);
  });
});

describe("ownAddressesOf (richtung ohne Identitaet)", () => {
  it("zaehlt alle Identitaeten aller Konten", () => {
    const a = newAccount("a");
    a.identities = [{ id: "i1", address: "a@example.org", name: "A" }];
    const b = newAccount("b");
    b.identities = [{ id: "i2", address: "b@example.org", name: "B" }];
    expect(ownAddressesOf([a, b])).toEqual(["a@example.org", "b@example.org"]);
  });

  it("zaehlt den Benutzernamen mit, wenn er eine Mailadresse ist — auch ohne Identitaet", () => {
    const a = newAccount("a");
    a.username = "ich@example.org";
    expect(ownAddressesOf([a])).toEqual(["ich@example.org"]);
  });

  it("zaehlt einen Benutzernamen ohne Adressform nicht und doppelt keine Identitaet", () => {
    const a = newAccount("a");
    a.username = "jkaindl";
    const b = newAccount("b");
    b.username = "B@Example.org";
    b.identities = [{ id: "i", address: "b@example.org", name: "B" }];
    expect(ownAddressesOf([a, b])).toEqual(["b@example.org"]);
  });

  it("hasOwnAddress: false nur ohne Identitaet und ohne Adress-Benutzernamen", () => {
    const a = newAccount("a");
    a.username = "jkaindl";
    expect(hasOwnAddress(a)).toBe(false);
    a.username = "ich@example.org";
    expect(hasOwnAddress(a)).toBe(true);
  });
});
