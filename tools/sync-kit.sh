#!/bin/sh
# uebernommen aus calendar-notes/tools/sync-kit.sh, 2026-08-23
# Vendort Kit-Module byte-identisch aus den Schwester-Repos (Dach-AGENTS.md, Kit-first).
# Nie von Hand editieren — Skript neu laufen lassen.
#
# Gelesen wird aus FESTEN Refs (KIT_REF, CODEKIT_REF), nicht aus dem Arbeitsstand der
# Nachbar-Repos: beide laufen weiter (obsidian-kit steht auf 0.30.0, code-kit auf 0.5.0,
# vendort ist 0.28.0/0.1.0), und ein `cat` aus deren Arbeitsverzeichnis liefert je nach
# deren HEAD etwas anderes, statt den Pin zu tragen, den VENDOR.json behauptet.
# `git show <ref>:<pfad>` ist reproduzierbar und stoert keine parallele Session im
# Nachbar-Repo (kein checkout).
#
# Zweiter Lauf darf keinen Diff erzeugen — das ist die Probe darauf, dass Header und
# VENDOR.json deterministisch sind (deshalb steht hier KEIN Datum: es wuerde jeden Lauf
# einen Diff erzeugen).
set -e
KIT=${KIT_DIR:-../obsidian-kit}
CODEKIT=${CODEKIT_DIR:-"$HOME/Projects/jkaindl/libs/code-kit"}
KIT_REF=${KIT_REF:-0.37.1}
CODEKIT_REF=${CODEKIT_REF:-0.6.0}

# Der Tag-Commit, nicht der Repo-HEAD: HEAD steht auf einem spaeteren Stand, und ein daraus
# gelesener SHA widerspraeche der vendorierten Version. `^{commit}` peelt ein annotiertes Tag
# auf seinen Commit — ohne die Peelung landet sonst das Tag-OBJEKT in VENDOR.json.
sha_von() { git -C "$1" rev-parse --short "$2^{commit}"; }
ver_von() { git -C "$1" describe --tags --abbrev=0 "$2"; }

K_SHA=$(sha_von "$KIT" "$KIT_REF");         K_VER=$(ver_von "$KIT" "$KIT_REF")
CK_SHA=$(sha_von "$CODEKIT" "$CODEKIT_REF"); CK_VER=$(ver_von "$CODEKIT" "$CODEKIT_REF")

mkdir -p src/vendor/code-kit src/vendor/kit src/vendor/kit-obsidian tests/vendor/kit

CK_MODULES="timeout sha256 filename-template settings i18n"
K_PURE="frontmatter vault-path secrets"
K_OBS="settings_walker folder-suggest confirm hub secrets"

# VORPRUEFUNG, bevor irgendetwas geschrieben wird.
#
# Ein Abbruch mitten im Lauf ist zu spaet: er rettet nur die Datei, an der er ausloest, und
# laesst die vorher geschriebenen auf dem neuen (oder fehlenden) Stand zurueck — der
# Vendor-Ordner ist danach halb alt, halb neu, und `set -e` sieht "korrekt" abgebrochen aus.
# Deshalb: erst pruefen, ob JEDE Quelle in ihrer Ref existiert, dann schreiben.
fehlend=""
for f in $CK_MODULES; do
  git -C "$CODEKIT" cat-file -e "$CODEKIT_REF:src/ts/pure/$f.ts" 2>/dev/null \
    || fehlend="$fehlend src/ts/pure/$f.ts@code-kit:$CODEKIT_REF"
done
for f in $K_PURE; do
  git -C "$KIT" cat-file -e "$KIT_REF:src/pure/$f.ts" 2>/dev/null \
    || fehlend="$fehlend src/pure/$f.ts@obsidian-kit:$KIT_REF"
done
git -C "$KIT" cat-file -e "$KIT_REF:src/testing/obsidian-mock.ts" 2>/dev/null \
  || fehlend="$fehlend src/testing/obsidian-mock.ts@obsidian-kit:$KIT_REF"
for f in $K_OBS; do
  git -C "$KIT" cat-file -e "$KIT_REF:src/obsidian/$f.ts" 2>/dev/null \
    || fehlend="$fehlend src/obsidian/$f.ts@obsidian-kit:$KIT_REF"
