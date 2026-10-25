// Read the cursor and move the window in the same desktop DIP coordinate space.
const DRAG_INTERVAL_MS = 1;
function createPointerDrag({ getCursor, getBounds, setPosition, onMove = () => {}, onFinish = () => {}, schedule = (callback,interval) => setInterval(callback,interval), cancel = clearInterval }) {
  let active, timer, lastResult;
  function move() {
    if (!active) return;
    const cursor = getCursor();
    const dx = cursor.x - active.cursor.x, dy = cursor.y - active.cursor.y;
    if (!active.moved && Math.hypot(dx, dy) <= 6) return;
    if (!active.moved) { active.moved = true; onMove(); }
    const x = Math.round(active.bounds.x + dx), y = Math.round(active.bounds.y + dy);
    // Compare requested positions, not DPI-rounded native readback. This also
    // avoids a synchronous OS query on every sample and duplicate moves at rest.
    if (active.lastX !== x || active.lastY !== y) {
      setPosition(x, y, active.bounds);
      active.lastX=x; active.lastY=y;
    }
  }
  function finish(id = active?.id) {
    if (!active || active.id !== id) return lastResult?.id === id ? lastResult : { id, moved: false };
    // Release freezes the last displayed position. The cursor
    // may already have moved again by the time pointerup's IPC reaches us.
    cancel(timer); timer = null;
    lastResult = { id: active.id, moved: active.moved };
    active = null;
    onFinish(lastResult.moved);
    return lastResult;
  }
  return {
    get active() { return !!active; },
    start(id) {
      if (active) return { ok: false };
      const cursor=getCursor(),bounds=getBounds();
      active = { id, cursor, bounds, lastX:bounds.x, lastY:bounds.y, moved: false };
      lastResult = null;
      timer = schedule(move,DRAG_INTERVAL_MS);
      return { ok: true };
    },
    finish,
  };
}
module.exports = { createPointerDrag };
