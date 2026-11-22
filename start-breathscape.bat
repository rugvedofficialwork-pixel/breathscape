@echo off
cd /d "%~dp0"
if not exist node_modules (
  echo Installing, this happens once...
  call npm install
)
start "" http://localhost:5180
call npm run dev
