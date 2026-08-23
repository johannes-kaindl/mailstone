import { PluginSettingTab, Setting, type App } from "obsidian";
import { t } from "../vendor/code-kit/i18n";
import type MailstonePlugin from "../main";
import { FolderSuggest } from "../vendor/kit-obsidian/folder-suggest";

/** M1: Ordner, Jahr-Unterordner, Dateiname-Template, Sprache — Konten folgen in M2. */
export class MailstoneSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: MailstonePlugin) { super(app, plugin); }

  display(): void {
    const { containerEl } = this; containerEl.empty();
    const s = this.plugin.settings;
    new Setting(containerEl).setName(t("settings.language")).addDropdown((d) => d
      .addOptions({ auto: t("settings.language.auto"), en: "English", de: "Deutsch" }).setValue(s.language)
      .onChange(async (v) => { s.language = v as typeof s.language; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName(t("settings.folder")).setDesc(t("settings.folder.desc")).addText((tx) => {
      new FolderSuggest(this.app, tx.inputEl);
      tx.setValue(s.profile.folder).onChange(async (v) => { s.profile.folder = v.trim() || "Mail"; await this.plugin.saveSettings(); });
    });
    new Setting(containerEl).setName(t("settings.yearSubfolder")).addToggle((tg) => tg.setValue(s.profile.yearSubfolder).onChange(async (v) => { s.profile.yearSubfolder = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName(t("settings.filename")).setDesc(t("settings.filename.desc")).addText((tx) => tx.setValue(s.profile.filename).onChange(async (v) => { s.profile.filename = v.trim() || "{date}-{time}-{slug}"; await this.plugin.saveSettings(); }));
  }
}
