import { describe, it, expect, vi } from "vitest";
import { createMailstoneApi, type MailstoneApiDeps } from "../../src/obsidian/plugin-api";
import type { ConsentOutcome } from "../../src/obsidian/send-consent-modal";
import type { TrustedSender } from "../../src/core/api/types";

function deps(over: Partial<MailstoneApiDeps> = {}): MailstoneApiDeps {
  return {
    unloaded: () => false,
    accounts: () => [{
      id: "privat", label: "Privat", username: "u", secretId: "s",
      identities: [{ id: "mail", address: "mail@example.net", name: "Max" }],
      defaultIdentityId: "mail",
    } as never],
    trusted: () => [],
    remember: vi.fn(),
    callerLabel: (id) => id,
    consent: async () => ({ kind: "declined" }) as ConsentOutcome,
    send: async () => ({ ok: true, messageId: "abc@example.net", sentCopy: "ok" }),
    ...over,
  };
}

const req = { callerId: "calendar-notes", to: ["gast@example.org"], subject: "Hallo", body: "Hi" };

describe("createMailstoneApi", () => {
  it("traegt die Version und genau zwei Operationen", () => {
    const api = createMailstoneApi(deps());
    expect(api.apiVersion).toBe(1);
    // Flaechen-Waechter: faellt jemand auf die Idee, ein internes Objekt durchzureichen,
    // faellt es hier auf.
    expect(Object.keys(api).sort()).toEqual(["apiVersion", "send", "status"]);
  });

  it("meldet not-configured ohne Konto — und fragt gar nicht erst", async () => {
    const consent = vi.fn(async () => ({ kind: "declined" }) as ConsentOutcome);
    const api = createMailstoneApi(deps({ accounts: () => [], consent }));
    expect(api.status()).toEqual({ ready: false, reason: "not-configured" });
    await expect(api.send(req)).resolves.toEqual({ ok: false, reason: "not-configured" });
    expect(consent).not.toHaveBeenCalled();
  });

  it("meldet unloaded an BEIDEN Operationen", async () => {
    const api = createMailstoneApi(deps({ unloaded: () => true }));
    expect(api.status()).toEqual({ ready: false, reason: "unloaded" });
    await expect(api.send(req)).resolves.toEqual({ ok: false, reason: "unloaded" });
  });

  it("weist leere Empfaenger als invalid ab, ohne zu fragen", async () => {
    const consent = vi.fn(async () => ({ kind: "declined" }) as ConsentOutcome);
    const api = createMailstoneApi(deps({ consent }));
    await expect(api.send({ ...req, to: [] })).resolves.toEqual({ ok: false, reason: "invalid" });
    expect(consent).not.toHaveBeenCalled();
  });

  it("sendet ohne Rueckfrage, wenn das Plugin vertraut ist", async () => {
    const consent = vi.fn(async () => ({ kind: "declined" }) as ConsentOutcome);
    const trusted: TrustedSender[] = [{ pluginId: "calendar-notes", transportId: "privat/mail" }];
    const send = vi.fn(async () => ({ ok: true as const, messageId: "x@y", sentCopy: "ok" as const }));
    const api = createMailstoneApi(deps({ trusted: () => trusted, consent, send }));
    await expect(api.send(req)).resolves.toEqual({ ok: true, messageId: "x@y", sentCopy: "ok" });
    expect(consent).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith("privat", expect.objectContaining({ from: "mail" }));
  });

  it("ignoriert fromHint bei einem vertrauten Plugin", async () => {
    const trusted: TrustedSender[] = [{ pluginId: "calendar-notes", transportId: "privat/mail" }];
    const send = vi.fn(async () => ({ ok: true as const, messageId: "x@y", sentCopy: "ok" as const }));
    const api = createMailstoneApi(deps({ trusted: () => trusted, send }));
    await api.send({ ...req, fromHint: "fremd@example.org" });
    // Die gemerkte Identitaet gewinnt — sonst waere die Freigabe von gestern durch den
    // Aufrufer von heute aushebelbar.
    expect(send).toHaveBeenCalledWith("privat", expect.objectContaining({ from: "mail" }));
  });

  it("merkt sich die Freigabe nur bei remember", async () => {
    const remember = vi.fn();
    const api = createMailstoneApi(deps({
      remember,
      consent: async () => ({ kind: "send", transportId: "privat/mail", remember: false }),
    }));
    await api.send(req);
    expect(remember).not.toHaveBeenCalled();

    const remember2 = vi.fn();
    const api2 = createMailstoneApi(deps({
      remember: remember2,
      consent: async () => ({ kind: "send", transportId: "privat/mail", remember: true }),
    }));
    await api2.send(req);
    expect(remember2).toHaveBeenCalledWith({ pluginId: "calendar-notes", transportId: "privat/mail" });
  });

  it("uebersetzt Ablehnung und Frist in eigene Codes", async () => {
    const abgelehnt = createMailstoneApi(deps({ consent: async () => ({ kind: "declined" }) }));
    await expect(abgelehnt.send(req)).resolves.toEqual({ ok: false, reason: "declined" });

    const abgelaufen = createMailstoneApi(deps({ consent: async () => ({ kind: "timeout" }) }));
    await expect(abgelaufen.send(req)).resolves.toEqual({ ok: false, reason: "not-confirmed" });
  });

  it("lehnt eine zweite Anfrage waehrend eines offenen Modals mit busy ab", async () => {
    // Korrektur ggue. Brief: dort erzeugte "consent" bei JEDEM Aufruf ein neues Promise
    // (Factory-Rumpf "() => new Promise(...)") — der dritte Aufruf unten haette dann ein
    // zweites, nie aufgeloestes Promise erzeugt und den Test auf ewig haengen lassen
    // (gemessen: 5s-Timeout, "consent" zweimal aufgerufen). Hier wird EIN Promise gebaut und
    // bei jedem Aufruf dasselbe zurueckgegeben, damit der dritte Aufruf das laengst
    // aufgeloeste Ergebnis sofort sieht — das ist genau die Aussage des Kommentars unten.
    let loesen: (o: ConsentOutcome) => void = () => {};
    const wartend = new Promise<ConsentOutcome>((r) => { loesen = r; });
    const api = createMailstoneApi(deps({ consent: () => wartend }));
    const erste = api.send(req);
    await expect(api.send(req)).resolves.toEqual({ ok: false, reason: "busy" });
    loesen({ kind: "declined" });
    await erste;
    // Nach dem Schliessen ist der Weg wieder frei — busy darf nicht kleben bleiben.
    await expect(api.send(req)).resolves.toEqual({ ok: false, reason: "declined" });
  });

  it("meldet einen SMTP-Fehlschlag als send-failed", async () => {
    const trusted: TrustedSender[] = [{ pluginId: "calendar-notes", transportId: "privat/mail" }];
    const api = createMailstoneApi(deps({
      trusted: () => trusted,
      send: async () => ({ ok: false, code: "auth-failed" as never }),
    }));
    await expect(api.send(req)).resolves.toEqual({ ok: false, reason: "send-failed" });
  });
});
