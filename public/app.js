// Espia — client (vanilla). Consome a API do server.js.
// Árvore lazy · abas de arquivos (cada uma com modo e rascunho próprios) · toggle olho↔código · galeria.

const SVG_CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none"><path d="M9 5l7 7-7 7" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_FOLDER = '<svg class="folder-ico" viewBox="0 0 24 24" fill="currentColor"><path d="M3 6a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V6z"/></svg>';

const IMG = new Set(['png','jpg','jpeg','gif','webp','svg','avif','bmp','ico']);
const VID = new Set(['mp4','webm','mov','mkv','m4v']);
const AUD = new Set(['wav','mp3','ogg','m4a','flac','aac']);
const MD  = new Set(['md','markdown']);
const HTM = new Set(['html','htm']);
const FICO_LETTER = {md:'M',markdown:'M',html:'H',htm:'H',png:'P',jpg:'P',jpeg:'P',gif:'P',webp:'P',svg:'P',avif:'P',bmp:'P',ico:'P',
  mp4:'V',webm:'V',mov:'V',mkv:'V',m4v:'V',wav:'A',mp3:'A',ogg:'A',m4a:'A',flac:'A',aac:'A',py:'Py',js:'J',mjs:'J',ts:'T',json:'{}'};

const $ = (id) => document.getElementById(id);
const api = (route, p) => fetch(`/api/${route}?path=${encodeURIComponent(p)}`);
const fmtBytes = (n) => n == null ? '' : n < 1024 ? n + ' B' : n < 1048576 ? (n/1024).toFixed(1) + ' KB' : (n/1048576).toFixed(1) + ' MB';
const cssEsc = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/["\\]/g, '\\$&');

// abas: cada uma = { id, path, name, ext, kind, size, mode:'eye'|'code', ed }
//   ed = null (não editável ou ainda não carregado) | { draft, baseContent, baseMtime, eol }
let tabs = [];
let activeId = null;
let tabSeq = 0;
let currentDir = '';   // pasta em foco para a Mesa de Revisão
const PLACEHOLDER_HTML = $('content').innerHTML;

const activeTab = () => tabs.find(t => t.id === activeId) || null;
const tabByPath = (p) => tabs.find(t => t.path === p) || null;
function isDirty(t){ t = t || activeTab(); return !!(t && t.ed && t.ed.draft !== t.ed.baseContent); }

// ---------- árvore ----------
function ficoClass(ext){ return FICO_LETTER[ext] ? ext : 'gen'; }
function ficoLetter(ext){ return FICO_LETTER[ext] || (ext ? ext[0].toUpperCase() : '•'); }

function makeFileItem(entry){
  const it = document.createElement('div');
  it.className = 'tree-item file';
  it.dataset.path = entry.path;
  it.innerHTML = `<span class="fico ${ficoClass(entry.ext)}">${ficoLetter(entry.ext)}</span><span class="tree-label"></span>`;
  it.querySelector('.tree-label').textContent = entry.name;
  it.addEventListener('click', (e) => { e.stopPropagation(); openFile(entry); });
  return it;
}

function makeFolderNode(entry){
  const node = document.createElement('div');
  node.className = 'tree-node';
  const item = document.createElement('div');
  item.className = 'tree-item folder';
  item.dataset.path = entry.path;
  item.dataset.loaded = '0';
  item.innerHTML = `${SVG_CHEV}${SVG_FOLDER}<span class="tree-label"></span>`;
  item.querySelector('.tree-label').textContent = entry.name;
  const children = document.createElement('div');
  children.className = 'tree-children collapsed';
  item.addEventListener('click', (e) => { e.stopPropagation(); toggleFolder(entry.path, item, children); });
  node.append(item, children);
  return node;
}

async function toggleFolder(p, item, children){
  currentDir = p; // pasta clicada vira o foco da Mesa de Revisão
  const open = item.classList.toggle('open');
  children.classList.toggle('collapsed', !open);
  if (open && item.dataset.loaded === '0'){
    const chev = item.querySelector('.chev');
    chev.classList.add('spin');
    try { await loadInto(p, children); item.dataset.loaded = '1'; }
    catch (err){ children.innerHTML = `<div class="tree-item" style="color:var(--danger)">falha ao listar</div>`; console.error('tree', p, err); }
    finally { chev.classList.remove('spin'); }
  }
}

async function loadInto(p, container){
  const r = await api('tree', p);
  if (!r.ok) throw new Error(`tree ${r.status}`);
  const { entries } = await r.json();
  container.innerHTML = '';
  if (!entries.length){ container.innerHTML = `<div class="tree-item" style="color:var(--text-tertiary);font-style:italic">vazio</div>`; return; }
  const frag = document.createDocumentFragment();
  for (const e of entries) frag.append(e.type === 'dir' ? makeFolderNode(e) : makeFileItem(e));
  container.append(frag);
}

// ---------- abas ----------
function openFile(entry){
  currentDir = entry.path.split('/').slice(0, -1).join('/');
  const ex = tabByPath(entry.path);
  if (ex){ activateTab(ex.id); return; }
  const tab = { id: ++tabSeq, path: entry.path, name: entry.name, ext: entry.ext, kind: kindOf(entry.ext), size: entry.size, mode: 'eye', ed: null };
  tabs.push(tab);
  activateTab(tab.id);
}

function activateTab(id){
  captureDraft();               // preserva o rascunho da aba que estou deixando
  activeId = id;
  const t = activeTab();
  switchToFileTab();
  renderTabs();
  setActiveTreeItem(t.path);
  setBreadcrumb(t.path);
  setStatus(t);
  const hasToggle = t.kind === 'md' || t.kind === 'html';
  $('ec-toggle').classList.toggle('hidden', !hasToggle);
  $('mode-eye').classList.toggle('active', t.mode === 'eye');
  $('mode-code').classList.toggle('active', t.mode === 'code');
  // aba de fundo pode ter mudado no disco enquanto inativa — se não há edição pendente, recarrega
  if (t.ed && !isDirty(t)) t.ed = null;
  renderViewer(t.mode);
  fetch('/api/watch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ path: t.path }) }).catch(() => {});
}

// captura, antes de trocar/re-renderizar, o rascunho e a posição de scroll da aba atual
function captureDraft(){
  const t = activeTab();
  if (!t) return;
  const ta = document.querySelector('.code-edit');
  if (ta){
    if (t.ed) t.ed.draft = ta.value;
    t.scrollCode = ta.scrollTop; t.selCode = ta.selectionStart;
  } else {
    const panel = $('content').querySelector('.panel');
    if (panel) t.scrollEye = panel.scrollTop;
  }
}

function restoreScroll(t, which){
  requestAnimationFrame(() => {
    if (which === 'code'){
      const ta = document.querySelector('.code-edit');
      if (ta){ if (t.scrollCode) ta.scrollTop = t.scrollCode; if (t.selCode != null){ ta.selectionStart = ta.selectionEnd = t.selCode; } }
    } else {
      const panel = $('content').querySelector('.panel');
      if (panel && t.scrollEye) panel.scrollTop = t.scrollEye;
    }
  });
}

function closeTab(id){
  const t = tabs.find(x => x.id === id);
  if (!t) return;
  if (isDirty(t)){
    if (t.id !== activeId) activateTab(id);
    promptSwitch(
      () => saveFile().then(ok => { if (ok) reallyClose(id); }),
      () => reallyClose(id),
      () => {},
    );
    return;
  }
  reallyClose(id);
}

function reallyClose(id){
  const idx = tabs.findIndex(t => t.id === id);
  if (idx < 0) return;
  tabs.splice(idx, 1);
  if (activeId === id){
    const next = tabs[idx] || tabs[idx - 1] || null;
    if (next) activateTab(next.id);
    else { activeId = null; renderTabs(); setActiveTreeItem(null); setBreadcrumbEmpty(); $('ec-toggle').classList.add('hidden'); $('content').innerHTML = PLACEHOLDER_HTML; }
  } else renderTabs();
}

function renderTabs(){
  const bar = $('tabbar');
  bar.innerHTML = '';
  bar.style.display = tabs.length ? '' : 'none';
  for (const t of tabs){
    const el = document.createElement('div');
    el.className = 'file-tab' + (t.id === activeId ? ' active' : '') + (isDirty(t) ? ' dirty' : '');
    el.innerHTML = `<span class="fico ${ficoClass(t.ext)}">${ficoLetter(t.ext)}</span><span class="ft-name"></span><span class="ft-dot"></span><span class="ft-close" title="Fechar">×</span>`;
    el.querySelector('.ft-name').textContent = t.name;
    el.addEventListener('click', (e) => { if (e.target.closest('.ft-close')) return; activateTab(t.id); });
    el.querySelector('.ft-close').addEventListener('click', (e) => { e.stopPropagation(); closeTab(t.id); });
    el.addEventListener('auxclick', (e) => { if (e.button === 1){ e.preventDefault(); closeTab(t.id); } }); // botão do meio fecha
    bar.append(el);
  }
}

// ---------- viewer ----------
function kindOf(ext){
  if (MD.has(ext)) return 'md';
  if (HTM.has(ext)) return 'html';
  if (IMG.has(ext)) return 'image';
  if (VID.has(ext)) return 'video';
  if (AUD.has(ext)) return 'audio';
  return 'text';
}

function setActiveTreeItem(p){
  document.querySelectorAll('.tree-item.file.active').forEach(a => a.classList.remove('active'));
  if (!p) return;
  const it = document.querySelector(`.tree-item.file[data-path="${cssEsc(p)}"]`);
  if (it) it.classList.add('active');
}

function setBreadcrumb(p){
  const parts = p.split('/');
  const file = parts.pop();
  const bc = $('breadcrumb');
  bc.innerHTML = '';
  for (const seg of parts){
    const s = document.createElement('span'); s.className = 'seg'; s.textContent = seg; bc.append(s);
    const sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = '/'; bc.append(sep);
  }
  const f = document.createElement('span'); f.className = 'seg file';
  f.innerHTML = `<span class="dot-md"></span>`; f.append(document.createTextNode(file));
  bc.append(f);
  updateDirtyUI();
}
function setBreadcrumbEmpty(){ $('breadcrumb').innerHTML = `<span class="seg">selecione um arquivo na árvore</span>`; }

function setStatus(t){
  $('sb-type').textContent = { md:'Markdown', html:'HTML', image:'Imagem', video:'Vídeo', audio:'Áudio', text:'Texto' }[t.kind] || '—';
  $('sb-size').textContent = fmtBytes(t.size != null ? Number(t.size) : null);
  $('sb-path').textContent = t.path.split('/').slice(0, -1).join('/');
}

function setMode(mode){
  const t = activeTab(); if (!t) return;
  captureDraft();
  t.mode = mode;
  $('mode-eye').classList.toggle('active', mode === 'eye');
  $('mode-code').classList.toggle('active', mode === 'code');
  renderViewer(mode);
}

async function renderViewer(mode){
  const t = activeTab(); if (!t) return;
  const c = $('content');
  const fileUrl = `/api/file?path=${encodeURIComponent(t.path)}`;
  const draft = (t.ed && t.ed.draft !== t.ed.baseContent) ? t.ed.draft : null; // rascunho não salvo
  if (mode === 'code' || t.kind === 'text') return renderCode(c, t);
  switch (t.kind){
    case 'md':    return renderMarkdown(c, t, draft);
    case 'html': {
      c.innerHTML = `<iframe class="html-frame" sandbox="allow-scripts"></iframe>`;
      const f = c.querySelector('iframe');
      if (draft != null) f.srcdoc = draft; else f.src = fileUrl; // live-preview do rascunho ou disco
      return;
    }
    case 'image': c.innerHTML = `<div class="media-wrap"><img src="${fileUrl}" alt=""></div>`; return;
    case 'video': c.innerHTML = `<div class="media-wrap"><video controls src="${fileUrl}"></video></div>`; return;
    case 'audio': c.innerHTML = `<div class="media-wrap"><audio controls src="${fileUrl}"></audio></div>`; return;
    default:      return renderCode(c, t);
  }
}

async function renderMarkdown(c, t, draft){
  c.innerHTML = `<div class="panel"><div class="doc-wrap" id="md-out">carregando…</div></div>`;
  let html;
  try {
    if (draft != null){
      const dir = t.path.split('/').slice(0, -1).join('/');
      const r = await fetch('/api/render-md', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: draft, dir }) });
      if (!r.ok) throw 0;
      html = (await r.json()).html;
    } else {
      const r = await api('render', t.path);
      if (!r.ok){ const e = await r.json().catch(()=>({})); return showFallback(c, t.path, e.error || `erro ${r.status}`); }
      html = (await r.json()).html;
    }
  } catch { return showFallback(c, t.path, 'erro ao renderizar'); }
  const out = $('md-out'); if (out) out.innerHTML = html;
  restoreScroll(t, 'eye');
}

