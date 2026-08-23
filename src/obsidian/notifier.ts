import { Notice } from "obsidian";
import { t } from "../vendor/code-kit/i18n";

export interface Notifier { info(key: string, ...args: (string | number)[]): void; error(key: string, ...args: (string | number)[]): void }

export function noticeNotifier(): Notifier {
  return { info: (k, ...a) => { new Notice(t(k, ...a)); }, error: (k, ...a) => { new Notice(t(k, ...a), 8000); } };
}
