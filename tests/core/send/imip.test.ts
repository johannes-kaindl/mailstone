import { describe, it, expect } from "vitest";
import { newAccount, type Account } from "../../../src/core/settings";
import { transportAccounts, splitTransportId, imipToOutgoing } from "../../../src/core/send/imip";
import type { ImipMessage } from "../../../src/core/api/calendar-notes-transport";

function accountWith(id: string, label: string, identities: { id: string; address: string; name: string }[]): Account {
  return { ...newAccount(id), label, identities, defaultIdentityId: identities[0]?.id ?? "" };
}

describe("transportAccounts", () => {
  it("zwei Konten x Identitaeten -> IDs 'konto/identitaet', Label 'Name (Konto-Label)'", () => {
    const accounts: Account[] = [
      accountWith("privat", "Privat", [
        { id: "mail", address: "mail@example.net", name: "Max Muster" },
        { id: "kontakt", address: "kontakt@example.net", name: "Kontakt" },
      ]),
      accountWith("arbeit", "Arbeit", [{ id: "mail", address: "max@firma.example", name: "Max" }]),
    ];
    const out = transportAccounts(accounts);
    expect(out.map((a) => a.id)).toEqual(["privat/mail", "privat/kontakt", "arbeit/mail"]);
    expect(out[0]).toEqual({ id: "privat/mail", address: "mail@example.net", label: "Max Muster (Privat)" });
  });

  it("fehlender Identity-Name faellt auf die Adresse zurueck", () => {
    const accounts: Account[] = [accountWith("privat", "Privat", [{ id: "kontakt", address: "kontakt@example.net", name: "" }])];
    const out = transportAccounts(accounts);
    expect(out[0]?.label).toBe("kontakt@example.net (Privat)");
  });
});

describe("splitTransportId", () => {
  it("'privat/mail' -> {accountId:'privat', identityId:'mail'}", () => {
    expect(splitTransportId("privat/mail")).toEqual({ accountId: "privat", identityId: "mail" });
  });
  it("ohne '/' -> null", () => {
    expect(splitTransportId("kaputt")).toBeNull();
  });
});

describe("imipToOutgoing", () => {
  const base: ImipMessage = {
    method: "REQUEST",
    from: "privat/mail",
    to: ["gast@example.org"],
    subject: "Einladung",
    text: "Du bist eingeladen.",
    ics: "BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n",
  };

  it("gueltige from-Transport-ID -> outgoing.calendar.method, outgoing.from, accountId", () => {
    const result = imipToOutgoing(base);
    expect("error" in result).toBe(false);
    if ("error" in result) throw new Error("unreachable");
    expect(result.accountId).toBe("privat");
    expect(result.outgoing.from).toBe("mail");
    expect(result.outgoing.calendar?.method).toBe("REQUEST");
    expect(result.outgoing.calendar?.ics).toBe(base.ics);
    expect(result.outgoing.to).toEqual(["gast@example.org"]);
    expect(result.outgoing.subject).toBe("Einladung");
  });

  it("from ohne '/' -> {error:'bad-from'}", () => {
    expect(imipToOutgoing({ ...base, from: "x" })).toEqual({ error: "bad-from" });
  });
});
