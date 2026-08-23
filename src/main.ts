import { Plugin, getLanguage } from "obsidian";
import { loadSettings, type MailstoneSettings } from "./core/settings";
import { initI18n } from "./i18n/strings";
import { t } from "./vendor/code-kit/i18n";
import { MailstoneSettingTab } from "./obsidian/settings-tab";
import { importEmlFolder } from "./obsidian/import-eml";
import { noticeNotifier } from "./obsidian/notifier";
import { FolderPromptModal } from "./obsidian/modals/folder-prompt";

interface PersistedState { settings: MailstoneSettings; zoneHashes: Record<string, string> }

export default class MailstonePlugin extends Plugin {
  settings: MailstoneSettings = loadSettings(undefined);
  zoneHashes: Record<string, string> = {};

  async onload(): Promise<void> {
    const raw = (await this.loadData()) as Partial<PersistedState> | null;
    this.settings = loadSettings(raw?.settings ?? raw);
    this.zoneHashes = raw?.zoneHashes ?? {};
    initI18n(this.settings.language === "auto" ? getLanguage() : this.settings.language);
    this.addSettingTab(new MailstoneSettingTab(this.app, this));
    const notify = noticeNotifier();
    this.addCommand({
      id: "import-eml-folder",
      name: t("cmd.importEml.name"),
      callback: async () => {
        const folder = await new FolderPromptModal(this.app, t("import.prompt.folder")).prompt();
        if (!folder) return;
        // finally: die Zone-Hashes der bereits geschriebenen Notizen muessen auch dann
        // persistiert werden, wenn der Lauf unterwegs wirft — sonst gilt beim naechsten Lauf
        // jede davon als fremd editiert (zone-edited) und wird nie wieder aktualisiert.
        try {
          const r = await importEmlFolder(
            {
              app: this.app,
              profile: this.settings.profile,
              hashes: { get: (k) => this.zoneHashes[k] ?? null, set: (k, v) => { this.zoneHashes[k] = v; } },
              now: () => new Date(),
            },
            folder,
          );
          notify.info("import.done", r.created, r.updated, r.skipped.length, r.errors.length);
          if (r.errors.length > 0) notify.error("import.errors", r.errors.length);
        } finally {
          await this.saveSettings();
        }
      },
    });
  }

  async saveSettings(): Promise<void> {
    await this.saveData({ settings: this.settings, zoneHashes: this.zoneHashes } satisfies PersistedState);
  }
}
