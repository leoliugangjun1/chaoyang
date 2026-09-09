@echo off
setlocal

set "TASK_NAME=AI Image Workbench LAN"
set "HOST=192.168.66.140"
set "APP_PORT=8081"
set "PROXY_PORT=8082"
set "NGINX_ROOT=D:\phpstudy_pro\Extensions\Nginx1.15.11"
set "NGINX_EXE=%NGINX_ROOT%\nginx.exe"

echo Starting AI Image Workbench...
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing 'http://%HOST%:%APP_PORT%/api/health' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  schtasks /run /tn "%TASK_NAME%" >nul 2>&1
  if errorlevel 1 (
    echo Failed to start the scheduled task "%TASK_NAME%".
    echo Run this script as Administrator and try again.
    pause
    exit /b 1
  )
) else (
  echo Workbench service is already running.
)

if not exist "%NGINX_EXE%" (
  echo Xiaopi Nginx was not found at:
  echo %NGINX_EXE%
  pause
  exit /b 1
)

echo Checking Xiaopi Nginx proxy...
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing 'http://%HOST%:%PROXY_PORT%/api/health' -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 (
  echo Starting Xiaopi Nginx proxy...
  powershell -NoProfile -Command "Start-Process -FilePath '%NGINX_EXE%' -ArgumentList '-p','%NGINX_ROOT%\' -WindowStyle Hidden"
) else (
  echo Xiaopi Nginx proxy is already running.
)

echo Waiting for the Workbench service...
powershell -NoProfile -Command "$deadline = (Get-Date).AddSeconds(60); do { try { Invoke-WebRequest -UseBasicParsing 'http://%HOST%:%APP_PORT%/api/health' -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep -Seconds 1 } } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo Workbench service is not ready: http://%HOST%:%APP_PORT%
  pause
  exit /b 1
)

echo Waiting for the Xiaopi proxy...
powershell -NoProfile -Command "$deadline = (Get-Date).AddSeconds(20); do { try { Invoke-WebRequest -UseBasicParsing 'http://%HOST%:%PROXY_PORT%/api/health' -TimeoutSec 2 | Out-Null; exit 0 } catch { Start-Sleep -Seconds 1 } } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo Xiaopi proxy is not ready: http://%HOST%:%PROXY_PORT%
  pause
  exit /b 1
)

echo.
echo LAN service is ready:
echo http://%HOST%:%PROXY_PORT%/
