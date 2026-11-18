import { describe, it, expect } from "vitest";
import { groupFollowUps } from "../../../src/core/view/follow-vm";
import type { FollowItem } from "../../../src/core/thread/follow-run";

const item = (mailId: string, root: string, date: string, folder = "INBOX"): FollowItem =>
  ({ accountId: "a", accountLabel: "Konto", folder, uid: 1, mailId, root, subject: `S ${mailId}`, date });

describe("groupFollowUps", () => {
  it("gruppiert nach Wurzel, Mails je Gruppe nach Datum, Gruppen nach der fruehesten Mail", () => {
    const g = groupFollowUps([
      item("c", "r2", "2026-11-12T10:00:00.000Z"),
      item("a", "r1", "2026-11-10T10:00:00.000Z"),
      item("b", "r1", "2026-11-09T10:00:00.000Z", "Sent"),
    ]);
    expect(g.map((x) => [x.root, x.items.map((i) => i.mailId)])).toEqual([["r1", ["b", "a"]], ["r2", ["c"]]]);
  });
  it("eine leere Liste ergibt keine Gruppen", () => {
    expect(groupFollowUps([])).toEqual([]);
  });
  it("Gruppen ohne Datum stehen am Ende, bei Gleichstand nach Wurzel", () => {
    const g = groupFollowUps([item("x", "rz", ""), item("y", "ra", ""), item("z", "rm", "2026-11-01T00:00:00.000Z")]);
    expect(g.map((x) => x.root)).toEqual(["rm", "ra", "rz"]);
  });
});
