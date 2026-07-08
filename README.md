# Espia 🦊

Visualizador de arquivos do hub `F:\claude-projetos` — a raposa espia o mundo da boca da toca.
Um "VS Code de visualização": árvore de pastas + viewer que renderiza qualquer artefato (Markdown, HTML, imagem, vídeo, áudio, código), com toggle Olho↔Código e auto-reload do arquivo aberto.

Plano completo e histórico de decisões: `_features/2026-06-21-visualizador-hub-app-proprio.md`.

## Rodar

```bash
npm install    # uma vez
npm start      # sobe em http://127.0.0.1:4600
npm test       # teste de fumaça (tree, path traversal 403, render, Range, save, gallery, open)
```

Ou pelo terminal, de qualquer lugar (função no `$PROFILE`):

```powershell
espia              # abre o Espia numa janela de app (sobe o server se preciso)
espia caminho\arq  # abre esse arquivo no Espia
```

Agents e scripts chamam o motor por path absoluto (o `$PROFILE` não carrega em sessão não-interativa):

```powershell
& 'F:\claude-projetos\PROJETOS\espia\espia.ps1' 'F:\claude-projetos\...\arquivo.png'
```

## Stack (Fase 1)

Node + Express 5 + `markdown-it` + `sanitize-html`. Client vanilla (sem framework, sem build).
Markdown é renderizado no servidor; mídia é servida com HTTP Range (vídeo/áudio com seek).

## Config — `espia.config.json`

| chave | o que é |
|---|---|
| `root` | raiz navegável (default `F:\claude-projetos`) |
| `port` | porta do servidor (4600) |
| `ignore` | pastas/arquivos ocultados na árvore (node_modules, .git, .venv, chroma_db…) |
| `maxTextBytes` | limite de leitura de texto cru (10 MB) |
| `maxRenderBytes` | limite de render de Markdown (2 MB; acima disso, usar o modo Código) |

## Segurança

- Bind em `127.0.0.1` — não exposto na rede.
- Guard de path traversal: `path.relative` + `fs.realpath` (bloqueia escape via symlink).
- HTML de terceiros em `<iframe sandbox>` sem `allow-same-origin`.

## Editar e salvar

No modo **Código**, o arquivo é editável. `Ctrl+S` salva de volta na fonte, com:
- escrita atômica (tmp + rename) — nunca deixa arquivo truncado;
- compare-and-swap por mtime — se um agente escreveu no disco desde que você abriu, avisa em vez de esmagar;
- indicador de edição não salva e banner ao trocar de arquivo/fechar com pendência.

## Mesa de Revisão

A tab **Mesa de Revisão** mostra toda a mídia (imagem/vídeo) de uma pasta e suas subpastas como grid de thumbnails — para revisar um lote de criativos de uma vez, sem abrir um por um. A pasta em foco é a última pasta clicada na árvore (ou a do arquivo aberto). Clicar num card abre a mídia no viewer.

Cada card tem um **status de aprovação** (A revisar / Aprovado / Reprovado / Publicado) e a Mesa tem filtros por status. O status é salvo num `.espia.json` na pasta (legível, versionável) e **não move nem renomeia** os arquivos.

## Estado

Fases 1 (MVP navegável), 2 (edição + save seguro), 3 (Mesa de Revisão), 4 (gesto `espia` + janela de app) e 5 (mesa de aprovação por status) entregues, mais abas de arquivos. Refinamentos adiados no plano do hub: `_features/2026-06-21-visualizador-hub-app-proprio.md`.
