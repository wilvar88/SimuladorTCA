@echo off
title INICIADOR SIMULADOR MULTI-DISPOSITIVO - RECAUDO BOGOTA
setlocal enabledelayedexpansion

echo =======================================================
echo    SIMULADOR TCA MULTI-DISPOSITIVO (3 LECTORES ACR1251)
echo    Propiedad Intelectual de Wilson Varela Munoz
echo =======================================================
echo.

:: Asegurar que el servicio de Tarjeta Inteligente de Windows (SCardSvr) este activo
echo [1/4] Verificando servicio de Tarjetas Inteligentes (PC/SC)...
powershell -NoProfile -Command "Set-Service -Name SCardSvr -StartupType Automatic -ErrorAction SilentlyContinue; Start-Service -Name SCardSvr -ErrorAction SilentlyContinue" >nul 2>&1
echo [OK] Servicio SCardSvr activo.

:: Configurar Firewall de Windows
echo [2/4] Configurando Firewall de Windows...
powershell -NoProfile -Command "Start-Process netsh -ArgumentList 'advfirewall firewall add rule name=\"SimuladorTCA\" dir=in action=allow protocol=TCP localport=3000,8080 profile=any' -Verb RunAs -Wait" >nul 2>&1
echo [OK] Reglas de Firewall verificadas.

:: Reiniciar Bridge en segundo plano (no se cierra al cerrar esta ventana)
echo [3/4] Iniciando Bridge de Hardware en segundo plano...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000, 8080 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }" >nul 2>&1
timeout /t 1 /nobreak >nul
wscript.exe "%~dp0INICIAR_BRIDGE_SILENCIOSO.vbs"
timeout /t 2 /nobreak >nul

echo [4/4] Abriendo Central de Dispositivos (Hub)...
start https://simuladortca.vercel.app/hub.html

echo.
echo =======================================================
echo  BRIDGE ACTIVO EN SEGUNDO PLANO (PUERTOS 3000 Y 8080)
echo  Puedes cerrar esta ventana con tranquilidad.
echo =======================================================
timeout /t 4
