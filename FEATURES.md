# Espia — backlog de features

Ideias e planos registrados para depois. Não implementar sem pedido explícito.
(Histórico das fases já entregues: `_features/2026-06-21-visualizador-hub-app-proprio.md`.)

---

# Migração Web → Desktop (Electron)

> **Status:** planejado, não iniciado. Stack **decidida: Electron** (2026-07-07).
> **Contexto:** hoje o Espia roda como servidor Node local + janela `msedge --app` ("Caminho A½"). Este é o plano executável para virar um **app desktop de verdade** (ícone, instalável, workspace configurável), reusando ao máximo o que já existe.
> **Princípio:** migração de menor atrito. O front e a API atuais são reusados quase 100%; o Electron é uma casca por cima, não uma reescrita.

## Convivência desktop + browser (decisão de design, 2026-07-07)

**O navegador NÃO deixa de existir ao migrar para desktop. Os dois coexistem, ao mesmo tempo, olhando o mesmo estado.**

O Electron não substitui o backend — ele sobe o **mesmo `server.js`** que existe hoje e carrega a **mesma UI** por HTTP. Enquanto o app está aberto, o servidor está no ar, então o navegador também pode abrir a mesma URL. Desktop e browser viram **dois clientes do mesmo Espia**:

- **Desktop** = modo rico (ícone, workspace nativo, menu, drag-drop, atalhos).
- **Browser** = modo leve (abrir rápido de qualquer lugar, sem instalar).
- **Mesma fonte de verdade:** o auto-reload (SSE) já é multi-cliente — editar/aprovar no desktop aparece na aba do browser sozinho, e vice-versa. O save (compare-and-swap por mtime) já protege edições concorrentes entre clientes.

**Consequência para o plano:** o transporte **HTTP é definitivo** — a antiga ideia de trocar por IPC puro fica **descartada**, porque IPC removeria o HTTP e mataria o modo browser. O custo (uma porta local interna, invisível) é irrelevante e é o que habilita a coexistência de graça.

## 1. Por que desktop (o que ganha sobre o A½ de hoje)

O A½ (janela `--app` do Edge) dá *cara* de app, mas não é um app. O desktop desbloqueia:

| Ganho | Hoje (A½) | Com Electron |
|---|---|---|
| **Workspace configurável** (a dor principal) | `root` fixo no `espia.config.json`, editado à mão | "Abrir pasta" nativo + recentes, como VS Code/Antigravity |
| App de ícone real | atalho `.lnk` que chama PowerShell | `.exe` instalável, ícone próprio, na barra de tarefas |
| Não depende do Edge | precisa do Edge instalado | Chromium embutido, autossuficiente |
| Integrações do SO | nenhuma | menu nativo, drag-drop do Explorer, atalho global, file associations (`.md` abre no Espia), notificações |
| Entrega de arquivo (`espia <path>`) | SSE via servidor | instância única do Electron recebe o path por argv (o SSE continua p/ o browser) |

## 2. Decisão: Electron (fundamentada)

Escolhido sobre Tauri em 2026-07-07. Razão central: **o backend do Espia é Express/Node** (markdown-it, sanitize-html, highlight.js). O Electron **embute o Node**, então o `server.js` roda no processo principal **sem reescrever nada**. Tauri exigiria reescrever a API em Rust ou empacotar o Node como sidecar (mais peças).

- **Trade-off aceito:** app de ~150 MB em disco, RAM ~250–400 MB. Irrelevante para uso pessoal diário.
- **É a stack de referência do operador:** VS Code e Antigravity são Electron.
- **Empacotador:** `electron-builder` (instalador Windows NSIS + ícone; auto-update opcional).

## 3. Arquitetura de migração

```
Electron
├── main process (Node)         ← roda o server.js ATUAL (Express) numa porta livre
│     + menu nativo, dialogs, workspace, single-instance
├── preload (contextBridge)     ← ponte segura: expõe só o que a UI precisa do SO
└── renderer (Chromium)         ← a UI ATUAL (index.html + app.js + styles.css), reuso 100%
      carrega http://127.0.0.1:<porta-livre>  (a mesma URL que o browser abre)
```

- O main process sobe o `server.js` como está, numa **porta livre dinâmica** (não fixa em 4600), e o `BrowserWindow` carrega `http://127.0.0.1:<porta>`. **Zero mudança no backend e no front.**
- Melhor ainda: se o server já estiver rodando (standalone via `npm start`/`espia.ps1`), o Electron **conecta ao existente** em vez de subir outro (ping em `/api/ping`, como o `espia.ps1` já faz). Assim desktop, browser e agents compartilham uma instância.
- **Reuso:** `server.js`, `public/*` e a lógica toda ficam **intactos**. O código novo é só `main.js`, `preload.js` e a config de build.

## 4. Config de workspace (a feature-motor)

Espelha o "Abrir Pasta" do VS Code/Antigravity. Hoje o `root` é fixo no `espia.config.json`; no desktop vira **dinâmico por sessão** — o usuário escolhe.

- **Abrir pasta:** menu `Arquivo → Abrir pasta…` → `dialog.showOpenDialog({ properties: ['openDirectory'] })` → atualiza o `currentRoot` e recarrega a árvore.
- **Workspaces recentes:** lista persistida em `app.getPath('userData')/espia-workspaces.json` (por-máquina, fora do repo). Menu `Abrir recente`. Última aberta = default no próximo boot.
- **Trocar sem reiniciar:** atualiza `currentRoot` e re-renderiza.
- **Multi-workspace (evolução):** várias janelas, cada uma com sua raiz. Começa com uma raiz por vez.
- **Mudança no backend:** o `ROOT` do `server.js` (hoje `const` no boot) vira **mutável**, setável pelo main. O `espia.config.json` deixa de ter `root` fixo (vira default retrocompatível). O guard `path.relative` + `fs.realpath` continua validando contra o `currentRoot` — trocar de raiz não afrouxa a segurança.
- **Vale para o browser também:** como o root é do servidor, trocar o workspace no desktop reflete no browser (mesmo backend).

