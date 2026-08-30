#!/usr/bin/env node
// Fake-IMAP-Server fuer tests/integration — spricht nur das Subset, das core/imap/client.ts
// benutzt: CAPABILITY, AUTHENTICATE PLAIN, EXAMINE, UID SEARCH ALL, UID FETCH (Header/Body),
// LOGOUT. Kein TLS, bindet ausschliesslich an 127.0.0.1. Nie fuer echte Postfaecher gedacht.
//
// Start: `node scripts/fake-imap.mjs` (Port 11143, override per PORT env fuer parallele Laeufe
// im Integrationstest). Liefert einen festen Ordner mit zwei Mails, unabhaengig vom
// EXAMINE-Ordnernamen — der Test prueft nur den Dialog gegen den echten Socket, nicht Multi-
// Ordner-Logik.
import net from "node:net";

const PORT = Number(process.env.PORT ?? 11143);
const HOST = "127.0.0.1";

const MAILS = [
  {
    uid: 7,
    id: "<eins@example.net>",
    raw: "From: a@example.net\r\nTo: b@example.net\r\nSubject: Erste Testmail\r\nMessage-ID: <eins@example.net>\r\nDate: Sat, 29 Aug 2026 08:00:00 +0000\r\n\r\nHallo eins\r\n",
  },
  {
    uid: 9,
    id: "<zwei@example.net>",
    raw: "From: a@example.net\r\nTo: b@example.net\r\nSubject: Zweite Testmail\r\nMessage-ID: <zwei@example.net>\r\nDate: Sat, 29 Aug 2026 09:00:00 +0000\r\n\r\nHallo zwei\r\n",
  },
  // Dritte Mail bewusst mit Nicht-ASCII: IMAP-Literale zaehlen BYTES, nicht Zeichen. Hier fallen
  // beide Laengen weit auseinander (Umlaute 2 Bytes, das Emoji 4) — liest der Client Zeichen
  // statt Bytes, bleibt der Rest des Literals im Strom stehen, die Antwort desynchronisiert und
  // die folgenden Mails gehen verloren. Bis 2026-08-30 war das nur per Codelektuere belegt.
  {
    uid: 11,
    id: "<drei@example.net>",
    raw: "From: a@example.net\r\nTo: b@example.net\r\nSubject: Dritte Testmail mit Umlauten\r\nMessage-ID: <drei@example.net>\r\nDate: Sat, 29 Aug 2026 10:00:00 +0000\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nGrüße aus München: Äpfel, Öl, Füße – und ein Gruß 🚀\r\n",
  },
];

function handleConnection(socket) {
  socket.write("* OK fake-imap ready\r\n");
  let buf = "";

  socket.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    for (let nl = buf.indexOf("\r\n"); nl !== -1; nl = buf.indexOf("\r\n")) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 2);
      handleLine(socket, line);
    }
  });
}

function handleLine(socket, line) {
  const [tag, ...rest] = line.split(" ");
  const cmd = rest.join(" ").toUpperCase();

  if (cmd === "CAPABILITY") {
    // SASL-IR gehoert dazu, weil dieser Fake genau die Initial-Response-Form von AUTHENTICATE
    // PLAIN annimmt (RFC 4959) — ohne die Capability nutzt der Client korrekterweise LOGIN.
    socket.write("* CAPABILITY IMAP4rev1 AUTH=PLAIN SASL-IR UIDPLUS\r\n");
    socket.write(`${tag} OK done\r\n`);
  } else if (cmd.startsWith("AUTHENTICATE PLAIN")) {
    socket.write(`${tag} OK authenticated\r\n`);
  } else if (cmd.startsWith("EXAMINE")) {
    socket.write(`* ${String(MAILS.length)} EXISTS\r\n* OK [UIDVALIDITY 4242] UIDs valid\r\n${tag} OK [READ-ONLY] done\r\n`);
  } else if (cmd === "UID SEARCH ALL") {
    socket.write(`* SEARCH ${MAILS.map((m) => String(m.uid)).join(" ")}\r\n${tag} OK done\r\n`);
  } else if (cmd.startsWith("UID FETCH")) {
    const wantsBody = cmd.includes("BODY.PEEK[]");
    for (const m of MAILS) {
      if (!new RegExp(`\\b${String(m.uid)}\\b`).test(rest.join(" "))) continue;
      const payload = wantsBody ? m.raw : `Message-ID: ${m.id}\r\n\r\n`;
      const bytes = Buffer.from(payload, "utf8");
      const label = wantsBody ? "BODY[]" : "BODY[HEADER.FIELDS (MESSAGE-ID)]";
      socket.write(`* ${String(m.uid)} FETCH (UID ${String(m.uid)} ${label} {${String(bytes.length)}}\r\n`);
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
