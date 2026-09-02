import { describe, it, expect } from "vitest";
import { buildInboxViewModel, toInboxRow, type InboxRow } from "../../../src/core/view/inbox-vm";

function header(felder: string): Uint8Array {
  return new TextEncoder().encode(`${felder}\r\n\r\n`);
}

const zeile: InboxRow = { uid: 1, from: "A", subject: "S", date: "2026-09-02T07:15:00.000Z", imVault: false, ungelesen: true };

describe("toInboxRow", () => {
  it("dekodiert RFC-2047-Betreff und zerlegt den Absender", async () => {
    const r = await toInboxRow({
      uid: 5,
      flags: [],
      header: header([
        "From: =?UTF-8?Q?J=C3=BCrgen_M=C3=BCller?= <j@example.invalid>",
        "Subject: =?UTF-8?Q?Rechnung_f=C3=BCr_M=C3=A4rz?=",
        "Date: Tue, 02 Sep 2026 09:15:00 +0200",
        "Message-ID: <abc@example.invalid>",
      ].join("\r\n")),
    }, new Set());
    expect(r.from).toBe("Jürgen Müller");
    expect(r.subject).toBe("Rechnung für März");
    expect(r.date).toBe("2026-09-02T07:15:00.000Z");
    expect(r.uid).toBe(5);
  });

  it("setzt imVault, wenn die normalisierte Message-ID bekannt ist", async () => {
    const h = header("Message-ID: <abc@example.invalid>\r\nSubject: X");
    expect((await toInboxRow({ uid: 1, flags: [], header: h }, new Set(["abc@example.invalid"]))).imVault).toBe(true);
    expect((await toInboxRow({ uid: 1, flags: [], header: h }, new Set(["anders@example.invalid"]))).imVault).toBe(false);
  });

  it("erkennt dieselbe Mail trotz spitzer Klammern und Grossschreibung im Index", async () => {
    // Der Abgleich laeuft ueber normalizeMessageId auf BEIDEN Seiten — sonst waere der
    // Badge eine Heuristik statt eines exakten Treffers.
    const h = header("Message-ID:  <ABC@Example.Invalid>  \r\nSubject: X");
    const r = await toInboxRow({ uid: 1, flags: [], header: h }, new Set(["ABC@Example.Invalid"]));
    expect(r.imVault).toBe(true);
  });

  it("faellt auf die Adresse zurueck, wenn der Absender keinen Namen hat", async () => {
    const r = await toInboxRow({ uid: 1, flags: [], header: header("From: j@example.invalid\r\nSubject: X") }, new Set());
    expect(r.from).toBe("j@example.invalid");
  });

  it("markiert ungelesen anhand von \\Seen", async () => {
    const h = header("Subject: X");
    expect((await toInboxRow({ uid: 1, flags: [], header: h }, new Set())).ungelesen).toBe(true);
    expect((await toInboxRow({ uid: 1, flags: ["\\Seen"], header: h }, new Set())).ungelesen).toBe(false);
  });
});

describe("buildInboxViewModel", () => {
  it("meldet 'laedt' waehrend des Abrufs", () => {
    const vm = buildInboxViewModel({ zustand: "laedt", rows: [], fehlerCode: null, kannVerschieben: true, busy: false });
    expect(vm.state).toBe("laedt");
  });

  it("meldet 'fehler' mit Code", () => {
    const vm = buildInboxViewModel({ zustand: "fehler", rows: [], fehlerCode: "auth", kannVerschieben: true, busy: false });
    expect(vm).toMatchObject({ state: "fehler", fehlerCode: "auth" });
  });

  it("meldet 'leer' bei bereit ohne Zeilen", () => {
    expect(buildInboxViewModel({ zustand: "bereit", rows: [], fehlerCode: null, kannVerschieben: true, busy: false }).state).toBe("leer");
  });

  it("schaltet Aktionen ab, solange ein anderer Vorgang laeuft", () => {
    const vm = buildInboxViewModel({ zustand: "bereit", rows: [zeile], fehlerCode: null, kannVerschieben: true, busy: true });
    expect(vm).toMatchObject({ state: "gefuellt", aktionenAktiv: false });
  });

  it("schaltet Aktionen ab, wenn der Server kein MOVE kann", () => {
    const vm = buildInboxViewModel({ zustand: "bereit", rows: [zeile], fehlerCode: null, kannVerschieben: false, busy: false });
    expect(vm.aktionenAktiv).toBe(false);
  });
});
