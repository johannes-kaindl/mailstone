// Sondierung fuer M5 Task 0 — laeuft NUR gegen den Staging-Vault, nie gegen einen Produktivvault.
import { attachTo } from "../../tools/obsidian-cdp/cdp.js";

async function main(): Promise<void> {
  const cdp = await attachTo("workspace", 9222, "mailstone");
  if (!cdp) throw new Error("kein Fenster fuer den Staging-Vault mailstone");
  const out = await cdp.evaluate<unknown>(`
    const api = app.plugins.plugins["tasknotes"].api;
    const versuche = [
      { was: "minimal", data: { title: "M5-Sondierung minimal" } },
      { was: "mit due", data: { title: "M5-Sondierung mit due", due: "2026-12-24" } },
      { was: "mit dueDate", data: { title: "M5-Sondierung mit dueDate", dueDate: "2026-12-24" } },
      { was: "mit details", data: { title: "M5-Sondierung mit details", details: "[[Mail/2026/probe]]" } },
      { was: "leerer Titel", data: { title: "" } },
      { was: "unbekanntes Feld", data: { title: "M5-Sondierung Fremdfeld", gibtsNicht: 1 } },
    ];
    const ergebnisse = [];
    for (const v of versuche) {
      let validate = null;
      try { validate = api.model.validateTask ? await api.model.validateTask(v.data) : "keine validateTask"; }
      catch (e) { validate = "THROW: " + e.message; }
      let create = null;
      try { const r = await api.tasks.create(v.data); create = { typ: typeof r, wert: r }; }
      catch (e) { create = "THROW: " + e.name + ": " + e.message; }
      ergebnisse.push({ was: v.was, validate, create });
    }
    return ergebnisse;
  `);
  console.log(JSON.stringify(out, null, 2));
  cdp.close();
}
main().catch((e: Error) => { console.error("FEHLER:", e.message); process.exit(1); });
