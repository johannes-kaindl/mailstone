import { describe, it, expect } from "vitest";
import { planMailNote } from "../../../src/core/mirror/plan";
import { defaultMailProfile, withTaskPreset } from "../../../src/core/mirror/profile";
import { parseEml } from "../../../src/core/mime/parse";
import { loadFixture } from "../../helpers/fixtures";

const common = async () => {
  const eml = loadFixture("utf8-plain");
  return { mail: await parseEml(eml), eml, profile: defaultMailProfile(), source: "privat/Vault", syncedAt: new Date(0), takenPaths: new Set<string>(), allowUpdate: true };
};

describe("planMailNote", () => {
  it("create: Pfade, Inhalt mit Fences, eml-Bytes", async () => {
    const c = await common();
    const p = planMailNote({ ...c, existing: null });
    expect(p.kind).toBe("create");
    if (p.kind !== "create") return;
    expect(p.path).toBe("Mail/2026/2026-08-19-1432-hallo-welt.md");
    expect(p.emlPath).toBe("Mail/2026/_eml/2026-08-19-1432-hallo-welt.eml");
    expect(p.content).toContain("mail_id: utf8-plain-001@mail.example.org");
    expect(p.content).toContain("%% mailstone:begin %%\n## Nachricht");
    // Treueflaeche: die .eml geht byte-identisch durch den Plan (Spec § 2.2)
    expect(p.eml).toEqual(c.eml);
  });
  it("create: Kollision → -2", async () => {
    const c = await common();
    c.takenPaths.add("Mail/2026/2026-08-19-1432-hallo-welt.md");
    const p = planMailNote({ ...c, existing: null });
    expect(p.kind === "create" && p.path).toBe("Mail/2026/2026-08-19-1432-hallo-welt-2.md");
    expect(p.kind === "create" && p.emlPath).toBe("Mail/2026/_eml/2026-08-19-1432-hallo-welt-2.eml");
  });
  it("create: belegter .eml-Pfad zaehlt als Kollision (beide Pfade ruecken gemeinsam)", async () => {
    const c = await common();
    c.takenPaths.add("Mail/2026/_eml/2026-08-19-1432-hallo-welt.eml");
    const p = planMailNote({ ...c, existing: null });
    expect(p.kind === "create" && p.path).toBe("Mail/2026/2026-08-19-1432-hallo-welt-2.md");
    expect(p.kind === "create" && p.emlPath).toBe("Mail/2026/_eml/2026-08-19-1432-hallo-welt-2.eml");
  });
  it("update: bestehende Notiz mit bekanntem Hash → update/skip unchanged", async () => {
    const c = await common();
    const first = planMailNote({ ...c, existing: null });
    if (first.kind !== "create") throw new Error("expected create");
    const second = planMailNote({ ...c, existing: { path: first.path, content: first.content, zoneHash: first.zoneHash } });
    expect(second.kind).toBe("skip");
    expect(second.kind === "skip" && second.reason).toBe("unchanged");
  });
  it("spaeterer Lauf: nur mail_synced unterscheidet sich → skip unchanged (kein Schreibvorgang)", async () => {
    const c = await common();
    const first = planMailNote({ ...c, existing: null });
    if (first.kind !== "create") throw new Error("expected create");
    const second = planMailNote({ ...c, syncedAt: new Date("2026-08-23T13:00:00Z"), existing: { path: first.path, content: first.content, zoneHash: first.zoneHash } });
    expect(second.kind === "skip" && second.reason).toBe("unchanged");
  });
  it("allowUpdate false: bestehende Notiz wird nie neu gerendert (Merge-Regel 5)", async () => {
    const c = await common();
    const first = planMailNote({ ...c, existing: null });
    if (first.kind !== "create") throw new Error("expected create");
    const veraendert = first.content.replace("title: ", "title: Alt ");
    const mitUpdate = planMailNote({ ...c, existing: { path: first.path, content: veraendert, zoneHash: first.zoneHash } });
    expect(mitUpdate.kind).toBe("update");
    const ohneUpdate = planMailNote({ ...c, allowUpdate: false, existing: { path: first.path, content: veraendert, zoneHash: first.zoneHash } });
    expect(ohneUpdate.kind === "skip" && ohneUpdate.reason).toBe("unchanged");
  });
  it("skip zone-edited, wenn Hash abweicht", async () => {
    const c = await common();
    const first = planMailNote({ ...c, existing: null });
    if (first.kind !== "create") throw new Error("expected create");
    const edited = first.content.replace("## Nachricht", "## Nachricht (editiert)");
    const p = planMailNote({ ...c, existing: { path: first.path, content: edited, zoneHash: first.zoneHash } });
    expect(p.kind === "skip" && p.reason).toBe("zone-edited");
  });
});

