#!/usr/bin/env node
// Fake-IMAP-Server fuer tests/integration — spricht nur das Subset, das core/imap/client.ts
// benutzt: CAPABILITY, AUTHENTICATE PLAIN, EXAMINE, SELECT, UID SEARCH ALL, UID FETCH
// (Header/Body), UID MOVE, LOGOUT. Kein TLS, bindet ausschliesslich an 127.0.0.1. Nie fuer
// echte Postfaecher gedacht.
//
// Start: `node scripts/fake-imap.mjs` (Port 11143, override per PORT env fuer parallele Laeufe
// im Integrationstest). Liefert einen festen Ordner mit zwei Mails, unabhaengig vom
// EXAMINE-Ordnernamen — der Test prueft nur den Dialog gegen den echten Socket, nicht Multi-
// Ordner-Logik.
//
// SELECT und UID MOVE sind absichtlich NUR fuer den schreibenden Pfad da (client.ts
// imapConnectWritable / select() / uidMove()) — der Sync-Pfad bleibt bei EXAMINE +
// BODY.PEEK und setzt nie \Seen (AGENTS.md "Ein Sync-Lauf darf \Seen nie setzen"). Dieser Fake
// unterscheidet Ordner nicht (EXAMINE/SELECT ignorieren den Namen, s.o.) — MAILS ist eine
// einzige gemeinsame Liste. UID MOVE entfernt die UID daraus: ohne diese Mutation koennte der
// GUI-Smoke fuer den Posteingang gruen melden, ohne dass je ein MOVE stattgefunden hat.
//
// Jede Mail traegt ein \Seen-Flag (Default: ungelesen). Gesetzt wird es nur von einem Fetch
// OHNE .PEEK in einem per SELECT schreibbar geoeffneten Ordner — RFC-treu, s. Kommentar bei
// UID FETCH. Ausgelesen wird es ueber `UID FETCH … (FLAGS …)`, das der Posteingang ohnehin
// benutzt, um Ungelesenes halbfett zu setzen.
import net from "node:net";

const PORT = Number(process.env.PORT ?? 11143);
const HOST = "127.0.0.1";

const MAILS = [
  {
    uid: 7,
    seen: false,
    id: "<eins@example.net>",
    raw: "From: a@example.net\r\nTo: b@example.net\r\nSubject: Erste Testmail\r\nMessage-ID: <eins@example.net>\r\nDate: Sat, 29 Aug 2026 08:00:00 +0000\r\n\r\nHallo eins\r\n",
  },
  {
    uid: 9,
    seen: false,
    id: "<zwei@example.net>",
    raw: "From: a@example.net\r\nTo: b@example.net\r\nSubject: Zweite Testmail\r\nMessage-ID: <zwei@example.net>\r\nDate: Sat, 29 Aug 2026 09:00:00 +0000\r\n\r\nHallo zwei\r\n",
  },
  // Dritte Mail bewusst mit Nicht-ASCII: IMAP-Literale zaehlen BYTES, nicht Zeichen. Hier fallen
  // beide Laengen weit auseinander (Umlaute 2 Bytes, das Emoji 4) — liest der Client Zeichen
  // statt Bytes, bleibt der Rest des Literals im Strom stehen, die Antwort desynchronisiert und
  // die folgenden Mails gehen verloren. Bis 2026-08-30 war das nur per Codelektuere belegt.
  {
    uid: 11,
    seen: false,
    id: "<drei@example.net>",
    raw: "From: a@example.net\r\nTo: b@example.net\r\nSubject: Dritte Testmail mit Umlauten\r\nMessage-ID: <drei@example.net>\r\nDate: Sat, 29 Aug 2026 10:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nGrüße aus München: Äpfel, Öl, Füße – und ein Gruß 🚀\r\n",
  },
];

// Jede empfangene Kommandozeile geht als `< …` nach stdout. Der Integrationstest liest das
// Protokoll und prueft daran den Nur-Lese-Vertrag AUF DER LEITUNG (EXAMINE + BODY.PEEK, nie
// SELECT oder BODY[]) — und zwar ueber einen ganzen Sync-Lauf hinweg, nicht Kommando fuer
// Kommando wie die Unit-Tests. Ein \Seen-Vergleich taete das nicht: ein RFC-treuer Server setzt
// im EXAMINE-Modus ohnehin keine Flags (s. Kommentar bei UID FETCH).
// Zugangsdaten werden dabei maskiert, wie client.ts es fuer seine eigenen Logs tut.
function protokolliere(tag, rest) {
  const roh = rest.join(" ");
  const gross = roh.toUpperCase();
  const sichtbar = gross.startsWith("AUTHENTICATE ") || gross.startsWith("LOGIN ")
    ? `${roh.split(" ")[0]} ****`
    : roh;
  console.log(`[fake-imap] < ${tag} ${sichtbar}`);
}

function handleConnection(socket) {
  socket.write("* OK fake-imap ready\r\n");
  let buf = "";
  // Pro Verbindung, nicht global: EXAMINE oeffnet nur-lesend, SELECT schreibbar. Genau daran
  // haengt unten, ob ein Fetch ohne .PEEK ueberhaupt \Seen setzen darf.
  const sitzung = { schreibbar: false };

  socket.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    for (let nl = buf.indexOf("\r\n"); nl !== -1; nl = buf.indexOf("\r\n")) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      handleLine(socket, line, sitzung);
    }
  });
}