async function renderCode(c, t){
  c.innerHTML = `<div class="panel"><div class="code-wrap"><div class="code-gutter"></div><textarea class="code-edit" spellcheck="false" wrap="off"></textarea></div></div>`;
  const ta = c.querySelector('.code-edit');
  const gutter = c.querySelector('.code-gutter');

  if (t.ed == null){
    const r = await api('raw', t.path);
    if (!r.ok){ const e = await r.json().catch(()=>({})); return showFallback(c, t.path, e.error || `erro ${r.status}`); }
    const text = await r.text();
    const mtime = Number(r.headers.get('X-Mtime')) || null;
    ta.value = text;
    // baseContent = ta.value (não `text`): o textarea normaliza CRLF→LF ao ler de volta; guarda o EOL p/ salvar fiel
    t.ed = { draft: ta.value, baseContent: ta.value, baseMtime: mtime, eol: /\r\n/.test(text) ? '\r\n' : '\n' };
  } else {
    ta.value = t.ed.draft; // restaura o rascunho (preserva edição entre trocas de aba)
  }

  const syncGutter = () => {
    const n = ta.value.split('\n').length;
    gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
  };
  syncGutter();
  ta.addEventListener('input', () => { t.ed.draft = ta.value; syncGutter(); updateDirtyUI(); renderTabs(); });
  ta.addEventListener('scroll', () => { gutter.scrollTop = ta.scrollTop; });
  updateDirtyUI();
  restoreScroll(t, 'code');
}

