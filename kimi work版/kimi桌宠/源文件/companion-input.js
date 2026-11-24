function createCompanionInput({ onHold, onTap }) {
  const HOLD_MS = 220;
  const DRAG_PX = 6;
  let contact = null;
  let recent = null;
  let lateSource = null;

  function near(first, second) {
    return Number.isFinite(first.clientX) && Number.isFinite(first.clientY) &&
      Number.isFinite(second.clientX) && Number.isFinite(second.clientY) &&
      Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY) <= DRAG_PX;
  }

  function hold() {
    if (!contact || contact.held) return;
    contact.held = true;
    clearTimeout(contact.timer);
    onHold(true);
  }

  function down(source, point) {
    if (contact) {
      if (!contact.origins.has(source)) contact.origins.set(source, point);
      return;
    }
    // Host delivery can lag an entire short DOM contact.
    if (recent?.pointer && !recent.sources.has(source) &&
        performance.now() - recent.at < 75 && near(recent.point, point)) {
      recent.sources.add(source);
      lateSource = source;
      return;
    }
    if (lateSource === source) lateSource = null;
    contact = { origins: new Map([[source, point]]), point, held: false,
      at: performance.now(), timer: setTimeout(hold, HOLD_MS) };
  }

  function move(source, point) {
    if (!contact || contact.held || source === lateSource) return;
    const origin = contact.origins.get(source);
    const start = origin ?? contact.point;
    const useScreen = origin && [point.screenX, point.screenY, start.screenX, start.screenY].every(Number.isFinite);
    const x = useScreen ? point.screenX - start.screenX : point.clientX - start.clientX;
    const y = useScreen ? point.screenY - start.screenY : point.clientY - start.clientY;
    if (Math.hypot(x, y) >= DRAG_PX) hold();
  }

  function end(source, point, hit) {
    if (source === lateSource) {
      lateSource = null;
      return;
    }
    if (!contact) return;
    if (point) move(source, point);
    if (performance.now() - contact.at >= HOLD_MS) hold();
    const last = contact;
    contact = null;
    clearTimeout(last.timer);
    const sources = new Set([...last.origins.keys(), source]);
    const needClick = !last.held && point &&
      (!Number.isFinite(point.clientX) || !Number.isFinite(point.clientY));
    recent = { at: performance.now(), point: needClick ? last.point : point || last.point,
      pointer: true, sources, needClick };
    if (last.held) onHold(false);
    else if (hit) onTap(point);
  }

  function click(source, point) {
    if (lateSource === source) return;
    if (contact) {
      end(source, point, true);
      return;
    }
    if (recent?.needClick && performance.now() - recent.at < 240 && near(recent.point, point)) {
      recent.needClick = false;
      onTap(point);
      return;
    }
    if (recent && performance.now() - recent.at < 240 &&
        (recent.pointer || (!recent.sources.has(source) && near(recent.point, point)))) return;
    recent = { at: performance.now(), point, pointer: false, sources: new Set([source]) };
    onTap(point);
  }

  return { down, move, end, click, cancel: () => end("cancel", null, false) };
}
