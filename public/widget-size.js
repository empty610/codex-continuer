const clamp = (value, min, max, fallback) => Number.isFinite(Number(value)) ? Math.max(min,Math.min(max,Math.round(Number(value)))) : fallback;

// Keep rapid slider/pointer input ordered; older IPC replies cannot replace a
// newer draft. The main process owns native bounds and durable preferences.
export function mountSizeControls({ document, window, localStorage, bridge, onState, onError, isDragging = () => false }) {
  const $ = selector => document.querySelector(selector);
  let compact = 256, panel = {width:432,height:720}, busy = false, lastState, lastExpanded, drag;
  const pending=new Map();
  const handle = $('#resize-widget');
  function render() {
    document.documentElement.style.setProperty('--compact-size',`${compact}px`);
    $('#compact-size').value=compact; $('#compact-size-value').textContent=`${compact} px`;
    for (const [key,value] of Object.entries(panel)) {
      $(`#panel-${key}`).value=value; $(`#panel-${key}-value`).textContent=`${value} px`;
      if (!bridge) document.documentElement.style.setProperty(`--panel-${key}`,`${value-18}px`);
    }
  }
  function apply(state) {
    if (typeof state.expanded==='boolean') {
      if (typeof lastExpanded==='boolean' && state.expanded!==lastExpanded) {
        end();
        for (const [key,update] of pending) if (update.action==='resize') pending.delete(key);
      }
      lastExpanded=state.expanded;
    }
    lastState=state;
    if (busy) return;
    compact=clamp(state.compactSize,160,420,256);
    panel={width:clamp(state.preferredPanelSize?.width,360,960,432),height:clamp(state.preferredPanelSize?.height,400,1200,720)};
    render();
  }
  async function send(action,value) {
    if (!bridge) {
      try {
        localStorage.setItem('continuer-compact-size',String(compact));
        localStorage.setItem('continuer-panel-size',JSON.stringify(panel));
      } catch (error) { onError(error); }
      return;
    }
    const key=action==='compact-size' || (action==='resize' && !value.expanded) ? 'compact' : 'panel';
    pending.set(key,{action,value});
    if (busy) return;
    busy=true;
    let result;
    try {
      while (pending.size) {
        const [key,next]=pending.entries().next().value; pending.delete(key);
        const observed=lastState;
        try {
          const reply=await bridge.control(next.action,next.value);
          result=lastState!==observed ? lastState : reply;
        }
        catch (error) {
          if (lastState!==observed) result=lastState;
          onError(error);
        }
      }
    } finally {
      busy=false;
      if (result || lastState) onState(result || lastState);
    }
  }
  function changeCompact(value) { compact=clamp(value,160,420,256); render(); return send('compact-size',compact); }
  function changePanel(value) {
    panel={width:clamp(value.width,360,960,432),height:clamp(value.height,400,1200,720)};
    render(); return send('panel-size',{...panel});
  }
  $('#compact-size').addEventListener('input',event => { void changeCompact(event.target.value); });
  for (const key of ['width','height']) $(`#panel-${key}`).addEventListener('input',event => { void changePanel({...panel,[key]:event.target.value}); });
  $('#mini').addEventListener('wheel',event => {
    if (!event.ctrlKey) return;
    event.preventDefault();
    if (!isDragging() && !drag) void changeCompact(compact+(event.deltaY<0?16:-16));
  },{passive:false});
  function resize(expanded,width,height) {
    if (expanded) panel={width:clamp(width,360,960,432),height:clamp(height,400,1200,720)};
    else compact=clamp(width,160,420,256);
    render();
    return send('resize',{expanded,width:expanded?panel.width:compact,height:expanded?panel.height:compact});
  }
  handle.addEventListener('pointerdown',event => {
    if (event.button!==0 || event.isPrimary===false || drag || isDragging() || document.body.classList.contains('is-switching')) return;
    event.preventDefault();
    const expanded=!document.body.classList.contains('collapsed');
    const rect=$('.shell').getBoundingClientRect?.();
    drag={id:event.pointerId,x:event.screenX,y:event.screenY,expanded,
      width:bridge ? window.innerWidth || (expanded?panel.width:compact) : rect?.width+16 || (expanded?panel.width:compact),
      height:bridge ? window.innerHeight || (expanded?panel.height:compact) : rect?.height+16 || (expanded?panel.height:compact)};
    handle.setPointerCapture(event.pointerId);
  });
  function move(event) {
    if (!drag || drag.id!==event.pointerId) return;
    if (drag.expanded===document.body.classList.contains('collapsed')) { end(); return; }
    const dx=event.screenX-drag.x,dy=event.screenY-drag.y;
    if ((!dx && !dy && !drag.lastMove) || drag.lastMove===`${dx},${dy}`) return;
    drag.lastMove=`${dx},${dy}`;
    void resize(drag.expanded,drag.width+(drag.expanded?dx:Math.abs(dx)>=Math.abs(dy)?dx:dy),drag.height+dy);
  }
  function end() {
    if (!drag) return;
    const id=drag.id; drag=null;
    if (handle.hasPointerCapture(id)) handle.releasePointerCapture(id);
  }
  handle.addEventListener('pointermove',move);
  handle.addEventListener('pointerup',event => { if (drag?.id===event.pointerId) { move(event); end(); } });
  handle.addEventListener('pointercancel',end); handle.addEventListener('lostpointercapture',end);
  handle.addEventListener('click',event => event.preventDefault());
  handle.addEventListener('keydown',event => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key) || document.body.classList.contains('is-switching')) return;
    event.preventDefault();
    const expanded=!document.body.classList.contains('collapsed'),dx=event.key==='ArrowLeft'?-8:event.key==='ArrowRight'?8:0,dy=event.key==='ArrowUp'?-8:event.key==='ArrowDown'?8:0;
    void resize(expanded,expanded?panel.width+dx:compact+(dx||-dy),panel.height+dy);
  });
  window.addEventListener('blur',end); window.addEventListener('pagehide',end);
  if (!bridge) {
    try {
      compact=clamp(Number(localStorage.getItem('continuer-compact-size'))||256,160,420,256);
      const saved=JSON.parse(localStorage.getItem('continuer-panel-size')||'null');
      panel={width:clamp(saved?.width,360,960,432),height:clamp(saved?.height,400,1200,720)};
    } catch { /* Invalid browser preferences use defaults. */ }
  }
  render();
  return {apply};
}
