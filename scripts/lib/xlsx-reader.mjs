/**
 * Minimal .xlsx reader built only on Node built-ins (`node:fs`, `node:zlib`).
 *
 * An .xlsx file is a ZIP archive of XML parts. We only need three of them:
 *   xl/workbook.xml        -> sheet names, in sheet order
 *   xl/sharedStrings.xml   -> the string table cells point at
 *   xl/worksheets/sheetN.xml -> the actual cell values
 *
 * This exists so the catalog seed data can be regenerated with `npm run
 * build:catalog-data` without adding a runtime or build dependency to the
 * project. It is deliberately small: it handles the subset of the format these
 * exports use (shared strings, inline strings, numbers) and nothing more.
 */

import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/**
 * Reads the ZIP central directory and returns every entry as a Buffer.
 * @param {Buffer} buf
 * @returns {Map<string, Buffer>}
 */
function unzip(buf) {
  // The End Of Central Directory record lives in the last 64KB, after a
  // variable-length comment, so scan backwards for its signature.
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 65557; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('Not a ZIP file: end of central directory not found');

  const entryCount = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  const files = new Map();

  for (let n = 0; n < entryCount; n++) {
    if (buf.readUInt32LE(offset) !== SIG_CENTRAL) {
      throw new Error(`Corrupt ZIP: bad central directory header at ${offset}`);
    }
    const method = buf.readUInt16LE(offset + 10);
    const compressedSize = buf.readUInt32LE(offset + 20);
    const nameLength = buf.readUInt16LE(offset + 28);
    const extraLength = buf.readUInt16LE(offset + 30);
    const commentLength = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLength);

    if (buf.readUInt32LE(localOffset) !== SIG_LOCAL) {
      throw new Error(`Corrupt ZIP: bad local header for ${name}`);
    }
    // The local header repeats the name/extra lengths, and they can differ from
    // the central directory's, so re-read them here.
    const localNameLength = buf.readUInt16LE(localOffset + 26);
    const localExtraLength = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);

    if (method === 0) files.set(name, Buffer.from(raw));
    else if (method === 8) files.set(name, inflateRawSync(raw));
    else throw new Error(`Unsupported ZIP compression method ${method} for ${name}`);

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

const XML_ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
};

/** @param {string} s */
function decodeXml(s) {
  return s.replace(/&(?:amp|lt|gt|quot|apos);|&#x?[0-9a-fA-F]+;/g, (m) => {
    if (XML_ENTITIES[m]) return XML_ENTITIES[m];
    const hex = m[2] === 'x' || m[2] === 'X';
    const code = parseInt(m.slice(hex ? 3 : 2, -1), hex ? 16 : 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : m;
  });
}

/**
 * Concatenates every <t> run inside a shared-string / inline-string element.
 * Runs exist because Excel splits a cell whenever formatting changes mid-text.
 * @param {string} xml
 */
function textRuns(xml) {
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g;
  let m;
  while ((m = re.exec(xml)) !== null) out += m[1] === undefined ? '' : decodeXml(m[1]);
  return out;
}

/** @param {Buffer} [part] */
function parseSharedStrings(part) {
  if (!part) return [];
  const xml = part.toString('utf8');
  const strings = [];
  const re = /<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si(?:\s[^>]*)?\/>/g;
  let m;
  while ((m = re.exec(xml)) !== null) strings.push(m[1] === undefined ? '' : textRuns(m[1]));
  return strings;
}

/** Converts a cell reference such as "AN12" into a zero-based column index. */
function columnIndex(ref) {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/**
 * @param {Buffer} part sheet XML
 * @param {string[]} sharedStrings
 * @returns {Array<Array<string|number|null>>} rows of raw cell values
 */
function parseSheet(part, sharedStrings) {
  const xml = part.toString('utf8');
  const rows = [];
  const rowRe = /<row(?:\s[^>]*)?>([\s\S]*?)<\/row>|<row(?:\s[^>]*)?\/>/g;
  const cellRe = /<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;

  let rowMatch;
  while ((rowMatch = rowRe.exec(xml)) !== null) {
    const body = rowMatch[1];
    const row = [];
    if (body) {
      let cellMatch;
      cellRe.lastIndex = 0;
      while ((cellMatch = cellRe.exec(body)) !== null) {
        const attrs = cellMatch[1] || '';
        const inner = cellMatch[2] || '';
        const refMatch = /\br="([A-Z]+)\d+"/.exec(attrs);
        const typeMatch = /\bt="([^"]+)"/.exec(attrs);
        const type = typeMatch ? typeMatch[1] : 'n';

        let value = null;
        if (type === 's') {
          const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner);
          if (v) value = sharedStrings[Number(v[1])] ?? null;
        } else if (type === 'inlineStr') {
          value = textRuns(inner);
        } else if (type === 'str' || type === 'e') {
          const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner);
          value = v ? decodeXml(v[1]) : null;
        } else {
          const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner);
          if (v) {
            const num = Number(v[1]);
            value = Number.isFinite(num) ? num : decodeXml(v[1]);
          }
        }
        if (value === '') value = null;

        const index = refMatch ? columnIndex(refMatch[1]) : row.length;
        while (row.length < index) row.push(null);
        row[index] = value;
      }
    }
    rows.push(row);
  }
  return rows;
}

/**
 * Reads a workbook and returns its sheets as arrays of rows.
 * @param {string} filePath
 * @returns {Array<{ name: string, rows: Array<Array<string|number|null>> }>}
 */
export function readWorkbook(filePath) {
  const files = unzip(readFileSync(filePath));
  const sharedStrings = parseSharedStrings(files.get('xl/sharedStrings.xml'));

  const workbookXml = files.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const names = [...workbookXml.matchAll(/<sheet\s[^>]*name="([^"]*)"/g)].map((m) => decodeXml(m[1]));

  // Sheet parts are numbered in document order; pair them with the names above.
  const sheetParts = [...files.keys()]
    .filter((k) => /^xl\/worksheets\/sheet\d+\.xml$/.test(k))
    .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));

  return sheetParts.map((part, i) => ({
    name: names[i] ?? `Sheet${i + 1}`,
    rows: parseSheet(files.get(part), sharedStrings),
  }));
}

/**
 * Reads the first sheet as objects keyed by its header row.
 * @param {string} filePath
 * @param {string[]} keepColumns only these headers are read; everything else in
 *   the source file is dropped before it can reach the returned objects.
 */
export function readSheetAsObjects(filePath, keepColumns) {
  const [sheet] = readWorkbook(filePath);
  if (!sheet) throw new Error(`No sheets found in ${filePath}`);

  const [header = [], ...body] = sheet.rows;
  const wanted = new Set(keepColumns);
  const columns = new Map();
  header.forEach((name, i) => {
    if (typeof name === 'string' && wanted.has(name)) columns.set(name, i);
  });

  const missing = keepColumns.filter((c) => !columns.has(c));
  if (missing.length) throw new Error(`Missing expected columns in ${filePath}: ${missing.join(', ')}`);

  const records = [];
  for (const row of body) {
    if (!row.some((v) => v !== null && v !== undefined)) continue;
    const record = {};
    for (const [name, i] of columns) record[name] = row[i] ?? null;
    records.push(record);
  }
  return { sheetName: sheet.name, records };
}
