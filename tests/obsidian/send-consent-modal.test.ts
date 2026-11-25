import { describe, it, expect, vi } from "vitest";
import { App, Modal } from "obsidian";
import { askSendConsent, closeOpenSendConsent,
         type ConsentOutcome, type SendConsentOptions } from "../../src/obsidian/send-consent-modal";
import { initI18n } from "../../src/i18n/strings";

initI18n("de");

/** Timer-Attrappe: die Frist soll in diesen Tests NIE feuern — gemessen wird der Klick- bzw.
 *  der Schliess-Weg, nicht der Ablauf (den deckt `consentTimeout` oben ab). */
function stilleTimer(): { setTimeout: (fn: () => void, ms: number) => number; clearTimeout: (id: number) => void } {
  return { setTimeout: () => 1, clearTimeout: () => {} };
}

function optionen(over: Partial<SendConsentOptions> = {}): SendConsentOptions {
  return {
    callerLabel: "Calendar Notes",
    identities: [{ id: "privat/mail", label: "Max (Privat)" }],
    preselectId: "privat/mail",
    req: { callerId: "calendar-notes", to: ["gast@example.org"], subject: "Hallo", body: "Hi" },
    timeoutMs: 60_000,
    ...over,
  };
}

/** Das zuletzt konstruierte Modal. `Modal.__last` ist eine Instrumentierung des Mocks
 *  (tests/vendor/kit/obsidian-mock.ts) und existiert in den echten Obsidian-Typings nicht —
 *  deshalb ein struktureller Cast statt eines Imports der Mock-Klasse. Die Klasse selbst ist
 *  bewusst nicht exportiert; `askSendConsent` ist der einzige oeffentliche Einstieg. */
function letztesModal(): { titleEl: { textContent: string }; contentEl: { querySelectorAll: (s: string) => unknown[] } } {
  return (Modal as unknown as { __last: never }).__last;
}

function knoepfe(): { textValue: string; ctaSet: boolean; destructiveSet: boolean; warningSet: boolean }[] {
  const container = letztesModal().contentEl.querySelectorAll(".modal-button-container")[0] as
    { children: { __component: { textValue: string; ctaSet: boolean; destructiveSet: boolean; warningSet: boolean } }[] };
  return container.children.map((c) => c.__component);
}

describe("askSendConsent — Frist (withTimeout aus code-kit)", () => {
  it("loest nach der Frist mit timeout auf und schliesst das Modal, nicht vorher", async () => {
    vi.useFakeTimers();
    let ergebnis: unknown = null;
    void askSendConsent(new App(), optionen({ timeoutMs: 60_000 }), window).then((r) => { ergebnis = r; });
    await vi.advanceTimersByTimeAsync(59_000);
    expect(ergebnis).toBeNull();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(ergebnis).toEqual({ kind: "timeout" });
    vi.useRealTimers();
  });

  it("raeumt den Timer auf, wenn der Dialog vor der Frist schliesst", async () => {
    vi.useFakeTimers();
    const clear = vi.spyOn(window, "clearTimeout");
    const p = askSendConsent(new App(), optionen({ timeoutMs: 60_000 }), window);
    closeOpenSendConsent();
    await expect(p).resolves.toEqual({ kind: "declined" });
    expect(clear).toHaveBeenCalled();
    vi.useRealTimers();
  });
});

// ── Fix-Runde 2 ────────────────────────────────────────────────────────────────────────────
describe("SendConsentModal — Form", () => {
  // Minor: der Titel war ein eigenes <h3> im contentEl und trug in styles.css keine
  // Groessenregel. `titleEl` ist die native Titelzeile, die Obsidian selbst typografiert —
  // dieselbe Form wie im Kit-Baustein (src/vendor/kit-obsidian/confirm.ts:49).
  it("setzt den Titel in die native Titelzeile, nicht als <h3> in den Inhalt", () => {
    void askSendConsent(new App(), optionen(), stilleTimer());
    const modal = letztesModal();
    expect(modal.titleEl.textContent).toBe("Mail im Auftrag eines anderen Plugins senden?");
    expect(modal.contentEl.querySelectorAll("h3").length).toBe(0);
    closeOpenSendConsent();
  });

  // Minor: `applyDestructive` sass auf ABBRECHEN. Damit sagten die Farben das Gegenteil der
  // Tragweite — rot fuer die folgenlose Absage, blau fuer die dauerhafte Freigabe.
  it("markiert die dauerhafte Freigabe destruktiv und Abbrechen neutral", () => {
    void askSendConsent(new App(), optionen(), stilleTimer());
    const b = knoepfe();
    expect(b.map((x) => x.textValue)).toEqual(["Abbrechen", "Einmal senden", "Senden und immer erlauben"]);
    const abbrechen = b[0]!, einmal = b[1]!, immer = b[2]!;
    // Der Mock zeichnet setDestructive/setWarning getrennt auf; `applyDestructive` waehlt zur
    // Laufzeit — geprueft wird deshalb "eines von beiden", nicht die konkrete Variante.
    expect(immer.destructiveSet || immer.warningSet).toBe(true);
    expect(abbrechen.destructiveSet || abbrechen.warningSet).toBe(false);
    expect(abbrechen.ctaSet).toBe(false);
    expect(einmal.ctaSet).toBe(true);
    closeOpenSendConsent();
  });
});

describe("SendConsentModal — Hinweis auf vergessene Platzhalter (A5, Schritt 5)", () => {
  function absaetze(): string[] {
    return (letztesModal().contentEl.querySelectorAll("p") as { textContent: string }[]).map((p) => p.textContent);
  }

  it("zeigt den Hinweis mit der Zahl, wenn Platzhalter vergessener Eintraege hinausgehen", () => {
    void askSendConsent(new App(), optionen({ forgotten: 2 }), stilleTimer());
    expect(absaetze()).toContain("2 Platzhalter vergessener Einträge werden als Platzhalter gesendet.");
    closeOpenSendConsent();
  });

  it("zeigt ohne vergessene Platzhalter keinen Hinweis", () => {
    void askSendConsent(new App(), optionen(), stilleTimer());
    expect(absaetze().some((t) => t.includes("vergessener"))).toBe(false);
    closeOpenSendConsent();
  });
});

describe("closeOpenSendConsent", () => {
  // Important 1, zweite Haelfte: `onunload` setzte nur ein Flag. Das Modal haengt an keinem
  // Lifecycle und stand danach weiter da — ein Dialog, dessen Frage niemand mehr beantworten
  // kann. Ohne die Registry bliebe dieses Promise haengen, bis die 60-s-Frist ablaeuft.
  it("schliesst ein offenes Modal und loest sein Promise als declined auf", async () => {
    const p: Promise<ConsentOutcome> = askSendConsent(new App(), optionen(), stilleTimer());
    closeOpenSendConsent();
    await expect(p).resolves.toEqual({ kind: "declined" });
  });

  it("ist ohne offenes Modal ein No-op und wirft nicht", () => {
    expect(() => { closeOpenSendConsent(); }).not.toThrow();
  });

  it("nimmt ein abgeschlossenes Modal wieder aus der Registry", async () => {
    const p: Promise<ConsentOutcome> = askSendConsent(new App(), optionen(), stilleTimer());
    closeOpenSendConsent();
    await p;
    // Zweiter Aufruf darf nicht auf einer Leiche arbeiten: `close()` auf dem bereits
    // geschlossenen Modal wuerde `onClose` erneut ausloesen.
    expect(() => { closeOpenSendConsent(); }).not.toThrow();
  });
});