// ---------- edição / save (§16) ----------
function updateDirtyUI(){
  const dirty = isDirty();
  const seg = document.querySelector('.breadcrumb .seg.file');
  if (seg) seg.classList.toggle('dirty', dirty);
  $('foot-status').textContent = dirty ? '● não salvo — Ctrl+S para salvar' : 'conectado';
}

const postSave = (path, content, baseMtime) => fetch('/api/save', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ path, content, baseMtime }),
});

async function saveFile(){
  const t = activeTab();
  if (!isDirty(t)) return true;
  const valueLF = t.ed.draft;
  const content = valueLF.replace(/\n/g, t.ed.eol);
  const r = await postSave(t.path, content, t.ed.baseMtime);
  if (r.status === 409){
    return new Promise((resolve) => showBanner('O arquivo mudou no disco desde que você abriu.', [
      { label: 'Sobrescrever', primary: true, onClick: async () => {
          const j = await postSave(t.path, content, null).then(x => x.json()); // sem baseMtime = força
          commitSaved(t, valueLF, j.mtime); resolve(true);
      } },
      { label: 'Recarregar do disco', onClick: () => { t.ed = null; renderViewer('code'); resolve(false); } },
    ]));
  }
  if (!r.ok){ $('foot-status').textContent = 'falha ao salvar'; return false; }
  const { mtime } = await r.json();
  commitSaved(t, valueLF, mtime);
  return true;
}

