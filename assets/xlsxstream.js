// Pembaca .xlsx streaming (hemat memori) untuk file besar seperti DIL & OLAP prabayar.
// Pass 1: workbook, relasi, sharedStrings, dan baris judul tiap sheet.
// Pass 2: alirkan sheet yang dipilih baris per baris.
import { Unzip, UnzipInflate } from './vendor/fflate.mjs';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function xmlDecode(s) {
  if (s.indexOf('&') < 0 && s.indexOf('_x') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e])
    .replace(/_x000[dDaA]_/g, '');
}

function colIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

function parseSST(xml) {
  const out = [];
  const reSi = /<si>([\s\S]*?)<\/si>|<si\/>/g;
  const reT = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = reSi.exec(xml))) {
    if (m[1] === undefined) { out.push(''); continue; }
    const inner = m[1];
    // abaikan teks fonetik <rPh>
    const clean = inner.indexOf('<rPh') >= 0 ? inner.replace(/<rPh[\s\S]*?<\/rPh>/g, '') : inner;
    let s = '', t;
    reT.lastIndex = 0;
    while ((t = reT.exec(clean))) s += t[1];
    out.push(xmlDecode(s));
  }
  return out;
}

// Parser baris dari potongan XML sheet
function makeRowParser(sst, onRow) {
  let buf = '';
  let rowNo = 0;
  const reRow = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
  const reC = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  const reR = /\br="([A-Z]+)\d*"/;
  const reTy = /\bt="(\w+)"/;
  const reV = /<v>([\s\S]*?)<\/v>/;
  const reIs = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  function parseRow(inner) {
    const row = [];
    if (!inner) return row;
    let m, seq = 0;
    reC.lastIndex = 0;
    while ((m = reC.exec(inner))) {
      const attrs = m[1], body = m[2];
      const rm = reR.exec(attrs);
      const ci = rm ? colIndex(rm[1]) : seq;
      seq = ci + 1;
      if (!body) continue;
      const tm = reTy.exec(attrs);
      const ty = tm ? tm[1] : 'n';
      let val;
      if (ty === 'inlineStr') {
        let s = '', t; reIs.lastIndex = 0;
        while ((t = reIs.exec(body))) s += t[1];
        val = xmlDecode(s);
      } else {
        const vm = reV.exec(body);
        if (!vm) continue;
        const v = vm[1];
        if (ty === 's') val = sst[+v];
        else if (ty === 'str' || ty === 'e') val = xmlDecode(v);
        else if (ty === 'b') val = v === '1';
        else { const n = Number(v); val = Number.isNaN(n) ? v : n; }
      }
      row[ci] = val;
    }
    return row;
  }
  return {
    push(text, final) {
      buf += text;
      const end = buf.lastIndexOf('</row>');
      let chunk;
      if (final) { chunk = buf; buf = ''; }
      else if (end < 0) {
        // baris kosong bentuk <row .../> tanpa penutup juga mungkin
        return;
      } else { chunk = buf.slice(0, end + 6); buf = buf.slice(end + 6); }
      let m; reRow.lastIndex = 0;
      while ((m = reRow.exec(chunk))) {
        const stop = onRow(parseRow(m[1]), rowNo++);
        if (stop === false) return false;
      }
    }
  };
}

async function pump(stream, onChunk, onProgress, total) {
  const reader = stream.getReader();
  let done = 0;
  for (;;) {
    const { value, done: d } = await reader.read();
    if (d) break;
    done += value.length;
    const r = onChunk(value);
    if (onProgress) onProgress(done, total);
    if (r === false) { try { await reader.cancel(); } catch (e) { /* abaikan */ } break; }
  }
  onChunk(null);
}

