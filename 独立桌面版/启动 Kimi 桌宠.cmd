@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
set "ELECTRON_RUN_AS_NODE="
if not exist "node_modules\electron\dist\electron.exe" (
  echo 首次运行，正在安装桌宠依赖...
  call npm install
  if errorlevel 1 (
    echo 依赖安装失败，请检查 Node.js 和 npm 后重试。
    pause
    exit /b 1
  )
)
if not exist "node_modules\electron\dist\electron.exe" (
  echo 未找到 Electron，请重新安装桌宠依赖。
  pause
  exit /b 1
)
start "Kimi 桌面伙伴" /D "%~dp0" "node_modules\electron\dist\electron.exe" "."
endlocal
exit /b 0