done
if [ -n "$fehlend" ]; then
  echo "FEHLER: fehlende Quellen, nichts geschrieben:" >&2
  for m in $fehlend; do echo "        $m" >&2; done
  exit 1
fi

# vendor <zielpfad> <quell-repo> <ref> <repo-name-fuer-header> <version-label> <kit-relativer-quellpfad>
#
# Schreibt ERST nach .tmp und verschiebt NUR bei Erfolg. Grund: die naheliegende Form
# `{ printf header; git show ...; } > ziel` legt die Zieldatei an, BEVOR `git show` laeuft —
# fehlt die Quelle in der Ref, bleibt eine Datei zurueck, die nur aus dem Herkunftsstempel
# besteht und wie ein gueltiges Vendoring aussieht. Die Vorpruefung oben faengt das im
# Regelfall schon ab; .tmp+mv ist der zweite Riegel fuer denselben Fall.
vendor() {
  tmp="$1.tmp"
  { printf '%s\n' "// vendored from $4@$5, $6 — do not hand-edit; re-vendor via tools/sync-kit.sh"
    git -C "$2" show "$3:$6"; } > "$tmp" || {
      rm -f "$tmp"
      echo "FEHLER: $6 fehlt in $4@$5 — nichts geschrieben." >&2
      exit 1
    }
  mv "$tmp" "$1"
}

for f in $CK_MODULES; do
  vendor "src/vendor/code-kit/$f.ts" "$CODEKIT" "$CODEKIT_REF" code-kit "$CK_VER" "src/ts/pure/$f.ts"
done
for f in $K_PURE; do
  vendor "src/vendor/kit/$f.ts" "$KIT" "$KIT_REF" obsidian-kit "$K_VER" "src/pure/$f.ts"
done
vendor tests/vendor/kit/obsidian-mock.ts "$KIT" "$KIT_REF" obsidian-kit "$K_VER" src/testing/obsidian-mock.ts
for f in $K_OBS; do
  vendor "src/vendor/kit-obsidian/$f.ts" "$KIT" "$KIT_REF" obsidian-kit "$K_VER" "src/obsidian/$f.ts"
  # Import-Umschreibung (Muster calendar-notes/tools/sync-kit.sh): obsidian-kit haelt die
  # reinen Module unter src/pure/, hier liegen sie sibling zu kit-obsidian/ unter src/vendor/kit/
  # — ein Import "../pure/x" aus der Kit-Quelle muss deshalb auf "../kit/x" zeigen (gleiche
  # relative Tiefe, nur anderer Ordnername). Betrifft secrets.ts (importiert ../pure/secrets).
  sed -i.bak 's#from "\.\./pure/#from "../kit/#g' "src/vendor/kit-obsidian/$f.ts"
  rm -f "src/vendor/kit-obsidian/$f.ts.bak"
done

# stamp <verzeichnis> <source> <version> <sha> <modul-liste>
#
# Kein Datumsfeld: es machte die Determinismus-Probe (zweiter Lauf ohne Diff) unmoeglich,
# wie in vault-rag/tools/sync-kit.sh. "vendored" traegt stattdessen die Modulliste.
stamp() {
  printf '{\n  "source": "%s",\n  "version": "%s",\n  "sha": "%s",\n  "vendored": "%s"\n}\n' \
    "$2" "$3" "$4" "$5" > "$1/VENDOR.json"
}
stamp src/vendor/code-kit code-kit "$CK_VER" "$CK_SHA" "$(printf '%s.ts, ' $CK_MODULES | sed 's/, $//')"
stamp src/vendor/kit obsidian-kit "$K_VER" "$K_SHA" "$(printf '%s.ts, ' $K_PURE | sed 's/, $//')"
stamp tests/vendor/kit obsidian-kit "$K_VER" "$K_SHA" obsidian-mock.ts
stamp src/vendor/kit-obsidian obsidian-kit "$K_VER" "$K_SHA" "$(printf '%s.ts, ' $K_OBS | sed 's/, $//')"

echo "vendored: code-kit@$CK_VER ($CK_SHA): $CK_MODULES | obsidian-kit@$K_VER ($K_SHA): $K_PURE obsidian-mock $K_OBS"
