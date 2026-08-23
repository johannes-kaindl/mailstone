import { ButtonComponent, Modal, Setting, type App } from "obsidian";
import { t } from "../../vendor/code-kit/i18n";
import { FolderSuggest } from "../../vendor/kit-obsidian/folder-suggest";

/** Ein Textfeld (mit Ordner-Autocomplete) + OK/Abbrechen, als Promise: `open()` löst bei OK mit
 *  dem getrimmten Wert auf, bei Abbrechen/Schließen mit `null`. Muster: `SchemaFormModal` in
 *  calendar-notes (`src/obsidian/command-modal.ts`) — hier nur ein einzelnes Feld statt eines
 *  Schema-Formulars. */
export class FolderPromptModal extends Modal {
  private value = "";
  private resolved = false;
  private resolveFn: ((v: string | null) => void) | null = null;

  constructor(
    app: App,
    private readonly label: string,
  ) {
    super(app);
  }

  /** Nicht `open()` überschrieben (Modal.open() ist void — eine Promise-Rückgabe dort
   *  verletzt @typescript-eslint/no-misused-promises); dieser Name ist der Vertrag nach außen. */
  prompt(): Promise<string | null> {
    return new Promise((resolve) => {
      this.resolveFn = resolve;
      this.open();
    });
  }

  onOpen(): void {
    this.titleEl.setText(this.label);
    new Setting(this.contentEl).setName(this.label).addText((c) => {
      new FolderSuggest(this.app, c.inputEl);
      c.onChange((v) => { this.value = v; });
    });

    const btns = this.contentEl.createDiv({ cls: "modal-button-container" });
    new ButtonComponent(btns).setButtonText(t("form.cancel")).onClick(() => this.close());
    new ButtonComponent(btns)
      .setButtonText(t("form.submit"))
      .setCta()
      .onClick(() => this.submit());
  }

  onClose(): void {
    this.contentEl.empty();
    this.finish(null);
  }

  private submit(): void {
    const v = this.value.trim();
    this.finish(v.length > 0 ? v : null);
    this.close();
  }

  private finish(v: string | null): void {
    if (this.resolved) return;
    this.resolved = true;
    this.resolveFn?.(v);
  }
}
