@echo off
cd /d "%~dp0.."
"C:\Users\Administrator\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" ".\scripts\preview-server.mjs" > ".\logs\preview-server.log" 2>&1
