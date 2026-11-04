@echo off
title INSTALADOR DE BRIDGE PARA NUEVO PC - SIMULADOR TCA
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo =================================================================
echo    INSTALADOR DE HARDWARE BRIDGE PARA NUEVO PC (LECTORES ACR1251)
echo    Simulador TCA - Recaudo Bogota S.A.S.
echo =================================================================
echo.

:: 1. Verificar Node.js
echo [1/6] Verificando instalacion de Node.js...
where node >nul 2>&1
if %errorlevel% neq 0 (
    if exist "C:\Program Files\nodejs\node.exe" (
        set "PATH=%PATH%;C:\Program Files\nodejs"
    ) else (
        echo [!] Node.js no esta instalado en este equipo.
        echo     Intentando instalar Node.js LTS automaticamente con winget...
        winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
        set "PATH=%PATH%;C:\Program Files\nodejs"
    )
)
echo [OK] Node.js listo.

:: 2. Activar servicio Smart Card (SCardSvr) de Windows para los lectores ACR1251
echo [2/6] Activando servicio de Tarjeta Inteligente de Windows (SCardSvr)...
powershell -NoProfile -Command "Start-Process powershell -ArgumentList '-NoProfile -Command \"Set-Service -Name SCardSvr -StartupType Automatic; Start-Service -Name SCardSvr\"' -Verb RunAs -Wait" >nul 2>&1
echo [OK] Servicio PC/SC de lectores ACR1251 habilitado.

:: 3. Verificar dependencias en node_modules
echo [3/6] Verificando librerias del Bridge (node_modules)...
if not exist "node_modules\ws" (
    echo     Instalando dependencias...
    call npm install
)
echo [OK] Librerias listas.

:: 4. Registrar protocolo tca-bridge:// (para el boton Activar desde Vercel) y Auto-Inicio en Windows
echo [4/6] Registrando boton "Activar" para Vercel y auto-inicio silencioso...
powershell -NoProfile -Command "$projPath = (Get-Location).Path; $vbsPath = Join-Path $projPath 'INICIAR_BRIDGE_SILENCIOSO.vbs'; New-Item -Path 'HKCU:\Software\Classes\tca-bridge' -Force | Out-Null; Set-ItemProperty -Path 'HKCU:\Software\Classes\tca-bridge' -Name '(Default)' -Value 'URL:Simulador TCA Bridge Protocol'; Set-ItemProperty -Path 'HKCU:\Software\Classes\tca-bridge' -Name 'URL Protocol' -Value ''; New-Item -Path 'HKCU:\Software\Classes\tca-bridge\shell\open\command' -Force | Out-Null; Set-ItemProperty -Path 'HKCU:\Software\Classes\tca-bridge\shell\open\command' -Name '(Default)' -Value ('wscript.exe \"' + $vbsPath + '\" \"%1\"'); $startupFolder = [Environment]::GetFolderPath('Startup'); $startupVbs = Join-Path $startupFolder 'SimuladorTCA_Bridge.vbs'; Set-Content -Path $startupVbs -Value ('Set WshShell = CreateObject(\"WScript.Shell\")' + [Environment]::NewLine + 'WshShell.Run \"wscript.exe \"\"' + $vbsPath + '\"\"\", 0, False') -Encoding ASCII"
echo [OK] Protocolo tca-bridge:// y auto-inicio registrados.

:: 5. Abrir puertos 3000 y 8080 en Firewall
echo [5/6] Configurando permisos de Firewall...
powershell -NoProfile -Command "Start-Process netsh -ArgumentList 'advfirewall firewall add rule name=\"SimuladorTCA\" dir=in action=allow protocol=TCP localport=3000,8080 profile=any' -Verb RunAs -Wait" >nul 2>&1
echo [OK] Firewall configurado.

:: 6. Iniciar Bridge en segundo plano y abrir Vercel
echo [6/6] Iniciando Bridge en segundo plano...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000, 8080 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }" >nul 2>&1
wscript.exe "%~dp0INICIAR_BRIDGE_SILENCIOSO.vbs"
timeout /t 2 /nobreak >nul
start https://simuladortca.vercel.app/hub.html

echo.
echo =================================================================
echo  INSTALACION COMPLETADA EXITOSAMENTE EN ESTE EQUIPO!
echo  El Bridge ya esta corriendo en segundo plano y se iniciara solo
echo  cada vez que enciendas este PC.
echo =================================================================
pause
