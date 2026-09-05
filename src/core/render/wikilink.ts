/**
 * Ein Vault-Pfad als Wikilink — oder null, wenn er sich nicht als einer schreiben laesst.
 *
 * Obsidian kennt in `[[…]]` keine Fluchtsymbole: `[` und `]` beenden bzw. verschachteln die
 * Klammerung, `#` beginnt eine Ueberschriftsreferenz, `^` eine Blockreferenz und `|` den
 * Anzeigetext. Ein Pfad mit einem dieser Zeichen ergibt keinen kaputten Link, den man
 * reparieren koennte, sondern einen, der auf etwas ANDERES zeigt.
 *
 * Der Aufrufer faellt bei null auf den unverlinkten Rohwert zurueck (die Message-ID). Das ist
 * die konservative Seite: eine sichtbare ID ist eine Unbequemlichkeit, ein Link auf die
 * falsche Notiz ist ein Fehler.
 */
const BRICHT_WIKILINK = /[[\]#^|]/;

export function wikilink(path: string): string | null {
  if (path === "" || BRICHT_WIKILINK.test(path)) return null;
  return `[[${path}]]`;
}
