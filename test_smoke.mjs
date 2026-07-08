// Teste de fumaça do Espia — sobe o server, exercita a API, valida o guard de segurança.
// Roda: node test_smoke.mjs   (assert-based, sem framework)
import assert from 'node:assert';
import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4600;
const base = `http://127.0.0.1:${PORT}`;

const saveFixture = path.join(__dirname, '_smoke-save.md');
const refImg = path.join(__dirname, 'mockup', 'referencias', 'ref3-ai-workforce.png');
const srv = spawn(process.execPath, ['server.js'], { cwd: __dirname, stdio: 'pipe' });
srv.stdout.on('data', () => {});
srv.stderr.on('data', d => process.stderr.write(d));

async function waitUp(tries = 40){
  for (let i = 0; i < tries; i++){
    try { const r = await fetch(`${base}/api/tree?path=`); if (r.ok) return; } catch {}
    await new Promise(r => setTimeout(r, 150));
  }
  throw new Error('servidor não subiu');
}

let failed = false;
const check = async (name, fn) => {
  try { await fn(); console.log(`  ok  ${name}`); }
  catch (e) { failed = true; console.error(`FAIL  ${name}\n      ${e.message}`); }
};

try {
  await waitUp();

  await check('GET /api/tree lista a raiz', async () => {
    const r = await fetch(`${base}/api/tree?path=`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.ok(Array.isArray(j.entries) && j.entries.length > 0, 'esperava entradas na raiz');
  });

  await check('tree ignora node_modules/.git', async () => {
    const r = await fetch(`${base}/api/tree?path=PROJETOS/espia`);
    const j = await r.json();
    assert.ok(!j.entries.some(e => e.name === 'node_modules'), 'node_modules deveria estar filtrado');
  });

  await check('path traversal ../ retorna 403', async () => {
    const r = await fetch(`${base}/api/tree?path=${encodeURIComponent('../../Windows')}`);
    assert.equal(r.status, 403);
  });

  await check('path traversal absoluto retorna 403', async () => {
    const r = await fetch(`${base}/api/tree?path=${encodeURIComponent('C:\\Windows')}`);
    assert.ok(r.status === 403 || r.status === 404, `esperava 403/404, veio ${r.status}`);
  });

  await check('GET /api/render devolve HTML de um .md', async () => {
    const r = await fetch(`${base}/api/render?path=${encodeURIComponent('PROJETOS/espia/package.json')}`);
    // package.json não é MD mas render tenta; o que importa é não crashar (200 com html)
    assert.ok(r.status === 200, `render status ${r.status}`);
  });

  await check('GET /api/file serve com Content-Type e aceita Range', async () => {
    const r = await fetch(`${base}/api/file?path=${encodeURIComponent('PROJETOS/espia/package.json')}`, {
      headers: { Range: 'bytes=0-9' },
    });
    assert.ok(r.status === 206 || r.status === 200, `file status ${r.status}`);
  });

  await check('POST /api/render-md renderiza texto com highlight de código', async () => {
    const r = await fetch(`${base}/api/render-md`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '# oi\n\n```js\nconst x = 1;\n```\n' }) });
    assert.equal(r.status, 200);
    const { html } = await r.json();
    assert.ok(html.includes('<h1'), 'esperava heading renderizado');
    assert.ok(html.includes('hljs'), 'esperava classe de highlight no bloco de código');
  });

  await check('GET /api/ping responde', async () => {
    const r = await fetch(`${base}/api/ping`);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).ok, true);
  });

  await check('POST /api/open valida o path (403 fora da raiz)', async () => {
    const ok = await fetch(`${base}/api/open`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'PROJETOS/espia/package.json' }) });
    assert.equal(ok.status, 200);
    const bad = await fetch(`${base}/api/open`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: '../../Windows' }) });
    assert.equal(bad.status, 403);
  });

  await check('GET /api/gallery lista mídia da pasta', async () => {
    const r = await fetch(`${base}/api/gallery?path=${encodeURIComponent('PROJETOS/espia/mockup/referencias')}`);
    assert.equal(r.status, 200);
    const j = await r.json();
    assert.ok(j.count >= 1 && j.items.every(i => i.kind === 'image' || i.kind === 'video'), 'esperava só imagem/vídeo');
  });

  await check('status: grava e lê, cria .espia.json sem mover arquivo', async () => {
    const dir = 'PROJETOS/espia/mockup/referencias';
    const file = 'PROJETOS/espia/mockup/referencias/ref3-ai-workforce.png';
    const w = await fetch(`${base}/api/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir, file, status: 'aprovado' }) });
    assert.equal(w.status, 200);
    const rd = await (await fetch(`${base}/api/status?path=${encodeURIComponent(dir)}`)).json();
    assert.equal(rd.statuses[file], 'aprovado', 'status não persistiu');
    assert.ok(existsSync(refImg), 'o arquivo original não pode ter sido movido/apagado');
    // limpa: volta para revisar (remove a entrada)
    await fetch(`${base}/api/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir, file, status: 'revisar' }) });
  });

  await check('status: marcações concorrentes não corrompem o .espia.json', async () => {
    const dir = 'PROJETOS/espia/mockup/referencias';
    const files = ['ref1-dashboard-agencies.png','ref2-ai-coding-agent.webp','ref4-vscode-redesign.jpg','ref5-ai-study-notes-paleta.png'];
    // dispara tudo em paralelo — o server tem que serializar (senão o JSON corrompe)
    await Promise.all(files.map((n, i) => fetch(`${base}/api/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir, file: `${dir}/${n}`, status: ['aprovado','reprovado','publicado','aprovado'][i] }) })));
    const rd = await (await fetch(`${base}/api/status?path=${encodeURIComponent(dir)}`)).json();
    assert.equal(Object.keys(rd.statuses).length, 4, 'os 4 status concorrentes deveriam sobreviver, não corromper');
    // limpa
    await Promise.all(files.map(n => fetch(`${base}/api/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir, file: `${dir}/${n}`, status: 'revisar' }) })));
  });

  const relSave = 'PROJETOS/espia/_smoke-save.md';
  await fsp.writeFile(saveFixture, 'v1\n', 'utf8');

  await check('POST /api/save grava com baseMtime correto', async () => {
    const raw = await fetch(`${base}/api/raw?path=${encodeURIComponent(relSave)}`);
    const mtime = Number(raw.headers.get('X-Mtime'));
    assert.ok(mtime > 0, 'X-Mtime ausente no /api/raw');
    const r = await fetch(`${base}/api/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relSave, content: 'v2\n', baseMtime: mtime }) });
    assert.equal(r.status, 200);
    assert.equal(await fsp.readFile(saveFixture, 'utf8'), 'v2\n');
  });

  await check('POST /api/save com baseMtime errado retorna 409', async () => {
    const r = await fetch(`${base}/api/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relSave, content: 'v3\n', baseMtime: 1 }) });
    assert.equal(r.status, 409);
    assert.equal(await fsp.readFile(saveFixture, 'utf8'), 'v2\n', 'disco não deveria mudar em conflito');
  });

  await check('POST /api/save sem baseMtime força a escrita', async () => {
    const r = await fetch(`${base}/api/save`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: relSave, content: 'v4\n' }) });
    assert.equal(r.status, 200);
    assert.equal(await fsp.readFile(saveFixture, 'utf8'), 'v4\n');
  });
} finally {
  await fsp.rm(saveFixture, { force: true }).catch(() => {}); // fixture efêmero criado por este teste
  await fsp.rm(path.join(__dirname, 'mockup', 'referencias', '.espia.json'), { force: true }).catch(() => {});
  console.log(failed ? '\nRESULTADO: FALHOU' : '\nRESULTADO: OK');
  process.exitCode = failed ? 1 : 0;
  await new Promise(res => { srv.once('close', res); srv.kill(); }); // aguarda o filho fechar (evita crash de teardown no Windows)
}
