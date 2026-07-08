// Espia — servidor da Fase 1 (Caminho A).
// API lazy por diretório + render MD server-side + mídia com Range (via res.sendFile).
// Regras herdadas do estudo de arquitetura (§15/§16 do plano):
//   - listagem só toca metadado (readdir+stat); nunca abre arquivo (§15.1)
//   - path traversal morre com path.relative + realpath, não prefixo de string (§15.7)
//   - mídia servida por res.sendFile → Range/ETag de graça (§15.3)
//   - limite de tamanho em todo preview de texto (§15.9)

import express from 'express';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import MarkdownIt from 'markdown-it';
import sanitizeHtml from 'sanitize-html';
import hljs from 'highlight.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'espia.config.json'), 'utf8'));

const ROOT = fs.realpathSync(path.resolve(cfg.root));      // resolve symlinks do próprio root uma vez
const IGNORE = new Set(cfg.ignore || []);
const PORT = cfg.port || 4600;
const MAX_TEXT = cfg.maxTextBytes || 10 * 1024 * 1024;
const MAX_RENDER = cfg.maxRenderBytes || 2 * 1024 * 1024;

const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico']);
const VID_EXT = new Set(['mp4', 'webm', 'mov', 'mkv', 'm4v']);
const galleryKind = (ext) => IMG_EXT.has(ext) ? 'image' : VID_EXT.has(ext) ? 'video' : null;

