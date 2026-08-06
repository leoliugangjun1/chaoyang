$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$port = 3001
$url = "http://127.0.0.1:$port"
$node = "C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$next = Join-Path $projectRoot "node_modules\next\dist\bin\next"
$logDir = Join-Path $projectRoot "logs"
$logFile = Join-Path $logDir "start-prod.log"

Set-Location $projectRoot

if (-not (Test-Path -LiteralPath $node)) {
  $nodeCommand = Get-Command node -ErrorAction SilentlyContinue
  if ($null -ne $nodeCommand) {
    $node = $nodeCommand.Source
  }
  else {
    Write-Host "Node.js was not found." -ForegroundColor Red
    Write-Host "Update the NODE path in scripts\start-prod.ps1."
    Read-Host "Press Enter to close"
    exit 1
  }
}

$listener = @(netstat -ano | Select-String ":$port" | Select-String "LISTENING")
if ($listener.Count -gt 0) {
  Write-Host "The workbench is already running: $url" -ForegroundColor Green
  Start-Process $url
  Read-Host "Press Enter to close this window"
  exit 0
}

if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}

Write-Host "Starting the visual strategy workbench..." -ForegroundColor Cyan
Write-Host "Address: $url"
Write-Host "Close this window to stop the service."

& $node $next start -p $port 2>&1 | Tee-Object -FilePath $logFile
$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  Write-Host "Startup failed. Log: $logFile" -ForegroundColor Red
  Read-Host "Press Enter to close"
  exit $exitCode
}
