import { PluginSettingTab, type App, type SettingDefinitionItem } from "obsidian";
import { t } from "../vendor/code-kit/i18n";
import type MailstonePlugin from "../main";

/** M1: Ordner, Jahr-Unterordner, Dateiname-Template, Sprache — Konten folgen in M2.
 *  Deklarativ (`getSettingDefinitions()`, `minAppVersion` 1.13.0) — kein `display()`-Fallback,
 *  s. calendar-notes/src/obsidian/settings-tab.ts (Kopfkommentar dort): ein zusaetzliches
 *  `display()` neben `getSettingDefinitions()` waere selbst eine Scanner-Warnung
 *  (`obsidianmd/settings-tab/no-deprecated-display`). Der Ordner-Wert nutzt den nativen
 *  `folder`-Control-Typ (eigener Vault-Ordner-Suggester, seit 1.13.0) statt der vendorten
 *  `FolderSuggest` — die deklarative API bringt die Autocomplete-Fähigkeit bereits mit. */
export class MailstoneSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: MailstonePlugin) { super(app, plugin); }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return [
      {
        name: t("settings.language"),
        control: {
          type: "dropdown",
          key: "language",
          options: { auto: t("settings.language.auto"), en: "English", de: "Deutsch" },
        },
      },
      {
        name: t("settings.folder"),
        desc: t("settings.folder.desc"),
        control: { type: "folder", key: "profile.folder", includeRoot: true },
      },
      {
        name: t("settings.yearSubfolder"),
        control: { type: "toggle", key: "profile.yearSubfolder" },
      },
      {
        name: t("settings.filename"),
        desc: t("settings.filename.desc"),
        control: { type: "text", key: "profile.filename" },
      },
    ];
  }

  getControlValue(key: string): unknown {
    const s = this.plugin.settings;
    if (key === "language") return s.language;
    if (key === "profile.folder") return s.profile.folder;
    if (key === "profile.yearSubfolder") return s.profile.yearSubfolder;
    if (key === "profile.filename") return s.profile.filename;
    return undefined;
  }

  async setControlValue(key: string, value: unknown): Promise<void> {
    const s = this.plugin.settings;
    if (key === "language") {
      s.language = value as typeof s.language;
    } else if (key === "profile.folder") {
      s.profile.folder = typeof value === "string" ? value.trim() || "Mail" : "Mail";
    } else if (key === "profile.yearSubfolder") {
      s.profile.yearSubfolder = Boolean(value);
    } else if (key === "profile.filename") {
      s.profile.filename = typeof value === "string" ? value.trim() || "{date}-{time}-{slug}" : "{date}-{time}-{slug}";
    } else {
      return;
    }
    await this.plugin.saveSettings();
  }
}
