import { describe, it, expect, vi } from "vitest";
import { makeFakeEl } from "../vendor/kit/obsidian-mock";
import { renderFollowUps, type FollowUpsState } from "../../src/obsidian/modals/follow-ups-modal";
import type { FollowItem, FollowRunProblem } from "../../src/core/thread/follow-run";
import { groupFollowUps } from "../../src/core/view/follow-vm";
import { initI18n } from "../../src/i18n/strings";

initI18n("en");

function findAll(el: any, cls: string): any[] {
  const out: any[] = [];
  const walk = (n: any): void => {
    for (const c of n.children ?? []) {
      if (String(c.className ?? "").split(" ").includes(cls)) out.push(c);
      walk(c);
    }
  };
  walk(el);
  return out;
}

const item = (mailId: string, root: string, over: Partial<FollowItem> = {}): FollowItem =>
  ({ accountId: "a", accountLabel: "Work", folder: "INBOX", uid: 1, mailId, root, subject: `Re: ${mailId}`, date: "2026-11-10T10:00:00.000Z", ...over });

function done(items: FollowItem[], problems: FollowRunProblem[] = [], open = vi.fn()): { state: FollowUpsState; open: ReturnType<typeof vi.fn> } {
  const paths: Record<string, string> = { "r1@x": "Mail/2026/Angebot.md", "r2@x": "Mail/2026/Rechnung.md" };
  return { open, state: { kind: "done", groups: groupFollowUps(items), problems, pathOf: (id) => paths[id] ?? null, open, windowDays: 60 } };
}

describe("renderFollowUps", () => {
  it("zeigt je Vorgang den Namen der Wurzel-Notiz als Link und je Mail Ordner, Datum und Betreff", () => {
    const el = makeFakeEl();
    const { state, open } = done([item("m1@x", "r1@x"), item("m2@x", "r1@x", { folder: "Sent", date: "2026-11-11T10:00:00.000Z" }), item("m3@x", "r2@x")]);
    renderFollowUps(el, state);
    const links = findAll(el, "mailstone-follow-thread");
    expect(links.map((l) => l.textContent)).toEqual(["Angebot", "Rechnung"]);
    expect(findAll(el, "mailstone-follow-row")).toHaveLength(3);
    const text = String(el.textContent);
    expect(text).toContain("Re: m1@x");
    expect(text).toContain("Work · INBOX");
    expect(text).toContain("Work · Sent");
    expect(text).toContain("3 mail(s) in 2 thread(s) from the last 60 days. Nothing was written or changed.");
    links[0].click();
    expect(open).toHaveBeenCalledWith("Mail/2026/Angebot.md");
  });

  it("ohne Notiz zur Wurzel steht die Mail-ID als Text, nicht als Link", () => {
    const el = makeFakeEl();
    renderFollowUps(el, done([item("m1@x", "unbekannt@x")]).state);
    expect(findAll(el, "mailstone-follow-thread")).toEqual([]);
    expect(String(el.textContent)).toContain("unbekannt@x");
  });

  it("ohne Treffer der Empty-State mit Hinweis, wo gesucht wurde", () => {
    const el = makeFakeEl();
    renderFollowUps(el, done([]).state);
    const empty = findAll(el, "mailstone-follow-empty");
    expect(empty).toHaveLength(1);
    expect(String(empty[0].textContent)).toContain("No follow-up mails found.");
    expect(String(empty[0].textContent)).toContain("last 60 days");
    expect(findAll(el, "mailstone-follow-row")).toEqual([]);
  });

  it("zeigt Probleme mit Konto, Ordner und uebersetztem Grund; mit Problemen ist es kein leerer Zustand", () => {
    const el = makeFakeEl();
    renderFollowUps(el, done([], [
      { accountId: "a", accountLabel: "Work", folder: "", code: "auth", detail: "x" },
      { accountId: "a", accountLabel: "Work", folder: "Sent", code: "folder-missing", detail: "y" },
      { accountId: "b", accountLabel: "Privat", folder: "", code: "weird", detail: "z" },
    ]).state);
    const text = String(el.textContent);
    expect(findAll(el, "mailstone-follow-problem")).toHaveLength(3);
    expect(text).toContain("Work: The server rejected the login. Check username and app password.");
    expect(text).toContain("Work, folder “Sent”: The folder does not exist on the server.");
    expect(text).toContain("Privat: weird");
    expect(findAll(el, "mailstone-follow-empty")).toEqual([]);
  });

  it("zeigt waehrend des Suchens den Lade-Status und bei belegtem Guard den Hinweis", () => {
    const el = makeFakeEl();
    renderFollowUps(el, { kind: "loading" });
    expect(String(el.textContent)).toContain("Searching the mailboxes…");
    renderFollowUps(el, { kind: "busy" });
    expect(String(el.textContent)).toContain("Another operation is running.");
    expect(String(el.textContent)).not.toContain("Searching");
  });
});
