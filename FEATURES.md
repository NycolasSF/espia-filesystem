# Espia — backlog de features

Ideias registradas para depois. Não implementar sem pedido explícito.
(Histórico das fases já entregues: `_features/2026-06-21-visualizador-hub-app-proprio.md`.)

## Integração com o Drive (aprovar → publicar → resgatar link)

Fechar o loop da Mesa de aprovação com o Google Drive:

- Configurar no `espia.config.json` uma **pasta-destino no Drive** — via disco `H:` (File Stream) **ou** um file-link / ID de pasta.
- Quando um criativo é marcado **Aprovado** (ou por um botão dedicado), o Espia **copia o arquivo para essa pasta do Drive** e **resgata o link compartilhável** de volta.
  - Via `H:`: copiar PARA o `H:` já faz o upload automático; o link sai do `get_drive_shareable_link` (workspace-mcp) ou do próprio Drive.
- O **link fica guardado no `.espia.json`** ao lado do status, para colar depois.
- Resultado: revisar na Mesa → aprovar → arquivo no Drive com link pronto.

> **Cuidado `H:` (File Stream):** ler/copiar DE `H:` baixa o arquivo; copiar PARA `H:` sobe. Path com `[colchetes]` exige `-LiteralPath`. Respeitar `memory/reference_drive_file_stream.md`.

## Botão "consolidar aprovados → `_APROVADOS`"

A opção híbrida da Fase 5 (tirada de escopo em 2026-07-07 a pedido do Nycolas). Move em lote os criativos aprovados para a pasta `_APROVADOS` do fluxo atual dele. Provavelmente redundante se a integração com o Drive acima cobrir a necessidade — reavaliar depois do Drive.

## Outros

- **CodeMirror 6 no modo Código** — highlight e undo/redo ricos durante a *edição* (o textarea atual não colore o que se digita). Bundlar via esbuild em `public/vendor/`, sem tocar na API.
- **Board Kanban** de colunas (A revisar → Aprovado → Publicado) como alternativa às pills + filtro.
- **Metadado por-agente** na Mesa (badge socialsmith/adsmith/cinesmith) quando houver convenção madura de entrega.
- **Virtualização da árvore** — só se uma pasta com centenas de itens visíveis travar (hoje o lazy-load já limita o DOM).
