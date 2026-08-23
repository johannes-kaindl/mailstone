import { parseFrontmatter, serializeFrontmatter, type FmValue } from "../../vendor/kit/frontmatter";
import type { FmVal } from "../mirror/profile";
import { splitBody, wrapBlock, zoneHash } from "./fences";

export type MergeErrorCode = "fences-missing" | "zone-edited" | "frontmatter-unparseable";
export interface MergeInput {
  existing: string;
  derived: Record<string, FmVal>;
  managed: string[];
  block: string;
  expectedZoneHash: string | null; // null = noch kein Hash bekannt (Erstanlage via Import)
}
export type MergeResult =
  | { ok: true; content: string; changed: boolean; zoneHash: string }
  | { ok: false; code: MergeErrorCode };

const toFm = (v: FmVal): FmValue => (typeof v === "boolean" ? String(v) : v);

// serializeFrontmatter liefert bereits den vollstaendigen "---\n...\n---\n"-Block MIT
// Delimitern (siehe src/vendor/kit/frontmatter.ts) — hier also kein zweites Wrapping.
function fmBlock(data: Record<string, FmValue>, order: string[]): string {
  return serializeFrontmatter(data, order);
}

export function newNote(
  derived: Record<string, FmVal>,
  onCreate: Record<string, FmVal>,
  block: string,
  userHead = "## Notizen\n\n",
): { content: string; zoneHash: string } {
  const data: Record<string, FmValue> = {};
  const order: string[] = [];
  for (const [k, v] of Object.entries({ ...onCreate, ...derived })) {
    data[k] = toFm(v);
    order.push(k);
  }
  return { content: `${fmBlock(data, order)}\n${userHead}${wrapBlock(block)}\n`, zoneHash: zoneHash(block) };
}

export function mergeNote(input: MergeInput): MergeResult {
  const parsed = parseFrontmatter(input.existing);
  // parseFrontmatter liefert immer { data, order, body } (ohne Block: data {} / order [] / body = text);
  // "frontmatter-unparseable" greift, wenn der Text zwar mit "---" beginnt, aber kein schliessendes "---" hat.
  if (input.existing.startsWith("---") && parsed.order.length === 0 && parsed.body === input.existing) {
    return { ok: false, code: "frontmatter-unparseable" };
  }
  const { before, block, after } = splitBody(parsed.body);
  if (block === null) return { ok: false, code: "fences-missing" };
  if (input.expectedZoneHash !== null && zoneHash(block) !== input.expectedZoneHash) {
    return { ok: false, code: "zone-edited" };
  }
  const data: Record<string, FmValue> = { ...parsed.data };
  const order = [...parsed.order];
  for (const k of input.managed) {
    if (Object.hasOwn(input.derived, k)) {
      data[k] = toFm(input.derived[k] as FmVal);
      if (!order.includes(k)) order.push(k);
    }
  }
  const content = `${fmBlock(data, order)}${before}${wrapBlock(input.block)}${after}`;
  return { ok: true, content, changed: content !== input.existing, zoneHash: zoneHash(input.block) };
}
