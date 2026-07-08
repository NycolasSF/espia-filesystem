# espia.ps1 — convocador do visualizador Espia (a raposa espia da boca da toca).
#
# Uso (humano no terminal, via função `espia` do $PROFILE):
#   espia                 → abre o Espia numa janela de app (sobe o server se preciso)
#   espia caminho\arq.md  → abre esse arquivo no Espia
#
# Uso (Claude / agents, por path absoluto — o $PROFILE não carrega em sessão não-interativa):
#   & 'F:\claude-projetos\PROJETOS\espia\espia.ps1' 'F:\claude-projetos\...\arquivo.png'
#
# É o "caminho pré-definido de entrega": um agente que produziu um artefato chama
#   & '...\espia.ps1' <path>  e a peça abre na janela já aberta (via SSE) — sem F5.

param([string]$Path)

$Port     = 4600
$Root     = 'F:\claude-projetos'
$EspiaDir = 'F:\claude-projetos\PROJETOS\espia'
$Base     = "http://127.0.0.1:$Port"

function Test-EspiaUp {
  try { Invoke-RestMethod "$Base/api/ping" -TimeoutSec 1 -ErrorAction Stop | Out-Null; $true }
  catch { $false }
}

$wasUp = Test-EspiaUp
if (-not $wasUp) {
  Start-Process -FilePath 'node' -ArgumentList 'server.js' -WorkingDirectory $EspiaDir -WindowStyle Hidden
  for ($i = 0; $i -lt 40; $i++) { if (Test-EspiaUp) { break }; Start-Sleep -Milliseconds 200 }
  if (-not (Test-EspiaUp)) { Write-Host 'espia: o servidor nao subiu.' -ForegroundColor Red; return }
}

# resolve o path para relativo ao hub (forward slashes)
$rel = $null
if ($Path) {
  try { $abs = (Resolve-Path -LiteralPath $Path -ErrorAction Stop).Path }
  catch { Write-Host "espia: caminho nao encontrado: $Path" -ForegroundColor Red; return }
  if (-not $abs.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
    Write-Host "espia: fora do hub ($Root): $abs" -ForegroundColor Red; return
  }
  $rel = $abs.Substring($Root.Length).TrimStart('\', '/').Replace('\', '/')
}

# server ja estava no ar: a janela existente navega via SSE (POST /api/open)
if ($wasUp -and $rel) {
  try { Invoke-RestMethod -Method Post "$Base/api/open" -ContentType 'application/json' -Body (@{ path = $rel } | ConvertTo-Json) -ErrorAction Stop | Out-Null }
  catch { Write-Host 'espia: falha ao enviar open (janela aberta?)' -ForegroundColor Yellow }
}

# abre a janela --app quando: comando sem path (abrir o app) OU o server acabou de subir.
# se acabou de subir com path, a URL ja carrega apontando pro arquivo (?open=), sem depender do SSE.
if (-not $Path -or -not $wasUp) {
  $url = if ($rel) { "$Base/?open=$([uri]::EscapeDataString($rel))" } else { $Base }
  if (Get-Command msedge -ErrorAction SilentlyContinue) { Start-Process 'msedge' "--app=$url" }
  elseif (Get-Command chrome -ErrorAction SilentlyContinue) { Start-Process 'chrome' "--app=$url" }
  else { Start-Process $url }
}
