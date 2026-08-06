$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$node = "C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
$next = Join-Path $projectRoot "node_modules\next\dist\bin\next"
$logDir = Join-Path $projectRoot "logs"
$logFile = Join-Path $logDir "dev-3001.log"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
Set-Location $projectRoot

cmd.exe /c "`"$node`" `"$next`" dev -p 3001 > `"$logFile`" 2>&1"
