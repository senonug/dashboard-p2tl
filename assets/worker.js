// Web worker: membaca & mengirim file tanpa membuat halaman macet
import { parseFile, applyRecords } from './ingest.js';

let parsed = null;
let ctrl = null;
let lastPost = 0;
const prog = (phase, done, total) => {
  const now = Date.now();
  if (now - lastPost < 120 && done < total) return;
  lastPost = now;
  postMessage({ type: 'progress', phase, done, total });
};

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.cmd === 'parse') {
      const f = m.file;
      parsed = await parseFile({ name: f.name, size: f.size, stream: () => f.stream() }, prog);
      const { ds, stats, periode, header } = parsed;
      postMessage({ type: 'parsed', ds, stats, periode, header, n: parsed.records.length,
        sample: parsed.records.slice(0, 3) });
    } else if (m.cmd === 'apply') {
      ctrl = new AbortController();
      const r = await applyRecords(parsed, m.cfg, prog, ctrl.signal);
      postMessage({ type: 'applied', ...r });
      parsed = null;
    } else if (m.cmd === 'cancel') {
      if (ctrl) ctrl.abort();
    }
  } catch (err) {
    postMessage({ type: 'error', message: err.name === 'AbortError' ? 'Dibatalkan.' : (err.message || String(err)) });
  }
};
