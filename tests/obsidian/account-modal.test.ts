import { describe, it, expect } from "vitest";
import { App, Modal } from "obsidian";
import { AccountModal } from "../../src/obsidian/modals/account-modal";
import { newAccount } from "../../src/core/settings";
import type { SecretStore } from "../../src/vendor/kit/secrets";
import type { SocketTransport } from "../../src/core/net/types";
import { initI18n } from "../../src/i18n/strings";
import { t } from "../../src/vendor/code-kit/i18n";

initI18n("de");

const secrets: SecretStore = { get: () => null, set: () => {}, has: () => false, delete: () => {} };
const transport = (): SocketTransport => { throw new Error("kein Netz in diesem Test"); };

/** Die Zeilen des zuletzt geoeffneten Modals als { Name, Beschreibung } (der Mock haengt `__setting` an jede Zeile). */
function zeilen(followFieldWorks: (() => boolean) | undefined): { name: string; desc: string }[] {
  new AccountModal(new App(), newAccount("a"), { secrets, transport, ...(followFieldWorks ? { followFieldWorks } : {}) }, () => {}).open();
  const modal = (Modal as unknown as { __last: { contentEl: { children: { __setting?: { nameValue: string; descValue: string } }[] } } }).__last;
  return modal.contentEl.children.flatMap((c) => (c.__setting ? [{ name: c.__setting.nameValue, desc: c.__setting.descValue }] : []));
}

describe("AccountModal — Hinweis unter „Vorgängen folgen“ (A1-Nachtrag)", () => {
  it("wirkt das Folgen-Feld nicht, steht direkt unter dem Schalter ein Hinweis, dass nichts kopiert wird", () => {
    const rows = zeilen(() => false);
    const i = rows.findIndex((r) => r.name === t("settings.account.sync.follow"));
    expect(i).toBeGreaterThan(-1);
    expect(rows[i + 1]).toEqual({ name: t("settings.threadHint"), desc: t("settings.account.sync.follow.fieldOff") });
    expect(rows[i + 1]?.desc).toMatch(/kopiert .* nichts/);
  });

  it("wirkt das Folgen-Feld, bleibt der Hinweis weg", () => {
    expect(zeilen(() => true).some((r) => r.name === t("settings.threadHint"))).toBe(false);
  });

  it("ohne die Dep gibt es keinen Hinweis", () => {
    expect(zeilen(undefined).some((r) => r.name === t("settings.threadHint"))).toBe(false);
  });
});
