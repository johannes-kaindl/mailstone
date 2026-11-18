#!/usr/bin/env node
// Fake-IMAP-Server fuer tests/integration — spricht nur das Subset, das core/imap/client.ts
// benutzt: CAPABILITY, AUTHENTICATE PLAIN, EXAMINE, SELECT, UID SEARCH ALL, UID SEARCH HEADER MESSAGE-ID, UID FETCH
// (Header/Body), UID MOVE, UID COPY, LOGOUT. Kein TLS, bindet ausschliesslich an 127.0.0.1. Nie fuer
// echte Postfaecher gedacht.
//
// Start: `node scripts/fake-imap.mjs` (Port 11143, override per PORT env fuer parallele Laeufe
// im Integrationstest). Ordner: `Sent` hat seine eigene Mail-Liste (SENT_MAILS), `Leer` ist
// leer, `Ziel` hat eine eigene Liste (ZIEL_MAILS, der Allowlist-Ordner des Kopier-Tests); JEDER ANDERE Name (INBOX, Vault, Vault/Belege, …) liefert dieselbe gemeinsame Liste
// MAILS — so laufen die aelteren Tests, die den Ordnernamen beliebig waehlen, unveraendert.
//
// SELECT und UID MOVE sind absichtlich NUR fuer den schreibenden Pfad da (client.ts
// imapConnectWritable / select() / uidMove()) — der Sync-Pfad bleibt bei EXAMINE +
// BODY.PEEK und setzt nie \Seen (AGENTS.md "Ein Sync-Lauf darf \Seen nie setzen"). Dieser Fake
// unterscheidet nur `Sent` und `Leer` von dem Rest (s.o.) — MAILS ist fuer alle uebrigen Namen
// eine einzige gemeinsame Liste. UID MOVE entfernt die UID aus der Liste des offenen Ordners: ohne diese Mutation koennte der
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
    raw: "From: a@example.net\r\nTo: b@example.net\r\nSubject: Zweite Testmail\r\nMessage-ID: <zwei@example.net>\r\nIn-Reply-To: <eins@example.net>\r\nDate: Sat, 29 Aug 2026 09:00:00 +0000\r\n\r\nHallo zwei\r\n",
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

// Der Ordner `Sent` (A1, Vorgang folgen): eine Antwort auf `eins` im Suchfenster, eine Mail weit davor
// (faellt aus `UID SEARCH SINCE`) und eine, die nur ueber References auf `zwei` verweist.
const SENT_MAILS = [
  {
    uid: 3,
    seen: true,
    id: "<antwort-eins@example.net>",
    raw: "From: b@example.net\r\nTo: a@example.net\r\nSubject: Re: Erste Testmail\r\nMessage-ID: <antwort-eins@example.net>\r\nIn-Reply-To: <eins@example.net>\r\nReferences: <eins@example.net>\r\nDate: Sun, 30 Aug 2026 08:00:00 +0000\r\n\r\nDanke\r\n",
  },
  {
    uid: 4,
    seen: true,
    id: "<alt@example.net>",
    raw: "From: b@example.net\r\nTo: a@example.net\r\nSubject: Re: Erste Testmail (alt)\r\nMessage-ID: <alt@example.net>\r\nIn-Reply-To: <eins@example.net>\r\nDate: Thu, 01 Jan 2026 08:00:00 +0000\r\n\r\nzu alt\r\n",
  },
  {
    uid: 5,
    seen: true,
    id: "<ohne-bezug@example.net>",
    raw: "From: b@example.net\r\nTo: c@example.net\r\nSubject: Etwas ganz anderes\r\nMessage-ID: <ohne-bezug@example.net>\r\nDate: Sun, 30 Aug 2026 09:00:00 +0000\r\n\r\nohne Bezug\r\n",
  },
];

// Der Ordner `Ziel` (A1, Uebernahme): ein Allowlist-Ordner mit einer eigenen, fremden Mail. `UID COPY` legt hier Kopien ab.
const ZIEL_MAILS = [
  {
    uid: 2,
    seen: true,
    id: "<vorhanden@example.net>",
    raw: "From: c@example.net\r\nTo: b@example.net\r\nSubject: Schon im Ziel\r\nMessage-ID: <vorhanden@example.net>\r\nDate: Fri, 28 Aug 2026 08:00:00 +0000\r\n\r\nSchon da\r\n",
  },
];
const LEER_MAILS = [];

