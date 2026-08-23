// uebernommen aus calendar-notes/tests/__mocks__/obsidian.ts, 2026-08-23
// Dünnes Alias-Ziel für vitest (PROF-OBS-08): re-exportiert den vendorten Kit-Mock.
export * from "../vendor/kit/obsidian-mock";

// Override: der vendorte Kit-Mock (Stand 0.28.0) kennt `getFrontMatterInfo` noch nicht.
// Minimale, aber zur echten Obsidian-API kompatible Nachbildung (node_modules/obsidian/
// obsidian.d.ts) — NICHT in den vendorten Mock schreiben, der wird per `tools/sync-kit.sh`
// ueberschrieben. Erkennt nur den einfachen "---\n...\n---\n"-Block am Dateianfang
// (kein YAML-Parsing noetig, nur die Offsets).
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/;

export interface FrontMatterInfo {
  exists: boolean;
  frontmatter: string;
  from: number;
  to: number;
  contentStart: number;
}

export function getFrontMatterInfo(content: string): FrontMatterInfo {
  const m = FRONTMATTER_RE.exec(content);
  if (!m) return { exists: false, frontmatter: "", from: 0, to: 0, contentStart: 0 };
  const block = m[1] ?? "";
  return { exists: true, frontmatter: block, from: 4, to: 4 + block.length, contentStart: m[0].length };
}

// Override: der vendorte Kit-Mock (Stand 0.28.0) kennt nur FuzzySuggestModal, nicht das nicht-
// fuzzy SuggestModal, das der Konto/Identitaets-Picker im Kommando "Test-Mail an mich" (M2 Task 7)
// verwendet — Bauart wie FuzzySuggestModal dort (Test-Affordances __choose/__close), nur ohne den
// FuzzyMatch<T>-Wrapper.
export class SuggestModal<T> {
  app: any;
  inputEl: { value: string } = { value: "" };
  static __instance: any = null;
  constructor(app?: any) {
    this.app = app;
    (this.constructor as any).__instance = this;
    SuggestModal.__instance = this;
  }
  setPlaceholder(_s: string): this { return this; }
  setInstructions(_i: any): this { return this; }
  getSuggestions(_query: string): T[] { return []; }
  renderSuggestion(_item: T, _el: any): void {}
  onChooseSuggestion(_item: T, _evt?: any): void {}
  open(): void {}
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
  // Test affordances (not in real Obsidian): simulate choose / dismiss.
  __choose(item: T): void { this.onChooseSuggestion(item); }
  __close(): void { this.onClose(); }
}
