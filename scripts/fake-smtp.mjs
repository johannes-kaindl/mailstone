#!/usr/bin/env node
// Fake-SMTP-Server fuer den lokalen Versand-Test (M2 Task 7): kein TLS, akzeptiert AUTH PLAIN
// mit beliebigem Inhalt, spricht nur so viel RFC 5321, wie smtpSend/smtpProbe fuer den
// Happy-Path brauchen. NUR fuer 127.0.0.1 gedacht — SmtpSendOptions.allowInsecureAuth wird
// vom SendService ausschliesslich fuer Loopback + smtp.tls==="none" gesetzt (s.
// src/core/smtp/client.ts, src/core/send/service.ts isLoopback).
//
// Start: `node scripts/fake-smtp.mjs` (Port 2525, override per PORT env fuer parallele Laeufe
// im Integrationstest). Jede empfangene Nachricht landet als `.fake-smtp/<n>.eml` im CWD und
// wird mit einer Protokollzeile auf stdout quittiert.
import net from "node:net";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const PORT = Number(process.env.PORT ?? 2525);
const HOST = process.env.HOST ?? "127.0.0.1";
const OUT_DIR = process.env.FAKE_SMTP_DIR ?? ".fake-smtp";

mkdirSync(OUT_DIR, { recursive: true });
let counter = 0;

function handleConnection(socket) {
  let buf = "";
  let state = "greeting";
  let dataLines = [];

  const send = (line) => socket.write(`${line}\r\n`);

  send("220 mailstone-fake ESMTP");

  socket.on("data", (chunk) => {
    buf += chunk.toString("utf8");
    let idx = buf.indexOf("\r\n");
    while (idx !== -1) {
      const line = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      handleLine(line);
      idx = buf.indexOf("\r\n");
    }
  });

  function handleLine(line) {
    if (state === "data") {
      if (line === ".") {
        counter += 1;
        const path = join(OUT_DIR, `${counter}.eml`);
        writeFileSync(path, dataLines.join("\r\n"));
        console.log(`[fake-smtp] message ${counter} -> ${path} (${dataLines.length} lines)`);
        dataLines = [];
        state = "command";
        send("250 2.0.0 queued");
      } else {
        // Dot-Stuffing rueckgaengig machen (RFC 5321 4.5.2): eine fuehrende ".." wird zu ".".
        dataLines.push(line.startsWith("..") ? line.slice(1) : line);
      }
      return;
    }

    if (/^EHLO/i.test(line)) {
      send("250-fake");
      send("250 AUTH PLAIN");
    } else if (/^AUTH PLAIN/i.test(line)) {
      send("235 2.7.0 authenticated");
    } else if (/^MAIL FROM:/i.test(line)) {
      send("250 2.1.0 ok");
    } else if (/^RCPT TO:/i.test(line)) {
      send("250 2.1.5 ok");
    } else if (/^DATA/i.test(line)) {
      state = "data";
      send("354 go ahead");
    } else if (/^QUIT/i.test(line)) {
      send("221 2.0.0 bye");
      socket.end();
    } else {
      send("500 5.5.1 command not recognized");
    }
  }
}

const server = net.createServer(handleConnection);
server.listen(PORT, HOST, () => {
  console.log(`[fake-smtp] listening on ${HOST}:${PORT}, writing to ${OUT_DIR}/`);
});
