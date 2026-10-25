function place(anchor, workArea, size, offset = { right: 16, bottom: 16 }) {
  const width = Math.min(size.width, workArea.width);
  const height = Math.min(size.height, workArea.height);
  return {
    x: Math.round(Math.max(workArea.x, Math.min(anchor.x + anchor.width - width - offset.right, workArea.x + workArea.width - width))),
    y: Math.round(Math.max(workArea.y, Math.min(anchor.y + anchor.height - height - offset.bottom, workArea.y + workArea.height - height))),
    width, height,
  };
}
function offsetFrom(anchor, bounds) {
  return { right: anchor.x + anchor.width - bounds.x - bounds.width, bottom: anchor.y + anchor.height - bounds.y - bounds.height };
}
function placeIndependent(saved, current, workArea, size) {
  // Preserve a saved top-left exactly. Fractional DPI may report 161 for a
  // requested 160 DIP width; that rounding must never become an x/y offset.
  const x = saved?.x ?? (Math.abs(current.width-size.width)<=1 ? current.x : current.x+current.width-size.width);
  const y = saved?.y ?? (Math.abs(current.height-size.height)<=1 ? current.y : current.y+current.height-size.height);
  return place({ x, y, ...size },workArea,size,{ right: 0, bottom: 0 });
}
function compactSize(value) { return Number.isFinite(value) ? Math.min(420,Math.max(160,Math.round(value))) : 256; }
function samePlacementContext(a,b) {
  return !!a && a.mode===b.mode && a.follow===b.follow && a.compactSize===b.compactSize &&
    (!a.follow || ['x','y','width','height'].every(key=>a.anchor?.[key]===b.anchor?.[key]));
}
function restoreModePosition(fallback,saved,workArea) {
  if (!saved) return fallback;
  const {x,y}=saved, {width,height}=fallback;
  // Restore a deliberately parked position, including partly outside the work
  // area, as long as its display is still present.
  return x+width>workArea.x && y+height>workArea.y && x<workArea.x+workArea.width && y<workArea.y+workArea.height
    ? {...fallback,x,y} : fallback;
}
const sizes = { compact: { width: 256, height: 256 }, expanded: { width: 432, height: 720 } };
module.exports = { place, placeIndependent, offsetFrom, sizes, compactSize, samePlacementContext, restoreModePosition };
