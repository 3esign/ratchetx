function anchorFreshness({ anchor, head, nowMs = Date.now() } = {}) {
  if (!anchor) return { status:'grey', ageSec:null, headDistance:null, latest:null };
  const ageSec = Number.isFinite(+anchor.t)
    ? Math.max(0, Math.floor((nowMs - +anchor.t) / 1000)) : null;
  const headIndex = head ? Number(head.i) : NaN;
  const anchorIndex = Number(anchor.i);
  const headDistance = Number.isFinite(headIndex) && Number.isFinite(anchorIndex)
    ? Math.max(0, headIndex - anchorIndex) : null;
  const red = (ageSec != null && ageSec > 72 * 3600)
    || (headDistance != null && headDistance > 2000);
  const green = !red
    && (ageSec == null || ageSec <= 24 * 3600)
    && (headDistance == null || headDistance <= 500);
  return { status:green ? 'green' : red ? 'red' : 'grey',
    ageSec, headDistance, latest:anchor };
}

module.exports = { anchorFreshness };
