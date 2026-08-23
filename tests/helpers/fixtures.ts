import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
export function loadFixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(fileURLToPath(new URL(`../fixtures/eml/${name}.eml`, import.meta.url))));
}
