// In-Memory-Vault fuer Tests, die auf dem vendorten Kit-Mock (makeFakeApp()) aufbauen.
// Der Kit-Mock selbst ist ein Spy-Stub ohne Dateibaum (create liefert ein leeres TFile,
// adapter.exists ist immer true, getFileCache immer null) — fuer PlanExecutor/findMailNotes
// braucht es echte Persistenz innerhalb eines Tests. Ergaenzt makeFakeApp() per
// mockImplementation, ersetzt/aendert den vendorten Mock nicht. Wird auch von Task 10 benutzt.
import { makeFakeApp, TFile } from "../vendor/kit/obsidian-mock";
import { parseFrontmatter, serializeFrontmatter, type FmValue } from "../../src/vendor/kit/frontmatter";

export { TFile };

interface Entry {
  content: string | ArrayBuffer;
  file: TFile;
}

function isBinary(v: string | ArrayBuffer): v is ArrayBuffer {
  return v instanceof ArrayBuffer;
}

// Rueckgabetyp bleibt lose (any), wie makeFakeApp() selbst — Kit-Mock-Konvention;
// eslint laeuft ohnehin nicht ueber tests/ (siehe eslint.config.mjs ignores).
export function makeApp(seed?: { path: string; frontmatter: Record<string, FmValue> }[]): any {
  const app = makeFakeApp();
  const files = new Map<string, Entry>();
  const folders = new Set<string>();

  // Synchrones Vorbelegen fuer Tests, die nur das Frontmatter brauchen (z. B. mailIndex) —
  // ohne den Umweg ueber async app.vault.create.
  for (const s of seed ?? []) {
    const content = serializeFrontmatter(s.frontmatter, Object.keys(s.frontmatter));
    files.set(s.path, { content, file: new TFile(s.path) });
  }

  app.vault.create = async (path: string, content: string): Promise<TFile> => {
    if (files.has(path)) throw new Error(`memory-vault: bereits vorhanden: ${path}`);
    const file = new TFile(path);
    files.set(path, { content, file });
    return file;
  };
  app.vault.createBinary = async (path: string, data: ArrayBuffer): Promise<TFile> => {
    if (files.has(path)) throw new Error(`memory-vault: bereits vorhanden: ${path}`);
    const file = new TFile(path);
    files.set(path, { content: data, file });
    return file;
  };
  app.vault.createFolder = async (path: string): Promise<void> => {
    folders.add(path);
  };
  app.vault.modify = async (file: TFile, content: string): Promise<void> => {
    const e = files.get(file.path);
    if (!e) throw new Error(`memory-vault: nicht gefunden: ${file.path}`);
    e.content = content;
  };
  app.vault.read = async (file: TFile): Promise<string> => {
    const e = files.get(file.path);
    if (!e || isBinary(e.content)) throw new Error(`memory-vault: keine Textdatei: ${file.path}`);
    return e.content;
  };
  app.vault.cachedRead = app.vault.read;
  app.vault.readBinary = async (file: TFile): Promise<ArrayBuffer> => {
    const e = files.get(file.path);
    if (!e || !isBinary(e.content)) throw new Error(`memory-vault: keine Binaerdatei: ${file.path}`);
    return e.content;
  };
  app.vault.getFiles = (): TFile[] => [...files.values()].map((e) => e.file);
  app.vault.getMarkdownFiles = (): TFile[] =>
    [...files.values()].map((e) => e.file).filter((f) => f.extension === "md");
  app.vault.getAbstractFileByPath = (path: string): TFile | null => files.get(path)?.file ?? null;

  app.vault.adapter.exists = async (path: string): Promise<boolean> => files.has(path) || folders.has(path);
  app.vault.adapter.read = async (path: string): Promise<string> => {
    const e = files.get(path);
    if (!e || isBinary(e.content)) throw new Error(`memory-vault: keine Textdatei: ${path}`);
    return e.content;
  };

  app.metadataCache.getFileCache = (file: TFile): { frontmatter: Record<string, FmValue> } | null => {
    const e = files.get(file.path);
    if (!e || isBinary(e.content)) return null;
    return { frontmatter: parseFrontmatter(e.content).data };
  };

  app.fileManager.processFrontMatter = async (
    file: TFile,
    fn: (fm: Record<string, FmValue>) => void,
  ): Promise<void> => {
    const e = files.get(file.path);
    if (!e || isBinary(e.content)) throw new Error(`memory-vault: keine Textdatei: ${file.path}`);
    const parsed = parseFrontmatter(e.content);
    const fm: Record<string, FmValue> = { ...parsed.data };
    fn(fm);
    const order = [...parsed.order];
    for (const k of Object.keys(fm)) if (!order.includes(k)) order.push(k);
    e.content = `${serializeFrontmatter(fm, order)}${parsed.body}`;
  };

  return Object.assign(app, { __files: files });
}
