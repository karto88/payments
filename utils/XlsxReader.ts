import { inflateRawSync } from 'zlib';

/**
 * xlsx-ის მარტივი წამკითხველი (ბიბლიოთეკის გარეშე) — xlsx = zip, შიგნით XML.
 * zip-ს ვშლით Node-ის zlib-ით, ვკითხულობთ sharedStrings.xml + sheet1.xml და ვაბრუნებთ სტრიქონებს:
 *   rows[rowIndex][colIndex] = უჯრის მნიშვნელობა (string), ცარიელი უჯრა → ''.
 */
export function readXlsxRows(xlsx: Buffer): string[][] {
  const files = unzip(xlsx);
  const sharedStrings = parseSharedStrings(files['xl/sharedStrings.xml'] ?? '');
  const sheet = files['xl/worksheets/sheet1.xml'];
  if (!sheet) throw new Error('xlsx: xl/worksheets/sheet1.xml ვერ მოიძებნა');

  const rows: string[][] = [];
  for (const rowMatch of sheet.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowIndex = Number(rowMatch[1]) - 1;
    const row: string[] = [];
    for (const cell of rowMatch[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cell[1];
      const inner = cell[2] ?? '';
      const ref = /\br="([A-Z]+)\d+"/.exec(attrs)?.[1];
      if (!ref) continue;
      const type = /\bt="(\w+)"/.exec(attrs)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
      const inline = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1];
      let value = '';
      if (type === 's' && v !== undefined) value = sharedStrings[Number(v)] ?? '';
      else if (type === 'inlineStr' && inline !== undefined) value = decodeXml(inline);
      else if (v !== undefined) value = decodeXml(v);
      row[columnIndex(ref)] = value;
    }
    rows[rowIndex] = Array.from(row, (c) => c ?? '');
  }
  return Array.from(rows, (r) => r ?? []);
}

/** zip → { 'path/in/zip': utf8 content } (central directory-ით; deflate ან stored) */
function unzip(zip: Buffer): Record<string, string> {
  // End of Central Directory — ფაილის ბოლოდან ვეძებთ ხელმოწერას 0x06054b50
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('xlsx: zip-ის End of Central Directory ვერ მოიძებნა');

  const entries = zip.readUInt16LE(eocd + 10);
  let offset = zip.readUInt32LE(eocd + 16);
  const files: Record<string, string> = {};

  for (let n = 0; n < entries; n++) {
    if (zip.readUInt32LE(offset) !== 0x02014b50) throw new Error('xlsx: central directory დაზიანებულია');
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localHeader = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);

    const dataStart = localHeader + 30 + zip.readUInt16LE(localHeader + 26) + zip.readUInt16LE(localHeader + 28);
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    if (method === 8) files[name] = inflateRawSync(data).toString('utf8');
    else if (method === 0) files[name] = data.toString('utf8');

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

function parseSharedStrings(xml: string): string[] {
  return Array.from(xml.matchAll(/<si>([\s\S]*?)<\/si>/g), (si) =>
    decodeXml(Array.from(si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g), (t) => t[1]).join('')));
}

function columnIndex(letters: string): number {
  return letters.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
}

function decodeXml(s: string): string {
  return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}
