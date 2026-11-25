// vendored from obsidian-kit@0.111.0, src/obsidian/capability-apis.ts — do not hand-edit; re-vendor via tools/sync-kit.sh
import { IMAGE_GEN_PLUGIN_ID, isImageGenProviderApi, type ImageGenProviderApi } from "../kit/image-gen-provider";
import { OCR_PLUGIN_ID, isOcrProviderApi, type OcrProviderApi } from "../kit/ocr-provider";
import { DESCRIBE_PLUGIN_ID, isDescribeProviderApi, type DescribeProviderApi } from "../kit/describe-provider";
import { PSEUDONYMIZER_PLUGIN_ID, isPseudonymizerApi, type PseudonymizerApi } from "../kit/pseudonymizer-source";
import { readPluginApi } from "./plugin-api";

/** Die Bildgenerierungs-API von `local-image-generator` oder `null` (Plugin fehlt, abgeschaltet, falsche Form oder Version). Frisch je Aufruf. */
export function readImageGenApi(app: unknown): ImageGenProviderApi | null {
  return readPluginApi(app, IMAGE_GEN_PLUGIN_ID, isImageGenProviderApi);
}

/** Die OCR-API von `image-to-markdown` oder `null`. */
export function readOcrApi(app: unknown): OcrProviderApi | null {
  return readPluginApi(app, OCR_PLUGIN_ID, isOcrProviderApi);
}

/** Die Beschreibungs-API von `image-to-markdown` (`describeImage`) oder `null`. Dasselbe `api`-Objekt wie bei `readOcrApi`, anderer Form-Guard: ein Anbieter ohne `describeImage` liefert hier `null`. */
export function readDescribeApi(app: unknown): DescribeProviderApi | null {
  return readPluginApi(app, DESCRIBE_PLUGIN_ID, isDescribeProviderApi);
}

/** Die Pseudonymisierungs-API von `pseudonymizer` (Vertrag v1, `pure/pseudonymizer-source`) oder `null` (Plugin fehlt, abgeschaltet, falsche Form oder Version). Frisch je Aufruf.
 *  Wer etwas schreibt oder hinausgibt, liest sie nicht selbst, sondern ruft `pseudonymizeFor` / `restoreFor`: dort steht, was bei `null` gilt (es ist nicht überall Klartext). */
export function readPseudonymizerApi(app: unknown): PseudonymizerApi | null {
  return readPluginApi(app, PSEUDONYMIZER_PLUGIN_ID, isPseudonymizerApi);
}
