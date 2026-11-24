const { app, BrowserWindow, ipcMain, Menu, screen } = require('electron');
const { execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { createSessionMonitor } = require('./session-monitor.cjs');
const { readQuota } = require('./quota.cjs');
if (process.env.KIMI_PET_SMOKE === '1') app.setPath('userData', path.join(__dirname, '.smoke-profile'));
let win, drag = null, host = null, hostTimer, ownerTargetHandle = null, petMenu = null;
const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const readSessionMonitor = createSessionMonitor(process.env.KIMI_CODE_SESSIONS_DIR || undefined);
function runScript(name, args = []) {
  return new Promise((resolve) => execFile(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'scripts', name), ...args], { timeout: 5000, windowsHide: true }, (error, stdout) => {
    if (error) return resolve(null);
    try { resolve(JSON.parse(stdout.trim())); } catch { resolve(null); }
  }));
}
async function trackHost() {
  if (!win || win.isDestroyed()) return;
  host = await runScript('get-host-window.ps1');
  if (host) {
    const current = win.getBounds();
    const width = 420, height = 620;
    const x = Math.round(host.x + host.width - width - 24);
    const y = Math.round(host.y + host.height - height - 70);
    if (!drag && (Math.abs(current.x - x) > 2 || Math.abs(current.y - y) > 2)) win.setBounds({ x, y, width, height });
    win.setVisibleOnAllWorkspaces(false);
    if (!win.isVisible() && !win.isMinimized()) win.showInactive();
    const handle = win.getNativeWindowHandle();
    const selfHandle = handle.readUInt32LE(0).toString();
    const ownerKey = `${selfHandle}:${host.handle}`;
    if (ownerTargetHandle !== ownerKey) {
      const result = await runScript('set-window-owner.ps1', [selfHandle, host.handle.toString()]);
      if (result) ownerTargetHandle = ownerKey;
    }
  }
}

function syncCoding(webContents) {
  let timer, stopped = false, running = null;

  async function update() {
    try {
      const snapshot = await readSessionMonitor();
      if (stopped || webContents.isDestroyed()) return;
      const { coding, session } = snapshot;
      if (coding?.status === 'working') {
        if (!running) webContents.send('coding:state', 'working');
        running = { sessionId: session.id, workspace: session.workspace, turnId: coding.turnId };
      } else if (running) {
        const sameTurn = session?.id === running.sessionId && session?.workspace === running.workspace &&
          coding?.turnId === running.turnId;
        const outcome = sameTurn ? coding.status : 'cancelled';
        webContents.send('coding:state', outcome === 'completed' ? 'idle' : outcome);
        running = null;
      }
    } catch {
      // A temporary file sharing error should not interrupt the animation.
    } finally {
      if (!stopped && !webContents.isDestroyed()) timer = setTimeout(update, 800);
    }
  }

  void update();
  return () => { stopped = true; clearTimeout(timer); };
}

function createWindow() {
  win = new BrowserWindow({ width: 420, height: 620, frame: false, transparent: true, resizable: false, hasShadow: false, skipTaskbar: true, show: false, alwaysOnTop: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true } });
  let stopCoding;
  const webContents = win.webContents;
  webContents.on('context-menu', () => {
    petMenu?.closePopup();
    petMenu = Menu.buildFromTemplate([{ label: '退出桌宠', click: () => app.quit() }]);
    petMenu.popup({ window: win });
  });
  webContents.on('did-finish-load', () => {
    stopCoding?.();
    stopCoding = syncCoding(webContents);
  });
  win.loadFile('index.html');
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 2) console.error('[renderer]', message); });
  if (process.env.KIMI_PET_SMOKE === '1') {
    win.webContents.once('did-finish-load', () => setTimeout(async () => {
      const state = await win.webContents.executeJavaScript(`(async () => {
        document.getElementById('launcher').click();
        const panelOpened = !document.getElementById('panel').hidden;
        const monitor = await window.desktopPet.monitor();
        const quota = await window.desktopPet.quota();
        await new Promise(resolve => setTimeout(resolve, 100));
        document.getElementById('panel').scrollTop = document.getElementById('panel').scrollHeight;
        return { ...window.KimiCompanion?.getState(), panelOpened, monitor, quota };
      })()`);
      const image = await win.webContents.capturePage();
      const output = path.join(__dirname, 'smoke.png');
      fs.writeFileSync(output, image.toPNG());
      Object.assign(state, await win.webContents.executeJavaScript(`(() => {
        document.getElementById('tab-settings').click();
        const settingsOpened = !document.getElementById('settings').hidden;
        document.getElementById('close').click();
        return { settingsOpened, panelClosed: document.getElementById('panel').hidden };
      })()`));
      webContents.sendInputEvent({ type: 'mouseDown', button: 'right', x: 160, y: 480 });
      webContents.sendInputEvent({ type: 'mouseUp', button: 'right', x: 160, y: 480 });
      await new Promise(resolve => setTimeout(resolve, 200));
      state.contextMenuShown = Boolean(petMenu);
      console.log(JSON.stringify({ smoke: state.ready && state.panelOpened && state.settingsOpened && state.panelClosed && state.contextMenuShown ? 'passed' : 'failed', output, state }));
      if (!state.ready || !state.panelOpened || !state.settingsOpened || !state.panelClosed || !state.contextMenuShown) app.exitCode = 1;
      if (petMenu?.items[0]?.click) petMenu.items[0].click();
      else app.quit();
    }, 2500));
  }
  win.once('ready-to-show', () => { win.showInactive(); trackHost(); hostTimer = setInterval(trackHost, 1000); });
  win.on('closed', () => { stopCoding?.(); clearInterval(hostTimer); win = null; });
}
ipcMain.on('mouse:ignore', (event, ignore) => { const target = BrowserWindow.fromWebContents(event.sender); target?.setIgnoreMouseEvents(Boolean(ignore), { forward: true }); });
ipcMain.on('drag:start', (event, point) => { const bounds = win.getBounds(); drag = { x: bounds.x, y: bounds.y, px: point.x, py: point.y }; });
ipcMain.on('drag:move', (event, point) => { if (drag && win) win.setPosition(Math.round(drag.x + point.x - drag.px), Math.round(drag.y + point.y - drag.py)); });
ipcMain.on('drag:end', () => { drag = null; });
ipcMain.on('app:close', () => app.quit());
ipcMain.handle('host:get', () => host ? { title: host.title } : null);
ipcMain.handle('monitor:get', async () => {
  try { return await readSessionMonitor(); }
  catch { return { ok: false, message: '会话日志暂时读取失败' }; }
});
ipcMain.handle('quota:get', () => readQuota());
const singleInstance = process.env.KIMI_PET_SMOKE === '1' || app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
else {
  app.on('second-instance', () => {
    if (!win || win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.showInactive();
  });
  app.whenReady().then(createWindow);
}
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => clearInterval(hostTimer));