const md = new MarkdownIt({
  html: true, linkify: true, breaks: false,
  highlight: (str, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      try { return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`; } catch {}
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  },
});

// imagens relativas do MD → reescreve src para a rota /api/file do diretório do arquivo
const defaultImage = md.renderer.rules.image;
md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const i = token.attrIndex('src');
  if (i >= 0) {
    const src = token.attrs[i][1];
    if (!/^(https?:|data:|\/)/i.test(src)) {
      const abs = path.posix.join(env.dir || '', src);
      token.attrs[i][1] = '/api/file?path=' + encodeURIComponent(abs);
    }
  }
  return defaultImage(tokens, idx, options, env, self);
};

const SANITIZE = {
  allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img', 'h1', 'h2', 'del', 'ins', 'details', 'summary']),
  allowedAttributes: {
    ...sanitizeHtml.defaults.allowedAttributes,
    img: ['src', 'alt', 'title', 'width', 'height'],
    span: ['class'], code: ['class'], pre: ['class'], // classes hljs-* do highlight de código
    '*': ['align'],
  },
  // sem 'script'/'iframe'/'style' — não estão nos defaults, então já ficam de fora
};

function renderMd(text, dir) {
  return sanitizeHtml(md.render(text, { dir: dir === '.' || !dir ? '' : dir }), SANITIZE);
}

// Resolve um path relativo com segurança. Lança {status} em violação.
// Para paths que existem, valida também o realpath (anti symlink-escape, CVE-2026-54094).
async function resolveSafe(rel, { mustExist = true } = {}) {
  const resolved = path.resolve(ROOT, rel || '.');
  const relCheck = path.relative(ROOT, resolved);
  if (relCheck !== '' && (relCheck.startsWith('..') || path.isAbsolute(relCheck))) {
    throw { status: 403, msg: 'Fora da raiz' };
  }
  if (mustExist) {
    let real;
    try { real = await fsp.realpath(resolved); }
    catch { throw { status: 404, msg: 'Não encontrado' }; }
    const realCheck = path.relative(ROOT, real);
    if (realCheck !== '' && (realCheck.startsWith('..') || path.isAbsolute(realCheck))) {
      throw { status: 403, msg: 'Symlink fora da raiz' };
    }
    return real;
  }
  return resolved;
}

const app = express();
app.disable('x-powered-by');

// GET /api/tree?path=<rel> → UM nível do diretório (lazy). Só metadado, nunca abre arquivo.
app.get('/api/tree', async (req, res) => {
  try {
    const abs = await resolveSafe(req.query.path || '');
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    const entries = await fsp.readdir(abs, { withFileTypes: true });
    const out = [];
    for (const e of entries) {
      if (IGNORE.has(e.name)) continue;
      const isDir = e.isDirectory();
      let size = 0, mtime = 0;
      try { const st = await fsp.stat(path.join(abs, e.name)); size = st.size; mtime = st.mtimeMs; }
      catch { continue; } // arquivo sumiu entre readdir e stat → pula
      out.push({
        name: e.name,
        path: rel ? `${rel}/${e.name}` : e.name,
        type: isDir ? 'dir' : 'file',
        ext: isDir ? '' : path.extname(e.name).slice(1).toLowerCase(),
        size, mtime,
      });
    }
    // pastas primeiro, depois alfabético (case-insensitive)
    out.sort((a, b) =>
      (a.type === b.type ? 0 : a.type === 'dir' ? -1 : 1) ||
      a.name.toLowerCase().localeCompare(b.name.toLowerCase(), 'pt-BR'));
    res.json({ path: rel, entries: out });
  } catch (err) { sendErr(res, err); }
});

// GET /api/file?path=<rel> → serve o arquivo cru. Range/ETag/304 nativos do Express.
app.get('/api/file', async (req, res) => {
  try {
    const abs = await resolveSafe(req.query.path || '');
    const st = await fsp.stat(abs);
    if (st.isDirectory()) throw { status: 400, msg: 'É um diretório' };
    res.sendFile(abs, { headers: { 'X-Content-Type-Options': 'nosniff' } });
  } catch (err) { sendErr(res, err); }
});

// GET /api/raw?path=<rel> → conteúdo de texto cru (para o modo Código). Com limite de tamanho.
// Retorna o mtime no header X-Mtime — o client guarda como baseMtime para o save seguro.
app.get('/api/raw', async (req, res) => {
  try {
    const abs = await resolveSafe(req.query.path || '');
    const st = await fsp.stat(abs);
    if (st.isDirectory()) throw { status: 400, msg: 'É um diretório' };
    if (st.size > MAX_TEXT) throw { status: 413, msg: `Grande demais (${fmtBytes(st.size)}) para leitura de texto` };
    const text = await fsp.readFile(abs, 'utf8');
    res.set('X-Mtime', String(st.mtimeMs));
    res.type('text/plain; charset=utf-8').send(text);
  } catch (err) { sendErr(res, err); }
});

// POST /api/save {path, content, baseMtime} → grava UTF-8, atômico, com compare-and-swap (§16).
// baseMtime diferente do mtime atual = alguém escreveu no meio → 409 (o client decide).
app.post('/api/save', express.json({ limit: '16mb' }), async (req, res) => {
  try {
    const { path: rel, content, baseMtime } = req.body || {};
    if (typeof content !== 'string') throw { status: 400, msg: 'content ausente' };
    const abs = await resolveSafe(rel);
    const st = await fsp.stat(abs);
    if (st.isDirectory()) throw { status: 400, msg: 'É um diretório' };
    if (baseMtime != null && Math.abs(st.mtimeMs - Number(baseMtime)) > 1) {
      return res.status(409).json({ error: 'O arquivo mudou no disco desde que você abriu', diskMtime: st.mtimeMs });
    }
    // escrita atômica: grava no tmp do mesmo diretório e renomeia por cima (§16)
    const tmp = path.join(path.dirname(abs), `.espia-tmp-${process.pid}-${path.basename(abs)}`);
    await fsp.writeFile(tmp, content, 'utf8');
    try {
      await renameWithRetry(tmp, abs); // Windows: rename dá EPERM transiente (Defender/indexador) → retry
    } catch (e) {
      await fsp.rm(tmp, { force: true }).catch(() => {}); // não deixa tmp órfão
      throw e;
    }
    const nst = await fsp.stat(abs);
    lastSave = { path: rel, at: Date.now() }; // marca para o echo-suppression do watch
    res.json({ ok: true, mtime: nst.mtimeMs });
  } catch (err) { sendErr(res, err); }
});

// GET /api/render?path=<rel> → HTML sanitizado do Markdown (modo Olho). Limite menor.
app.get('/api/render', async (req, res) => {
  try {
    const abs = await resolveSafe(req.query.path || '');
    const st = await fsp.stat(abs);
    if (st.size > MAX_RENDER) throw { status: 413, msg: 'MD grande demais para render; use o modo Código' };
    const text = await fsp.readFile(abs, 'utf8');
    const rel = path.relative(ROOT, abs).split(path.sep).join('/');
    res.json({ html: renderMd(text, path.posix.dirname(rel)) });
  } catch (err) { sendErr(res, err); }
});

// POST /api/render-md {text, dir} → renderiza texto arbitrário (rascunho não salvo → live-preview no Olho).
app.post('/api/render-md', express.json({ limit: '16mb' }), async (req, res) => {
  try {
    const { text, dir } = req.body || {};
    if (typeof text !== 'string') throw { status: 400, msg: 'text ausente' };
    if (dir) await resolveSafe(dir); // valida o dir (para resolver imagens relativas com segurança)
    res.json({ html: renderMd(text, dir || '') });
  } catch (err) { sendErr(res, err); }
});

// --- auto-reload (§16 linha 1): watch pontual do arquivo aberto + SSE ---
// Um único watcher, trocado a cada arquivo aberto. Sem watcher global (§15.5).
let sseClients = [];
let watcher = null, debounceTimer = null;
let lastSave = { path: null, at: 0 }; // echo-suppression: ignora o evento do próprio save

app.get('/api/ping', (req, res) => res.json({ ok: true }));

// POST /api/open {path} → empurra o arquivo para a janela aberta navegar até ele (gesto de entrega, §2.5).
app.post('/api/open', express.json(), async (req, res) => {
  try {
    const rel = req.body?.path || '';
    await resolveSafe(rel); // valida antes de mandar o front abrir
    broadcast({ event: 'open', path: rel });
    res.json({ ok: true });
  } catch (err) { sendErr(res, err); }
});

app.get('/api/events', (req, res) => {
  res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.flushHeaders?.();
  res.write(': conectado\n\n');
  sseClients.push(res);
  req.on('close', () => { sseClients = sseClients.filter(c => c !== res); });
});

function broadcast(obj) {
  const line = `data: ${JSON.stringify(obj)}\n\n`;
  for (const c of sseClients) c.write(line);
}

app.post('/api/watch', express.json(), async (req, res) => {
  try {
    if (watcher) { watcher.close(); watcher = null; }
    clearTimeout(debounceTimer);
    const rel = req.body?.path || '';
    if (rel) {
      const abs = await resolveSafe(rel);
      watcher = fs.watch(abs, () => {
        // debounce: espera a escrita externa estabilizar antes de avisar (§16)
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          // echo-suppression: se o Espia acabou de salvar este path, o evento é eco do próprio save
          if (rel === lastSave.path && Date.now() - lastSave.at < 1500) return;
          broadcast({ event: 'changed', path: rel });
        }, 300);
      });
      watcher.on('error', (e) => console.error('watch', e.message)); // degrada, não derruba
    }
    res.json({ ok: true });
  } catch (err) { sendErr(res, err); }
});

// GET /api/gallery?path=<dir> → mídia (imagem/vídeo) da pasta + subpastas (2 níveis), para a Mesa de Revisão.
// Cap de 300 itens; loga se truncar (§15 — sem cap silencioso). Não abre arquivo, só stat.
app.get('/api/gallery', async (req, res) => {
  try {
    const abs = await resolveSafe(req.query.path || '');
    const st = await fsp.stat(abs);
    if (!st.isDirectory()) throw { status: 400, msg: 'Não é um diretório' };
    const baseRel = path.relative(ROOT, abs).split(path.sep).join('/');
    const items = [];
    const CAP = 300;
    let truncated = false;

    async function walk(dir, rel, depth) {
      if (items.length >= CAP) { truncated = true; return; }
      let entries;
      try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (IGNORE.has(e.name)) continue;
        const childRel = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) {
          if (depth > 0) await walk(path.join(dir, e.name), childRel, depth - 1);
        } else {
          const ext = path.extname(e.name).slice(1).toLowerCase();
          const kind = galleryKind(ext);
          if (!kind) continue;
          if (items.length >= CAP) { truncated = true; return; }
          let size = 0, mtime = 0;
          try { const s = await fsp.stat(path.join(dir, e.name)); size = s.size; mtime = s.mtimeMs; } catch { continue; }
          items.push({ name: e.name, path: childRel, ext, kind, size, mtime });
        }
      }
    }
    await walk(abs, baseRel, 2);
    if (truncated) console.log(`gallery: ${baseRel} truncada em ${CAP} itens`);
    items.sort((a, b) => b.mtime - a.mtime); // mais recentes primeiro
    res.json({ path: baseRel, count: items.length, truncated, items });
  } catch (err) { sendErr(res, err); }
});

// rename com retry — no Windows o rename dá EPERM/EACCES/EBUSY transiente quando outro
// processo (Defender, indexador, watcher) segura o handle por um instante. Padrão graceful-fs.
async function renameWithRetry(from, to, tries = 6) {
  for (let i = 0; i < tries; i++) {
    try { await fsp.rename(from, to); return; }
    catch (e) {
      const transient = e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'EBUSY';
      if (!transient || i === tries - 1) throw e;
      await new Promise(r => setTimeout(r, 15 * (i + 1)));
    }
  }
}

// Mesa de aprovação (Fase 5): status leve por criativo, guardado em .espia.json na pasta.
// Não move nem renomeia arquivos — só um mapa { "<path-rel-ao-root>": "aprovado" }.
const VALID_STATUS = new Set(['revisar', 'aprovado', 'reprovado', 'publicado']);

// GET /api/status?path=<dir> → { statuses: {...} } (vazio se o .espia.json não existe)
app.get('/api/status', async (req, res) => {
  try {
    const abs = await resolveSafe(req.query.path || '');
    try {
      const j = JSON.parse(await fsp.readFile(path.join(abs, '.espia.json'), 'utf8'));
      res.json({ statuses: j.status || {} });
    } catch { res.json({ statuses: {} }); }
  } catch (err) { sendErr(res, err); }
});

// Serializa as escritas de status: read-modify-write do .espia.json não pode correr em paralelo
// (marcar 2 cards rápido corromperia o arquivo). Lock global — single-user local. ponytail: por-arquivo se um dia escalar.
let statusChain = Promise.resolve();

// POST /api/status {dir, file, status} → grava no .espia.json (atômico). status vazio/revisar = remove (volta ao default).
app.post('/api/status', express.json(), async (req, res) => {
  try {
    const { dir, file, status } = req.body || {};
    const absDir = await resolveSafe(dir || '');
    await resolveSafe(file); // valida que o arquivo existe e está sob a raiz
    if (status && !VALID_STATUS.has(status)) throw { status: 400, msg: 'status inválido' };
    const f = path.join(absDir, '.espia.json');
    const run = statusChain.then(async () => {
      let data = { status: {} };
      try { const j = JSON.parse(await fsp.readFile(f, 'utf8')); if (j && j.status) data = j; } catch {}
      if (!status || status === 'revisar') delete data.status[file]; // default não ocupa espaço
      else data.status[file] = status;
      const tmp = path.join(absDir, `.espia-tmp-status-${process.pid}`);
      await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
      try { await renameWithRetry(tmp, f); } catch (e) { await fsp.rm(tmp, { force: true }).catch(() => {}); throw e; }
    });
    statusChain = run.catch(() => {}); // um erro num elo não trava a fila dos próximos
    await run;
    res.json({ ok: true });
  } catch (err) { sendErr(res, err); }
});

function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}
function sendErr(res, err) {
  const status = err?.status || 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: err?.msg || 'Erro interno' });
}

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, '127.0.0.1', () => {
  console.log(`Espia no ar — http://127.0.0.1:${PORT}  (raiz: ${ROOT})`);
});
