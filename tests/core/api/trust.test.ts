import { describe, it, expect } from "vitest";
import { decideTrust, rememberSender } from "../../../src/core/api/trust";
import type { TrustedSender } from "../../../src/core/api/types";

const liste: TrustedSender[] = [
  { pluginId: "calendar-notes", transportId: "privat/mail" },
];

describe("decideTrust", () => {
  it("kennt ein gelistetes Plugin und nennt seine Identitaet", () => {
    expect(decideTrust(liste, "calendar-notes")).toEqual({ kind: "trusted", transportId: "privat/mail" });
  });

  it("fragt bei einem unbekannten Plugin", () => {
    expect(decideTrust(liste, "fremd")).toEqual({ kind: "ask" });
  });

  it("fragt bei leerer Liste", () => {
    expect(decideTrust([], "calendar-notes")).toEqual({ kind: "ask" });
  });

  // Eine leere callerId ist kein gueltiger Aufrufer — sonst koennte ein Eintrag mit leerer
  // pluginId (aus einem Hand-Edit an data.json) jedem Anrufer Vertrauen schenken.
  it("fragt bei leerer callerId, auch wenn ein Eintrag eine leere pluginId traegt", () => {
    const kaputt: TrustedSender[] = [{ pluginId: "", transportId: "privat/mail" }];
    expect(decideTrust(kaputt, "")).toEqual({ kind: "ask" });
  });

  // Genau ein Eintrag je Plugin ist die Zusage der Settings-Schicht (Task 2). Trifft sie doch
  // nicht zu, gewinnt der ERSTE — deterministisch statt "irgendeiner".
  it("nimmt bei doppelten Eintraegen den ersten", () => {
    const doppelt: TrustedSender[] = [
      { pluginId: "a", transportId: "erste/id" },
      { pluginId: "a", transportId: "zweite/id" },
    ];
    expect(decideTrust(doppelt, "a")).toEqual({ kind: "trusted", transportId: "erste/id" });
  });
});

describe("rememberSender", () => {
  it("nimmt einen neuen Eintrag auf", () => {
    expect(rememberSender([], { pluginId: "a", transportId: "x/y" }))
      .toEqual([{ pluginId: "a", transportId: "x/y" }]);
  });

  // Ersetzen, nicht anhaengen: sonst sammeln sich Eintraege je Plugin an, und ein Widerruf
  // in der UI entfernt nur einen davon — die Erlaubnis waere danach immer noch da.
  it("ersetzt eine bestehende Erlaubnis desselben Plugins", () => {
    const vorher: TrustedSender[] = [
      { pluginId: "a", transportId: "alt/id" },
      { pluginId: "b", transportId: "b/id" },
    ];
    expect(rememberSender(vorher, { pluginId: "a", transportId: "neu/id" }))
      .toEqual([{ pluginId: "b", transportId: "b/id" }, { pluginId: "a", transportId: "neu/id" }]);
  });

  it("laesst die Eingabeliste unveraendert", () => {
    const vorher: TrustedSender[] = [{ pluginId: "a", transportId: "alt/id" }];
    rememberSender(vorher, { pluginId: "a", transportId: "neu/id" });
    expect(vorher).toEqual([{ pluginId: "a", transportId: "alt/id" }]);
  });
});