function commitSaved(t, content, mtime){
  if (!t.ed) return;
  t.ed.baseContent = content;
  t.ed.baseMtime = mtime;
  updateDirtyUI(); renderTabs();
  $('foot-status').textContent = 'salvo ' + new Date().toLocaleTimeString('pt-BR');
}

// ---------- banners não-modais ----------
function showBanner(message, actions){
  hideBanner();
  const bar = document.createElement('div');
  bar.className = 'banner'; bar.id = 'espia-banner';
  const msg = document.createElement('span'); msg.className = 'banner-msg'; msg.textContent = message;
  bar.append(msg);
  for (const a of actions){
    const b = document.createElement('button');
    b.className = 'banner-btn' + (a.primary ? ' primary' : '');
    b.textContent = a.label;
    b.addEventListener('click', () => { hideBanner(); a.onClick(); });
    bar.append(b);
  }
  $('content').append(bar);
}
function hideBanner(){ const b = $('espia-banner'); if (b) b.remove(); }

function promptSwitch(onSave, onDiscard, onCancel){
  const t = activeTab();
  showBanner(`Alterações não salvas em ${t ? t.name : 'arquivo'}.`, [
    { label: 'Salvar', primary: true, onClick: onSave },
    { label: 'Descartar', onClick: onDiscard },
    { label: 'Cancelar', onClick: onCancel },
  ]);
}