function handleLine(socket, line, sitzung) {
  const [tag, ...rest] = line.split(" ");
  const cmd = rest.join(" ").toUpperCase();
  protokolliere(tag, rest);

  if (cmd === "CAPABILITY") {
    // SASL-IR gehoert dazu, weil dieser Fake genau die Initial-Response-Form von AUTHENTICATE
    // PLAIN annimmt (RFC 4959) — ohne die Capability nutzt der Client korrekterweise LOGIN.
    // MOVE und UIDPLUS stehen hier bewusst NICHT: viele Server kuendigen genau diese beiden
    // erst NACH der Anmeldung an, und zwar im Response-Code der OK-Zeile. Wer nur die Liste von
    // vor der Anmeldung liest, sieht einen faehigen Server als unfaehig — der Defekt, den M4
    // behoben hat. Dieser Fake bildet die unbequeme Variante ab, damit der Integrationstest sie
    // ueber einen echten Socket belegt und nicht nur ein Unit-Test mit Fake-Transport.
    socket.write("* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR\r\n");
    socket.write(`${tag} OK done\r\n`);
  } else if (cmd.startsWith("AUTHENTICATE PLAIN")) {
    socket.write(`${tag} OK [CAPABILITY IMAP4rev1 UIDPLUS MOVE] authenticated\r\n`);
  } else if (cmd.startsWith("EXAMINE")) {
    sitzung.schreibbar = false;
    socket.write(`* ${String(MAILS.length)} EXISTS\r\n* OK [UIDVALIDITY 4242] UIDs valid\r\n${tag} OK [READ-ONLY] done\r\n`);
  } else if (cmd.startsWith("SELECT")) {
    // Wie EXAMINE, aber [READ-WRITE] — das ist die einzige Antwort, die den Ordner fuer
    // client.ts als schreibbar ausweist (imapConnectWritable liest genau dieses Flag).
    sitzung.schreibbar = true;
    socket.write(`* ${String(MAILS.length)} EXISTS\r\n* OK [UIDVALIDITY 4242] UIDs valid\r\n${tag} OK [READ-WRITE] done\r\n`);
  } else if (cmd.startsWith("UID MOVE")) {
    // "UID MOVE <uid> <mailbox>" (RFC 6851, per UIDPLUS-Capability oben angekuendigt). Der
    // Ziel-Ordnername wird bewusst ignoriert (dieser Fake fuehrt keine getrennten Ordner) —
    // was zaehlt, ist dass die UID aus MAILS verschwindet, sonst prueft der Smoke nur den
    // Wortlaut der Antwort und nie die Wirkung.
    const teile = rest.join(" ").split(/\s+/);
    const uid = Number(teile[2]);
    const index = MAILS.findIndex((m) => m.uid === uid);
    if (index === -1) {
      socket.write(`${tag} NO [NONEXISTENT] Mail nicht gefunden\r\n`);
    } else {
      MAILS.splice(index, 1);
      socket.write(`${tag} OK [COPYUID 1 ${String(uid)} 1] Move completed\r\n`);
    }
  } else if (cmd === "UID SEARCH ALL") {
    socket.write(`* SEARCH ${MAILS.map((m) => String(m.uid)).join(" ")}\r\n${tag} OK done\r\n`);
  } else if (cmd.startsWith("UID FETCH")) {
    // ".PEEK" fehlt = der Server darf \Seen setzen — aber nur in einem SCHREIBBAR geoeffneten
    // Ordner: EXAMINE ist nach RFC 3501 § 6.3.2 read-only ("no changes to the permanent state
    // of the mailbox, including per-user state, are permitted"), dort aendert auch ein BODY[]
    // keine Flags. Der Sync-Pfad ist damit doppelt gesichert (EXAMINE per Typtrennung, dazu
    // .PEEK), und genau deshalb prueft der Integrationstest den KOMMANDOTEXT und nicht nur das
    // Flag: ein Fehler in der zweiten Sicherung bliebe an den Flags unsichtbar.
    const peek = cmd.includes("BODY.PEEK[");
    const wantsBody = cmd.includes("BODY.PEEK[]") || cmd.includes("BODY[]");
    const wantsFlags = /\bFLAGS\b/.test(cmd);
    const volleHeader = cmd.includes("FROM SUBJECT DATE");
    for (const m of MAILS) {
      if (!new RegExp(`\\b${String(m.uid)}\\b`).test(rest.join(" "))) continue;
      if (!peek && sitzung.schreibbar) m.seen = true;
      const kopf = volleHeader ? `${m.raw.split("\r\n\r\n")[0]}\r\n\r\n` : `Message-ID: ${m.id}\r\n\r\n`;
      const payload = wantsBody ? m.raw : kopf;
      const bytes = Buffer.from(payload, "utf8");
      const felder = volleHeader ? "FROM SUBJECT DATE MESSAGE-ID" : "MESSAGE-ID";
      // Die Antwort traegt immer "BODY[…]" ohne .PEEK — so schreibt es RFC 3501 § 7.4.2 vor,
      // .PEEK ist nur eine Eigenschaft der Anfrage.
      const label = wantsBody ? "BODY[]" : `BODY[HEADER.FIELDS (${felder})]`;
      const flagsTeil = wantsFlags ? `FLAGS (${m.seen ? "\\Seen" : ""}) ` : "";
      socket.write(`* ${String(m.uid)} FETCH (UID ${String(m.uid)} ${flagsTeil}${label} {${String(bytes.length)}}\r\n`);
      socket.write(bytes);
      socket.write(")\r\n");
    }
    socket.write(`${tag} OK done\r\n`);
  } else if (cmd === "LOGOUT") {
    socket.write(`* BYE\r\n${tag} OK done\r\n`);
    socket.end();
  } else {
    socket.write(`${tag} BAD unbekanntes Kommando\r\n`);
  }
}

const server = net.createServer(handleConnection);
server.listen(PORT, HOST, () => {
  console.log(`[fake-imap] listening on ${HOST}:${String(PORT)}`);
});