## 5. Integrações nativas

- **Menu nativo:** `Arquivo` (Abrir pasta, Abrir recente, Salvar, Fechar aba), `Ver` (Recarregar, DevTools, Mesa), `Janela`.
- **Entrega `espia <path>`:** `app.requestSingleInstanceLock()` + evento `second-instance` — rodar `espia arquivo.md` de novo não abre outra janela; a instância aberta recebe o path por `argv`. (O SSE `open` continua servindo o modo browser.)
- **Drag-drop do Explorer**, **file associations** (`.md`/`.html` → Espia), **atalho global**, **notificações nativas** — por valor, incrementais.

## 6. Empacotamento, instalador, atualização

- **`electron-builder`** → instalador Windows **NSIS** (`.exe`) + ícone (`.ico` multi-resolução a partir do SVG da raposa do topbar). Alvo `win` x64.
- **Assinatura de código:** dispensável para uso pessoal (aceitar "editor desconhecido").
- **Auto-update** (`electron-updater`): opcional; se quiser, publicar releases no `espia-filesystem`.

## 7. Fases executáveis

| Fase | Escopo | Critério de pronto | Sessão (h) |
|---|---|---|---|
| **D1 — Empacotar (reuso literal)** | `main.js` sobe/conecta ao `server.js`; `BrowserWindow` carrega a UI; menu básico; single-instance | O Espia abre como janela Electron com TODAS as features atuais; o browser ainda abre a mesma URL em paralelo | **2–4h** |
| **D2 — Workspace** | "Abrir pasta" nativo + `currentRoot` mutável + recentes; `root` do config vira default | Trocar a raiz pelo menu, sem editar JSON; recentes lembrados entre sessões | 2–3h |
| **D3 — Integrações nativas** | menu completo, `second-instance` (entrega), drag-drop, notificações | `espia arquivo.md` abre na janela existente; soltar arquivo abre no viewer | 2–4h |
| **D4 — Instalador** | `electron-builder`, ícone `.ico`, NSIS | Gera `.exe` que instala o Espia com ícone; abre pelo menu Iniciar | 1–2h |

**Total D1–D4 (app instalável, workspace configurável): ~7–13h**, em 2–3 sessões. O D1 sozinho já entrega o app numa sessão — e o browser continua funcionando lado a lado.

## 8. O que NÃO muda (o reuso que barateia tudo)

- **Front inteiro** (`public/*`) — reuso 100%.
- **API e lógica** (`server.js`) — reuso ~100%; só o `ROOT` vira mutável (§4).
- **Testes** (`test_smoke.mjs`) — continuam válidos.
- **Todas as features** (árvore, abas, edição/save, auto-reload, Mesa, status, highlight, live-preview) — sem toque.
- **O modo browser** — continua existindo e sincronizado (decisão de convivência acima).

## 9. Riscos e mitigações

- **Porta ocupada** → porta livre dinâmica; ou conectar ao server já rodando.
- **Segurança do Electron** → `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` no renderer (a UI só fala com o backend por HTTP). Preload mínimo via `contextBridge`. Mantém o guard de path traversal.
- **Tamanho/RAM** → aceito (decisão §2).
- **Duas instâncias do server** → o Electron faz ping antes de subir; reusa o que já estiver no ar.

---

# Outras features futuras

## Integração com o Drive (aprovar → publicar → resgatar link)

Fechar o loop da Mesa de aprovação com o Google Drive:

- Configurar uma **pasta-destino no Drive** — via disco `H:` (File Stream) **ou** um file-link / ID de pasta.
- Quando um criativo é marcado **Aprovado** (ou por um botão dedicado), o Espia **copia o arquivo para o Drive** e **resgata o link compartilhável** de volta.
  - Via `H:`: copiar PARA o `H:` já faz o upload; o link sai do `get_drive_shareable_link` (workspace-mcp) ou do próprio Drive.
- O **link fica guardado no `.espia.json`** ao lado do status, para colar depois.
- Resultado: revisar na Mesa → aprovar → arquivo no Drive com link pronto.

> **Cuidado `H:` (File Stream):** ler/copiar DE `H:` baixa o arquivo; copiar PARA `H:` sobe. Path com `[colchetes]` exige `-LiteralPath`. Respeitar `memory/reference_drive_file_stream.md`.

## Botão "consolidar aprovados → `_APROVADOS`"

A opção híbrida da Fase 5 (tirada de escopo em 2026-07-07). Move em lote os aprovados para a pasta `_APROVADOS` do fluxo atual do Nycolas. Provavelmente redundante se a integração com o Drive cobrir a necessidade — reavaliar depois do Drive.

## Outros

- **CodeMirror 6 no modo Código** — highlight e undo/redo ricos durante a *edição* (o textarea atual não colore o que se digita). Bundlar via esbuild em `public/vendor/`, sem tocar na API.
- **Board Kanban** de colunas (A revisar → Aprovado → Publicado) como alternativa às pills + filtro.
- **Metadado por-agente** na Mesa (badge socialsmith/adsmith/cinesmith) quando houver convenção madura de entrega.
- **Virtualização da árvore** — só se uma pasta com centenas de itens visíveis travar (hoje o lazy-load já limita o DOM).
