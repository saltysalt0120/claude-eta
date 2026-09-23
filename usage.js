// Quota usage: reads claude.ai's own (undocumented) usage endpoint with the
// session cookies the page already has. Same approach as the existing usage
// trackers. Will break if Anthropic changes the endpoint; fails soft.
//
// GET /api/organizations/<lastActiveOrg cookie>/usage
//   { five_hour: { utilization: 43, resets_at: "2026-09-23T23:10:00Z" },
//     seven_day: { utilization: 21, resets_at: "2026-09-25T18:00:00Z" }, ... }

window.CLAUDE_ETA_USAGE = (() => {
  const REFRESH_MS = 5 * 60 * 1000;
  let last = null; // { fetchedAt, fiveHour: {pct, resetsAt}, sevenDay: {...} }
  let timer = null;
  let onUpdate = () => {};

  function orgId() {
    const m = document.cookie.match(/(?:^|;\s*)lastActiveOrg=([^;]*)/);
    return m ? decodeURIComponent(m[1]) : null;
  }

  function pick(o) {
    if (!o || typeof o.utilization !== 'number') return null;
    return { pct: o.utilization, resetsAt: o.resets_at ? Date.parse(o.resets_at) : null };
  }

  async function refresh() {
    const org = orgId();
    if (!org) return null;
    try {
      const r = await fetch(`/api/organizations/${org}/usage`, {
        headers: { Accept: 'application/json' },
        credentials: 'include',
      });
      if (!r.ok) return null;
      const j = await r.json();
      last = {
        fetchedAt: Date.now(),
        fiveHour: pick(j.five_hour),
        sevenDay: pick(j.seven_day),
      };
      onUpdate(last);
      return last;
    } catch (_) {
      return null;
    }
  }

  function start(cb) {
    onUpdate = cb || onUpdate;
    refresh();
    if (!timer) timer = setInterval(refresh, REFRESH_MS);
  }

  // "2h 05m" / "45m" / "Fri 13:00" for resets further than a day out.
  function untilText(ts) {
    if (!ts) return '';
    const ms = ts - Date.now();
    if (ms <= 0) return 'now';
    const m = Math.round(ms / 60000);
    if (m < 60) return `${m}m`;
    if (m < 24 * 60) return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
    const d = new Date(ts);
    const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
    return `${day} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  return { start, refresh, untilText, get last() { return last; } };
})();
