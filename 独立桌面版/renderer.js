(() => {
  const canvas = document.getElementById('pet');
  const panel = document.getElementById('panel');
  const api = window.desktopPet;
  const settings = Object.assign({ animation: true, rotation: true, scale: 100 }, JSON.parse(localStorage.getItem('kimi-desktop-pet.settings.v1') || '{}'));
  const handle = window.DaimonPetThree.mount(canvas);
  api.onCodingState(state => {
    handle.setState(state);
    document.getElementById('host-state').textContent = state === 'working' ? 'Coding 进行中' : '独立桌面运行';
  });
  let pointer = null, dragStarted = false, monitorTimer = null, quotaTimer = null;
  const save = () => localStorage.setItem('kimi-desktop-pet.settings.v1', JSON.stringify(settings));
  function setPanel(open) {
    panel.hidden = !open;
    document.getElementById('launcher').hidden = open;
    clearInterval(monitorTimer); clearInterval(quotaTimer);
    monitorTimer = null; quotaTimer = null;
    if (open) {
      void refreshMonitor(); void refreshQuota();
      monitorTimer = setInterval(refreshMonitor, 5000);
      quotaTimer = setInterval(refreshQuota, 300000);
    }
  }
  function applyScale() { const value = Number(settings.scale); document.getElementById('scale').value = value; document.getElementById('scale-value').textContent = `${value}%`; canvas.style.transform = `translateX(-50%) scale(${value / 100})`; }
  document.getElementById('launcher').onclick = () => setPanel(true);
  document.getElementById('close').onclick = () => setPanel(false);
  function tab(name) { const monitor = name === 'monitor'; document.getElementById('monitor').hidden = !monitor; document.getElementById('settings').hidden = monitor; document.getElementById('tab-monitor').setAttribute('aria-selected', monitor); document.getElementById('tab-settings').setAttribute('aria-selected', !monitor); }
  document.getElementById('tab-monitor').onclick = () => tab('monitor'); document.getElementById('tab-settings').onclick = () => tab('settings');
  for (const key of ['animation', 'rotation']) { const input = document.getElementById(key); input.checked = settings[key]; input.onchange = () => { settings[key] = input.checked; save(); window.KimiCompanion[key === 'animation' ? 'setEnabled' : 'setRotation'](input.checked); }; }
  window.KimiCompanion.setEnabled(settings.animation); window.KimiCompanion.setRotation(settings.rotation); applyScale();
  document.getElementById('scale').oninput = event => { settings.scale = Number(event.target.value); applyScale(); save(); };
  document.querySelectorAll('[data-scene]').forEach(button => button.onclick = () => { void window.KimiCompanion.preview(button.dataset.scene); setPanel(false); });
  document.getElementById('piano').onclick = () => { void window.KimiCompanion.previewPiano(); setPanel(false); };
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !handle.hitTest(event.clientX, event.clientY)) return;
    canvas.setPointerCapture(event.pointerId); api.ignoreMouse(false);
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now(), hold: false };
    dragStarted = false;
    pointer.timer = setTimeout(() => { if (pointer && !dragStarted) { pointer.hold = true; handle.setHeld(true); } }, 220);
  });
  canvas.addEventListener('pointermove', event => {
    const hit = handle.hitTest(event.clientX, event.clientY);
    if (!pointer) api.ignoreMouse(!hit);
    if (!pointer || event.pointerId !== pointer.id) return;
    const distance = Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y);
    if (distance >= 6 && !dragStarted) {
      clearTimeout(pointer.timer); dragStarted = true; pointer.hold = true; handle.setHeld(true); handle.setDragging(true);
      api.dragStart({ x: event.screenX, y: event.screenY });
    }
    if (dragStarted) api.dragMove({ x: event.screenX, y: event.screenY });
  });
  function release(event, cancelled = false) {
    if (!pointer || event.pointerId !== pointer.id) return;
    clearTimeout(pointer.timer); const wasDrag = dragStarted, wasHold = pointer.hold; pointer = null; dragStarted = false;
    handle.setDragging(false); if (wasHold) handle.setHeld(false);
    if (wasDrag) api.dragEnd();
    if (!cancelled && !wasDrag && !wasHold && performance.now() - event.timeStamp < 1500) handle.noteTap();
  }
  canvas.addEventListener('pointerup', event => release(event)); canvas.addEventListener('pointercancel', event => release(event, true));
  panel.addEventListener('pointermove', () => api.ignoreMouse(false)); document.getElementById('launcher').addEventListener('pointermove', () => api.ignoreMouse(false));
  async function refreshMonitor() {
    const result = await api.monitor();
    const fields = ['context-tokens', 'turn-steps', 'compactions', 'token-speed', 'cache-hit-rate', 'loaded-skills', 'tool-calls'];
    if (!result.ok) {
      for (const id of fields) document.getElementById(id).textContent = result.message;
      document.getElementById('session-name').textContent = result.message;
      return;
    }
    const number = new Intl.NumberFormat('zh-CN');
    document.getElementById('context-tokens').textContent = Number.isFinite(result.contextTokens) ? `${number.format(result.contextTokens)} Token` : '暂未采集';
    document.getElementById('turn-steps').textContent = `${number.format(result.turns)} / ${number.format(result.steps)}`;
    document.getElementById('compactions').textContent = number.format(result.compactions);
    const speed = document.getElementById('token-speed');
    speed.textContent = Number.isFinite(result.tokensPerSecond) ? `${result.tokensPerSecond.toFixed(1)} Token/s` : '暂未采集';
    speed.title = `最近 ${result.speedSamples} 次模型调用`;
    const cache = document.getElementById('cache-hit-rate');
    cache.textContent = Number.isFinite(result.cacheHitPercent) ? `${result.cacheHitPercent.toFixed(1)}%` : '暂未采集';
    cache.title = `最近 ${result.cacheSamples} 次调用 · ${number.format(result.cacheHitTokens)} / ${number.format(result.cacheInputTokens)} Token`;
    const skills = document.getElementById('loaded-skills');
    skills.textContent = result.loadedSkills.length ? `${result.loadedSkills.length} 个 · ${result.loadedSkills.join('、')}` : '0 个';
    skills.title = result.loadedSkills.length ? result.loadedSkills.join('\n') : '当前会话尚未加载技能';
    const tools = document.getElementById('tool-calls');
    tools.textContent = `${number.format(result.turnToolCalls)} / ${number.format(result.totalToolCalls)}${result.activeTools.length ? ` · ${result.activeTools.join('、')}` : ''}`;
    tools.title = `当前轮次 / 会话总计${result.activeTools.length ? ` · 执行中：${result.activeTools.join('、')}` : ' · 当前无执行中工具'}`;
    document.getElementById('session-name').textContent = `${result.session.id} · ${result.session.agent}`;
    if (result.asOf) document.getElementById('monitor-updated').textContent = `会话数据更新于 ${new Date(result.asOf).toLocaleString('zh-CN')}`;
  }
  async function refreshQuota() {
    const box = document.getElementById('quota'); box.textContent = '正在读取…';
    const updated = document.getElementById('updated'); updated.textContent = '';
    const result = await api.quota();
    if (!result.ok) { box.textContent = result.message; return; }
    box.replaceChildren();
    for (const [key, label] of [['limit_5h', '5 小时'], ['limit_7d', '7 天'], ['limit_month_total', '月度总额'], ['limit_month_code', '月度 Coding']]) {
      const item = result.windows[key]; if (!item) continue;
      const row = document.createElement('div'); row.className = 'quota-row';
      if (item.resetTime) row.title = `重置于 ${new Date(item.resetTime).toLocaleString('zh-CN')}`;
      const name = document.createElement('label'); name.textContent = label;
      const value = document.createElement('b'); value.textContent = `${item.remainingPercent.toFixed(1)}%`;
      const track = document.createElement('div'); track.className = 'track'; track.setAttribute('role', 'progressbar'); track.setAttribute('aria-valuenow', item.remainingPercent); track.setAttribute('aria-valuemax', 100);
      const fill = document.createElement('i'); fill.style.width = `${item.remainingPercent}%`; track.append(fill); row.append(name, value, track); box.append(row);
    }
    const source = { 'kimi-code': 'Kimi Code 登录', 'api-key': '官方 API', demo: '演示数据' }[result.source];
    updated.textContent = `${source} · 更新于 ${new Date(result.asOf).toLocaleString('zh-CN')}`;
  }
  document.getElementById('refresh').onclick = () => { void refreshMonitor(); void refreshQuota(); };
  async function refreshHost() { const host = await api.host(); document.getElementById('host-name').textContent = host ? `附着于 ${host.title}` : '未发现 Kimi／Kimi Code 主窗口'; }
  void refreshHost(); setInterval(refreshHost, 2000);
})();