function showFallback(c, p, msg){
  c.innerHTML = `<div class="placeholder">
    <svg viewBox="0 0 24 24" fill="none"><path d="M12 9v4M12 16.5h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="12" r="9.5" stroke="currentColor" stroke-width="1.6"/></svg>
    <div class="big">Preview indisponível</div><div></div>
    <a class="dl" href="/api/file?path=${encodeURIComponent(p)}" download>Baixar arquivo</a>
  </div>`;
  c.querySelector('.placeholder div:nth-of-type(1)').textContent = msg;
}

// ---------- Mesa de Revisão (galeria) ----------
function switchToFileTab(){
  $('tab-arquivo').classList.add('active');
  $('tab-galeria').classList.remove('active');
  const t = activeTab();
  $('ec-toggle').style.display = '';
  $('ec-toggle').classList.toggle('hidden', !(t && (t.kind === 'md' || t.kind === 'html')));
}

function showView(view){
  if (view === 'galeria'){
    $('tab-galeria').classList.add('active');
    $('tab-arquivo').classList.remove('active');
    $('ec-toggle').style.display = 'none';
    renderGallery(currentDir);
  } else {
    switchToFileTab();
    if (activeTab()) renderViewer(activeTab().mode); else $('content').innerHTML = PLACEHOLDER_HTML;
  }
}

const STATUS_LABELS = { todos:'Todos', revisar:'A revisar', aprovado:'Aprovados', reprovado:'Reprovados', publicado:'Publicados' };
let galleryFilter = 'todos';

async function renderGallery(dir){
  const c = $('content');
  const label = dir || 'raiz';
  galleryFilter = 'todos';
  c.innerHTML = `<div class="panel"><div class="gallery-wrap">
    <div class="gallery-head"><h2>Mesa de Revisão</h2><span id="gallery-sub">${label}</span></div>
    <div class="gallery-filters" id="gallery-filters"></div>
    <div class="gallery-grid" id="gallery-grid"><div class="gallery-empty">carregando…</div></div>
  </div></div>`;
  const [gr, sr] = await Promise.all([api('gallery', dir), api('status', dir)]);
  const grid = $('gallery-grid');
  if (!gr.ok){ grid.innerHTML = `<div class="gallery-empty">erro ao listar a pasta</div>`; return; }
  const { items, count, truncated } = await gr.json();
  const statuses = sr.ok ? (await sr.json()).statuses : {};
  $('gallery-sub').textContent = `${label} · ${count} ${count === 1 ? 'item' : 'itens'}${truncated ? ' (limite 300)' : ''}`;
  if (!count){ grid.innerHTML = `<div class="gallery-empty">Nenhuma imagem ou vídeo nesta pasta (nem em subpastas).</div>`; return; }
  grid.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const it of items) frag.append(makeGalleryCard(it, statuses[it.path] || 'revisar', dir));
  grid.append(frag);
  renderFilters(dir);
}

function renderFilters(dir){
  const bar = $('gallery-filters');
  if (!bar) return;
  const cards = [...document.querySelectorAll('.gallery-card')];
  const counts = {};
  cards.forEach(c => { counts[c.dataset.status] = (counts[c.dataset.status] || 0) + 1; });
  bar.innerHTML = '';
  for (const key of ['todos', 'revisar', 'aprovado', 'reprovado', 'publicado']){
    const n = key === 'todos' ? cards.length : (counts[key] || 0);
    if (key !== 'todos' && !n) continue; // só mostra filtro de status que tem itens
    const chip = document.createElement('button');
    chip.className = 'gallery-filter' + (key === galleryFilter ? ' on' : '');
    chip.textContent = `${STATUS_LABELS[key]} · ${n}`;
    chip.addEventListener('click', () => { galleryFilter = key; applyFilter(); renderFilters(dir); });
    bar.append(chip);
  }
}

