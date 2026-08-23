// SMTP-Dot-Stuffing (RFC 5321 §4.5.2): jede Nachrichtenzeile, die mit "." beginnt, bekommt einen
// zusaetzlichen "." vorangestellt — sonst liest der Server sie als Ende-Marker (eine einzelne Zeile
// mit nur ".") und bricht die DATA-Uebertragung vorzeitig ab. Operiert auf Bytes statt auf Text: die
// hier durchlaufenden Nachrichten sind bereits MIME-kodiert (Header + QP/Base64-Body), also reines
// ASCII — ein Byte-Scan nach 0x0A/0x2E ist deshalb korrekt und vermeidet eine unnoetige Text-Rundreise.
const LF = 0x0a;
const DOT = 0x2e;
const CR = 0x0d;

export function dotStuff(message: Uint8Array): Uint8Array {
  const out: number[] = [];
  let atLineStart = true;
  for (let i = 0; i < message.length; i++) {
    const byte = message[i] as number;
    if (atLineStart && byte === DOT) out.push(DOT);
    out.push(byte);
    atLineStart = byte === LF;
  }
  // Nachricht muss mit CRLF enden, sonst haengt der abschliessende "."-Marker an derselben Zeile.
  const endsWithCrlf = out.length >= 2 && out[out.length - 2] === CR && out[out.length - 1] === LF;
  if (!endsWithCrlf) {
    out.push(CR, LF);
  }
  return new Uint8Array(out);
}
