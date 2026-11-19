import { describe, it, expect } from "vitest";
import { lockedFieldsChanged, type LockedFieldsView } from "../../../src/core/transform/locked-fields";

// Vorstufe fuer A5, verdrahtet mit dem Pseudonymizer-Aufruf: was ein Transformer an der Mail nicht aendern darf.
const att = (key: string, name = key) => ({ key, name, type: "application/pdf", size: 10, inline: false });
const base = (): LockedFieldsView => ({
  id: "a@example.org", messageIdRaw: "<a@example.org>", inReplyTo: "p@example.org", references: ["r1@example.org", "r2@example.org"],
  attachments: [att("0:a.pdf"), att("cid1@x"), att("2:c.pdf")],
});

describe("lockedFieldsChanged", () => {
  it("nichts geaendert -> []", () => { expect(lockedFieldsChanged(base(), base())).toEqual([]); });
  it("eine Kopie mit anderen Namen, Typen und Groessen der Anhaenge ist keine Aenderung", () => {
    const t = base();
    t.attachments = t.attachments.map((a) => ({ ...a, name: "Datei_x.pdf", size: 1, type: "x/y" }));
    expect(lockedFieldsChanged(base(), t)).toEqual([]);
  });
  const tabelle: [string, (m: LockedFieldsView) => LockedFieldsView, string[]][] = [
    ["id", (m) => ({ ...m, id: "Person_x@example.org" }), ["id"]],
    ["messageIdRaw", (m) => ({ ...m, messageIdRaw: "<Person_x>" }), ["messageIdRaw"]],
    ["messageIdRaw null -> Wert", (m) => ({ ...m, messageIdRaw: null }), ["messageIdRaw"]],
    ["inReplyTo", (m) => ({ ...m, inReplyTo: "q@example.org" }), ["inReplyTo"]],
    ["inReplyTo entfernt", (m) => ({ ...m, inReplyTo: null }), ["inReplyTo"]],
    ["references: Eintrag geaendert", (m) => ({ ...m, references: ["r1@example.org", "x@example.org"] }), ["references"]],
    ["references: Eintrag fehlt", (m) => ({ ...m, references: ["r1@example.org"] }), ["references"]],
    ["references: Reihenfolge", (m) => ({ ...m, references: ["r2@example.org", "r1@example.org"] }), ["references"]],
    ["attachments[].key: ein Schluessel geaendert", (m) => ({ ...m, attachments: [att("0:a.pdf"), att("neu"), att("2:c.pdf")] }), ["attachments[].key"]],
    ["attachments[].key: ein Anhang fehlt", (m) => ({ ...m, attachments: m.attachments.slice(0, 2) }), ["attachments[].key"]],
    ["attachments[].key: ein Anhang kommt dazu", (m) => ({ ...m, attachments: [...m.attachments, att("3:d.pdf")] }), ["attachments[].key"]],
    ["Reihenfolge der Anhaenge", (m) => ({ ...m, attachments: [m.attachments[1]!, m.attachments[0]!, m.attachments[2]!] }), ["attachments.order"]],
    ["mehrere Felder zugleich, in fester Reihenfolge", (m) => ({ ...m, references: [], id: "z", inReplyTo: null }), ["id", "inReplyTo", "references"]],
  ];
  for (const [name, edit, erwartet] of tabelle) it(name, () => { expect(lockedFieldsChanged(base(), edit(base()))).toEqual(erwartet); });
  it("nimmt auch eine volle ParsedMail (strukturelle Typen)", () => {
    const m = { ...base(), from: null, to: [], cc: [], subject: "s", date: null, text: "t", html: null, attachmentData: new Map(), rawSize: 1 };
    const t = { ...m, subject: "Person_x", text: "Person_y" };
    expect(lockedFieldsChanged(m, t)).toEqual([]);
  });
});