function applyFilter(){
  document.querySelectorAll('.gallery-card').forEach(c => {
    c.style.display = (galleryFilter === 'todos' || c.dataset.status === galleryFilter) ? '' : 'none';
  });
}

function makeGalleryCard(it, status, dir){
  const card = document.createElement('div');
  card.className = 'gallery-card';
  card.dataset.status = status;
  const fileUrl = `/api/file?path=${encodeURIComponent(it.path)}`;
  const thumb = it.kind === 'video'
    ? `<video class="gallery-thumb" preload="metadata" muted src="${fileUrl}#t=0.1"></video><span class="gallery-play">▶</span>`
    : `<img class="gallery-thumb" loading="lazy" src="${fileUrl}" alt="">`;
  card.innerHTML = `<div class="gallery-thumb-wrap ${it.kind}">${thumb}</div>
    <div class="gallery-card-body">
      <div class="gallery-name"></div>
      <div class="gallery-meta"><span>${it.ext.toUpperCase()}</span><span>${fmtBytes(it.size)}</span></div>
      <select class="gallery-status st-${status}">
        <option value="revisar">A revisar</option>
        <option value="aprovado">Aprovado</option>
        <option value="reprovado">Reprovado</option>
        <option value="publicado">Publicado</option>
      </select>
    </div>`;
  card.querySelector('.gallery-name').textContent = it.name;
  const sel = card.querySelector('.gallery-status');
  sel.value = status;
  sel.addEventListener('change', async () => {
    const ns = sel.value;
    sel.className = 'gallery-status st-' + ns;
    card.dataset.status = ns;
    try {
      await fetch('/api/status', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dir, file: it.path, status: ns }) });
    } catch { $('foot-status').textContent = 'falha ao salvar status'; }
    if (galleryFilter !== 'todos'){ applyFilter(); }
    renderFilters(dir);
  });
  // clicar no card abre o arquivo — exceto quando o alvo é o seletor de status
  card.addEventListener('click', (e) => {
    if (e.target.closest('.gallery-status')) return;
    openFile({ path: it.path, name: it.name, ext: it.ext, size: it.size });
  });
  return card;
}

$('tab-arquivo').addEventListener('click', () => showView('arquivo'));
$('tab-galeria').addEventListener('click', () => showView('galeria'));
$('mode-eye').addEventListener('click', () => setMode('eye'));
$('mode-code').addEventListener('click', () => setMode('code'));

// ---------- Ctrl+S salva; Ctrl+W fecha aba; guard ao fechar a janela ----------
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's'){ e.preventDefault(); if (isDirty()) saveFile(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'w'){ e.preventDefault(); if (activeId) closeTab(activeId); }
});
window.addEventListener('beforeunload', (e) => {
  if (tabs.some(t => isDirty(t))){ e.preventDefault(); e.returnValue = ''; }
});

// ---------- auto-reload via SSE (§16 linha 1) — só a aba ativa é vigiada ----------
try {
  const es = new EventSource('/api/events');
  es.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.event === 'open' && msg.path){ openByPath(msg.path); return; }
      if (msg.event === 'changed'){
        const t = activeTab();
        if (!t || msg.path !== t.path) return;
        if (isDirty(t)){
          showBanner('Este arquivo mudou no disco enquanto você editava.', [
            { label: 'Manter minha versão', primary: true, onClick: () => {} },
            { label: 'Recarregar do disco', onClick: () => { t.ed = null; renderViewer(t.mode); } },
          ]);
        } else {
          t.ed = null; // força recarregar do disco
          renderViewer(t.mode);
          $('foot-status').textContent = 'atualizado ' + new Date().toLocaleTimeString('pt-BR');
        }
      }
    } catch {}
  };
} catch (err) { console.warn('SSE indisponível', err); }

// abre um arquivo pelo path (gesto de entrega / SSE open)
function openByPath(p){
  const name = p.split('/').pop();
  const ext = name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  openFile({ path: p, name, ext, size: undefined });
}

// ---------- boot ----------
loadInto('', $('tree')).catch(err => {
  $('tree').innerHTML = `<div class="tree-item" style="color:var(--danger)">falha ao conectar ao servidor</div>`;
  console.error('boot', err);
});

const openParam = new URLSearchParams(location.search).get('open');
if (openParam) openByPath(openParam);
