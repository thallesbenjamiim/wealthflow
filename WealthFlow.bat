@echo off
cd /d "%~dp0"

rem Se o proxy ja estiver rodando na porta 3001, nao inicia outro
netstat -ano | findstr /r /c:":3001 .*LISTENING" >nul
if errorlevel 1 (
  start "WealthFlow Proxy" /min cmd /k node server.js
  rem Espera o servidor subir antes de abrir o app
  timeout /t 2 /nobreak >nul
)

rem Abre o app no Chrome (ou no navegador padrao, se o Chrome nao for encontrado)
if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
  start "" "C:\Program Files\Google\Chrome\Application\chrome.exe" "%~dp0index.html"
) else (
  start "" "%~dp0index.html"
)
