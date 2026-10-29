@echo off
title INICIADOR SIMULADOR MULTI-DISPOSITIVO - RECAUDO BOGOTA
setlocal enabledelayedexpansion

echo =======================================================
echo    SIMULADOR TCA MULTI-DISPOSITIVO (3 LECTORES ACR1251)
echo    Propiedad Intelectual de Wilson Varela Munoz
echo =======================================================
echo.

:: Limpiar y forzar apertura de los puertos 3000 y 8080 en el firewall (requiere permisos)
echo [1/3] Configurando Firewall de Windows...
powershell -Command "Start-Process netsh -ArgumentList 'advfirewall firewall delete rule name=\"SimuladorTCA\"' -Verb RunAs -Wait" >nul 2>&1
powershell -Command "Start-Process netsh -ArgumentList 'advfirewall firewall add rule name=\"SimuladorTCA\" dir=in action=allow protocol=TCP localport=3000,8080 profile=any' -Verb RunAs -Wait" >nul 2>&1
echo [OK] Reglas de Firewall aplicadas.

:: Detectar IP local automáticamente usando PowerShell (Filtrando APIPA 169.254 y virtuales)
echo [2/3] Detectando direccion IP local de red...
for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notlike '*Loopback*' -and $_.InterfaceAlias -notlike '*Virtual*' -and $_.InterfaceAlias -notlike '*VMware*' -and $_.IPAddress -notlike '169.254.*' } | Select-Object -ExpandProperty IPAddress -First 1)"`) do (
    set MY_IP=%%i
)

if "!MY_IP!"=="" (
    set MY_IP=localhost
)
echo [OK] IP de red detectada: !MY_IP!

echo.
echo [3/3] Abriendo Central de Dispositivos (Hub)...
echo URL Hub:        http://!MY_IP!:3000/hub.html
echo Dispositivo 68: http://!MY_IP!:3000/?device=0068 (Lector RR234-016879)
echo Dispositivo 69: http://!MY_IP!:3000/?device=0069 (Lector RR234-016991)
echo Dispositivo 71: http://!MY_IP!:3000/?device=0071 (Lector RR234-017108)
echo.

:: Abrir el Hub Central
start http://!MY_IP!:3000/hub.html

:: Iniciar el bridge (el servidor web ya está integrado en bridge.js)
npm run start:bridge

pause