/** Die Mail-Liste eines Ordnernamens (`EXAMINE "Sent"` -> SENT_MAILS). Unbekannte Namen: MAILS. */
function listeFuer(name) {
  if (name.toLowerCase() === "sent") return SENT_MAILS;
  if (name.toLowerCase() === "leer") return LEER_MAILS;
  if (name.toLowerCase() === "ziel") return ZIEL_MAILS;
  return MAILS;
}

function mailsOf(rest) {
  const name = /^(?:EXAMINE|SELECT)\s+"?([^"]*)"?$/i.exec(rest.join(" "))?.[1] ?? "";
  return listeFuer(name);
}

/** Der Tag einer Mail (UTC), `YYYYMMDD`, aus ihrem Date-Header. */
function dayOf(m) {
  const d = new Date(/^Date: (.+)$/m.exec(m.raw)?.[1] ?? "");
  return Number.isNaN(d.getTime()) ? 0 : d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

const MONATE = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

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
  const sitzung = { schreibbar: false, mails: MAILS, offen: false };

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
    sitzung.offen = true;
    sitzung.mails = mailsOf(rest);
    socket.write(`* ${String(sitzung.mails.length)} EXISTS\r\n* OK [UIDVALIDITY 4242] UIDs valid\r\n${tag} OK [READ-ONLY] done\r\n`);
  } else if (cmd.startsWith("SELECT")) {
    // Wie EXAMINE, aber [READ-WRITE] — das ist die einzige Antwort, die den Ordner fuer
    // client.ts als schreibbar ausweist (imapConnectWritable liest genau dieses Flag).
    sitzung.schreibbar = true;
    sitzung.offen = true;
    sitzung.mails = mailsOf(rest);
    socket.write(`* ${String(sitzung.mails.length)} EXISTS\r\n* OK [UIDVALIDITY 4242] UIDs valid\r\n${tag} OK [READ-WRITE] done\r\n`);
  } else if (cmd.startsWith("UID MOVE")) {
    // "UID MOVE <uid> <mailbox>" (RFC 6851, per UIDPLUS-Capability oben angekuendigt). Der
    // Ziel-Ordnername wird bewusst ignoriert (dieser Fake fuehrt keine getrennten Ordner) —
    // was zaehlt, ist dass die UID aus MAILS verschwindet, sonst prueft der Smoke nur den
    // Wortlaut der Antwort und nie die Wirkung.
    const teile = rest.join(" ").split(/\s+/);
    const uid = Number(teile[2]);
    const index = sitzung.mails.findIndex((m) => m.uid === uid);
    if (index === -1) {
      socket.write(`${tag} NO [NONEXISTENT] Mail nicht gefunden\r\n`);
    } else {
      sitzung.mails.splice(index, 1);
      socket.write(`${tag} OK [COPYUID 1 ${String(uid)} 1] Move completed\r\n`);
    }
  } else if (cmd.startsWith("UID COPY ")) {
    // `UID COPY <uid> "<ziel>"` (RFC 3501 § 6.4.7) im ausgewaehlten Zustand, auch nach EXAMINE: die Quelle bleibt, die Kopie
    // behaelt die Flags und bekommt im Ziel eine neue UID. Eine UID ohne Treffer ergibt OK ohne COPYUID (RFC 4315).
    // Ohne geoeffneten Ordner: BAD, wie bei einem echten Server. Die Ziele `Fehlt` und `Voll` lehnt der Fake mit NO ab.
    const t = /^UID COPY (\d+) "((?:[^"\\]|\\.)*)"$/i.exec(rest.join(" "));
    const ziel = t?.[2]?.replace(/\\(.)/g, "$1");
    if (!sitzung.offen) {
      socket.write(`${tag} BAD Kein Ordner ausgewaehlt\r\n`);
    } else if (!t || ziel === undefined) {
      socket.write(`${tag} BAD Argumente nicht lesbar\r\n`);
    } else if (ziel.toLowerCase() === "fehlt") {
      socket.write(`${tag} NO [TRYCREATE] Mailbox does not exist\r\n`);
    } else if (ziel.toLowerCase() === "voll") {
      socket.write(`${tag} NO [OVERQUOTA] Quota exceeded\r\n`);
    } else {
      const uid = Number(t[1]);
      const quelle = sitzung.mails.find((m) => m.uid === uid);
      if (!quelle) {
        socket.write(`${tag} OK Copy completed\r\n`);
      } else {
        const liste = listeFuer(ziel);
        const neu = liste.reduce((hoechste, m) => Math.max(hoechste, m.uid), 0) + 1;
        liste.push({ ...quelle, uid: neu });
        socket.write(`${tag} OK [COPYUID 4242 ${String(uid)} ${String(neu)}] Copy completed\r\n`);
      }
    }
  } else if (cmd.startsWith("UID SEARCH HEADER ")) {
    // `UID SEARCH HEADER <feld> "<wert>"` (RFC 3501 § 6.4.4): Teilstring-Treffer ohne Beachtung der
    // Gross-/Kleinschreibung. Unterstuetzt wird nur MESSAGE-ID, sonst eine leere Antwort. Der Wert
    // kommt aus der ORIGINALzeile (cmd ist grossgeschrieben).
    const treffer = /^UID SEARCH HEADER (\S+) "((?:[^"\\]|\\.)*)"$/i.exec(rest.join(" "));
    const feld = treffer?.[1]?.toUpperCase();
    const wert = treffer?.[2]?.replace(/\\(.)/g, "$1").toLowerCase();
    const uids = feld === "MESSAGE-ID" && wert
      ? sitzung.mails.filter((m) => m.id.toLowerCase().includes(wert)).map((m) => String(m.uid))
      : [];
    socket.write(`* SEARCH${uids.length > 0 ? ` ${uids.join(" ")}` : ""}\r\n${tag} OK done\r\n`);
  } else if (cmd.startsWith("UID SEARCH SINCE ")) {
    // `UID SEARCH SINCE dd-Mon-yyyy` (RFC 3501 § 6.4.4): Mails am oder nach dem Tag, Uhrzeit und Zeitzone
    // ignoriert. Nur das exakte Datumsformat wird angenommen, alles andere ist BAD wie bei einem echten Server.
    const t = /^UID SEARCH SINCE (\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(rest.join(" "));
    const monat = t ? MONATE.indexOf(t[2].toLowerCase()) : -1;
    if (!t || monat === -1) {
      socket.write(`${tag} BAD Datum nicht lesbar\r\n`);
    } else {
      const grenze = Number(t[3]) * 10000 + (monat + 1) * 100 + Number(t[1]);
      const uids = sitzung.mails.filter((m) => dayOf(m) >= grenze).map((m) => String(m.uid));
      socket.write(`* SEARCH${uids.length > 0 ? ` ${uids.join(" ")}` : ""}\r\n${tag} OK done\r\n`);
    }
  } else if (cmd === "UID SEARCH ALL") {
    socket.write(`* SEARCH ${sitzung.mails.map((m) => String(m.uid)).join(" ")}\r\n${tag} OK done\r\n`);
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
    const mitBezug = cmd.includes("IN-REPLY-TO REFERENCES");
    for (const m of sitzung.mails) {
      if (!new RegExp(`\\b${String(m.uid)}\\b`).test(rest.join(" "))) continue;
      if (!peek && sitzung.schreibbar) m.seen = true;
      const kopf = volleHeader ? `${m.raw.split("\r\n\r\n")[0]}\r\n\r\n` : `Message-ID: ${m.id}\r\n\r\n`;
      const payload = wantsBody ? m.raw : kopf;
      const bytes = Buffer.from(payload, "utf8");
      const felder = mitBezug ? "FROM SUBJECT DATE MESSAGE-ID IN-REPLY-TO REFERENCES" : volleHeader ? "FROM SUBJECT DATE MESSAGE-ID" : "MESSAGE-ID";
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