// getStream: () => ReadableStream<Uint8Array> ; size: total bytes (untuk progres)
export async function inspectXlsx(getStream, size, onProgress) {
  const want = {};
  const peeks = {};
  const texts = {};
  const uz = new Unzip();
  uz.register(UnzipInflate);
  uz.onfile = (f) => {
    const n = f.name;
    const full = n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || /^xl\/sharedStrings\.xml$/i.test(n);
    const isSheet = /^xl\/worksheets\/[^/]+\.xml$/.test(n);
    if (!full && !isSheet) return;
    const dec = new TextDecoder();
    if (full) {
      const parts = [];
      f.ondata = (err, chunk, final) => {
        if (err) throw err;
        parts.push(dec.decode(chunk, { stream: !final }));
        if (final) texts[n] = parts.join('');
      };
      f.start();
    } else {
      let s = '';
      f.ondata = (err, chunk, final) => {
        if (err) throw err;
        if (peeks[n] !== undefined) return;
        s += dec.decode(chunk, { stream: !final });
        const e = s.indexOf('</row>');
        if (e >= 0 || final || s.length > 2e6) {
          peeks[n] = s;
          try { f.terminate(); } catch (x) { /* abaikan */ }
        }
      };
      f.start();
    }
    want[n] = true;
  };
  await pump(getStream(), (c) => { if (c) uz.push(c); else uz.push(new Uint8Array(0), true); }, onProgress, size);
  const sst = texts['xl/sharedStrings.xml'] ? parseSST(texts['xl/sharedStrings.xml']) : [];
  const rels = {};
  for (const m of (texts['xl/_rels/workbook.xml.rels'] || '').matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /\bId="([^"]+)"/.exec(m[0]), tg = /\bTarget="([^"]+)"/.exec(m[0]);
    if (id && tg) rels[id[1]] = tg[1].replace(/^\/?xl\//, '').replace(/^\//, '');
  }
  const sheets = [];
  for (const m of (texts['xl/workbook.xml'] || '').matchAll(/<sheet\b[^>]*>/g)) {
    const nm = /\bname="([^"]+)"/.exec(m[0]), rid = /\br:id="([^"]+)"/.exec(m[0]);
    if (!nm || !rid || !rels[rid[1]]) continue;
    const path = 'xl/' + rels[rid[1]];
    const peek = peeks[path] || '';
    const dim = /<dimension ref="[A-Z]+\d+:[A-Z]+(\d+)"/.exec(peek);
    const rows = [];
    const p = makeRowParser(sst, (r) => { rows.push(r); return rows.length < 3; });
    p.push(peek, true);
    sheets.push({ name: xmlDecode(nm[1]), path, approxRows: dim ? +dim[1] - 1 : null, firstRows: rows });
  }
  return { sst, sheets };
}

export async function streamSheet(getStream, size, info, sheetPath, onRow, onProgress) {
  const uz = new Unzip();
  uz.register(UnzipInflate);
  let stopped = false;
  const parser = makeRowParser(info.sst, (r, i) => {
    const res = onRow(r, i);
    if (res === false) stopped = true;
    return res;
  });
  uz.onfile = (f) => {
    if (f.name !== sheetPath) return;
    const dec = new TextDecoder();
    f.ondata = (err, chunk, final) => {
      if (err) throw err;
      if (stopped) return;
      parser.push(dec.decode(chunk, { stream: !final }), final);
    };
    f.start();
  };
  await pump(getStream(), (c) => {
    if (stopped) return false;
    if (c) uz.push(c); else uz.push(new Uint8Array(0), true);
  }, onProgress, size);
}

// CSV streaming (pemisah , atau ; terdeteksi otomatis)
export async function streamCsv(getStream, size, onRow, onProgress) {
  const dec = new TextDecoder();
  let buf = '', delim = null, row = [], field = '', inQ = false, rowNo = 0, stop = false;
  function feed(text, final) {
    buf += text;
    if (delim === null) {
      const nl = buf.indexOf('\n');
      if (nl < 0 && !final) return;
      const head = buf.slice(0, nl < 0 ? buf.length : nl);
      delim = (head.split(';').length > head.split(',').length) ? ';' : (head.split('\t').length > head.split(',').length ? '\t' : ',');
    }
    let i = 0;
    const L = buf.length;
    const limit = final ? L : L - 1;
    for (; i < limit; i++) {
      const ch = buf[i];
      if (inQ) {
        if (ch === '"') { if (buf[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
        else field += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === delim) { row.push(field); field = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && buf[i + 1] === '\n') i++;
        row.push(field); field = '';
        if (onRow(row.map((v) => { const t = v.trim(); if (t !== '' && /^-?\d+(\.\d+)?$/.test(t) && t.length < 16) return Number(t); return t === '' ? undefined : t; }), rowNo++) === false) { stop = true; return; }
        row = [];
      } else field += ch;
    }
    buf = buf.slice(i);
    if (final && (field !== '' || row.length)) { row.push(field); onRow(row, rowNo++); }
  }
  await pump(getStream(), (c) => {
    if (stop) return false;
    if (c) feed(dec.decode(c, { stream: true }), false); else feed(dec.decode(), true);
  }, onProgress, size);
}