// M5 Task 7: taskPreset ist eine Anschlussstelle fuer den Weg OHNE TaskNotes (Design § 5) —
// beleben ueber withTaskPreset() (profile.ts), das das Preset additiv in profile.onCreate
// mischt. onCreate wirkt laut plan.ts NUR im create-Zweig (newNote()), nie im Merge-Zweig
// einer bestehenden Notiz — das ist bereits die Zusage "nur beim ersten Anlegen", hier nur
// end-to-end nachgemessen statt neu gebaut.
describe("taskPreset", () => {
  it("schreibt die Preset-Felder beim ERSTEN Anlegen ins Frontmatter", async () => {
    const base = await common();
    const c = { ...base, profile: withTaskPreset(base.profile, { status: "open" }) };
    const p = planMailNote({ ...c, existing: null });
    expect(p.kind === "create" && p.content).toContain("status: open");
  });
  it("fasst sie bei einem spaeteren Lauf nicht wieder an", async () => {
    const base = await common();
    const c = { ...base, profile: withTaskPreset(base.profile, { status: "open" }) };
    const first = planMailNote({ ...c, existing: null });
    if (first.kind !== "create") throw new Error("expected create");
    // Nichts an der Notiz geaendert, aber ein spaeterer Lauf (anderes syncedAt) —
    // der onCreate-Pfad darf hier gar nicht mehr laufen.
    const second = planMailNote({ ...c, syncedAt: new Date("2026-08-23T13:00:00Z"), existing: { path: first.path, content: first.content, zoneHash: first.zoneHash } });
    expect(second.kind === "skip" && second.reason).toBe("unchanged");
  });
  it("ueberschreibt einen vom Nutzer geaenderten Wert nicht", async () => {
    const base = await common();
    const c = { ...base, profile: withTaskPreset(base.profile, { status: "open" }) };
    const first = planMailNote({ ...c, existing: null });
    if (first.kind !== "create") throw new Error("expected create");
    const userEdited = first.content.replace("status: open", "status: done");
    const p = planMailNote({ ...c, existing: { path: first.path, content: userEdited, zoneHash: first.zoneHash } });
    // "status" ist kein managed key des Profils, ein Re-Merge liesse ihn also ohnehin stehen —
    // die eigentliche Zusage ist: kein Schreibvorgang kommt hier ueberhaupt an.
    expect(p.kind === "skip" && p.reason).toBe("unchanged");
  });
  it("tut bei leerem Preset gar nichts", async () => {
    const base = await common();
    // Fix-Runde 1, Minor 3: vorher lief dieser Test ohne withTaskPreset ueberhaupt zu rufen
    // (blieb also gruen, selbst wenn withTaskPreset({}) kaputt gewesen waere) — jetzt echt
    // durch die Funktion gefuehrt, wie die drei Tests darueber.
    const c = { ...base, profile: withTaskPreset(base.profile, {}) };
    const p = planMailNote({ ...c, existing: null });
    expect(p.kind === "create" && p.content).not.toContain("status:");
  });
  // Fix-Runde 1, Minor 4: die zweite Kollision aus dem Kommentar an withTaskPreset() — ein
  // Preset-Schluessel, der einen VERWALTETEN key trifft (hier "mail_id"), darf diesen nicht
  // ueberschreiben. Das entscheidet newNote()s {...onCreate, ...derived} (merge.ts), nicht
  // withTaskPreset() selbst — ungetestet waere eine gedrehte Spread-Reihenfolge dort ein
  // stiller Datenschaden an genau diesem Feld, ohne dass irgendein Test rot wuerde.
  it("Preset gegen ein verwaltetes Feld: das verwaltete Feld gewinnt", async () => {
    const base = await common();
    const c = { ...base, profile: withTaskPreset(base.profile, { mail_id: "evil-override" }) };
    const p = planMailNote({ ...c, existing: null });
    expect(p.kind === "create" && p.content).toContain("mail_id: utf8-plain-001@mail.example.org");
    expect(p.kind === "create" && p.content).not.toContain("evil-override");
  });
});
