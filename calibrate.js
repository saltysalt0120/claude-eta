// Calibration: learn the bias of Claude's self-estimates from history.
// Pure functions over an array of records; no DOM here.

window.CLAUDE_ETA_CAL = (() => {
  const STORAGE_KEY = 'claudeEtaHistory';
  const MAX_RECORDS = 2000;
  const MIN_SAMPLES = 5;
  const WINDOW = 200;

  function quantile(sorted, q) {
    if (!sorted.length) return NaN;
    const pos = (sorted.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
  }

  // After the extension is reloaded, scripts in already-open tabs lose their
  // storage access ("Extension context invalidated"). Fail soft.
  async function load() {
    try {
      const o = await chrome.storage.local.get(STORAGE_KEY);
      return Array.isArray(o[STORAGE_KEY]) ? o[STORAGE_KEY] : [];
    } catch (_) {
      return [];
    }
  }

  async function save(records) {
    const trimmed = records.slice(-MAX_RECORDS);
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: trimmed });
    } catch (_) {}
  }

  async function append(rec) {
    const all = await load();
    all.push(rec);
    await save(all);
  }

  // Ratios actual/estimate for the most specific bucket that has enough samples.
  // Returns { ratios (sorted), n, level } where level ∈ 'model+cat' | 'model' | 'all' | 'none'.
  function ratiosFor(records, model, category) {
    const usable = records.filter(
      (r) => !r.aborted && r.estMid > 0 && r.actualSec > 0
    );
    const tiers = [
      ['model+cat', (r) => r.model === model && r.category === category],
      ['model', (r) => r.model === model],
      ['all', () => true],
    ];
    for (const [level, pred] of tiers) {
      const rs = usable.filter(pred).slice(-WINDOW).map((r) => r.actualSec / r.estMid);
      if (rs.length >= MIN_SAMPLES) {
        return { ratios: rs.sort((a, b) => a - b), n: rs.length, level };
      }
    }
    return { ratios: [], n: 0, level: 'none' };
  }

  // Given the parsed estimate and the elapsed seconds so far, return the
  // current target seconds plus which quantile we are on.
  // Quantile walk: p50 → p75 → p90 → p98 as elapsed overtakes each target.
  function target(estMid, elapsedSec, ratios) {
    if (!ratios.length) return { sec: estMid, q: null, confident: false };
    const steps = [0.5, 0.75, 0.9, 0.98];
    let sec = estMid * quantile(ratios, 0.5);
    let q = 0.5;
    for (const s of steps) {
      const t = estMid * quantile(ratios, s);
      sec = t;
      q = s;
      if (elapsedSec < t) break;
    }
    return { sec, q, confident: true };
  }

  async function exportJson() {
    const all = await load();
    return JSON.stringify(all, null, 0);
  }

  async function importJson(text) {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('not an array');
    const all = await load();
    const seen = new Set(all.map((r) => r.ts));
    for (const r of parsed) if (r && typeof r.ts === 'number' && !seen.has(r.ts)) all.push(r);
    all.sort((a, b) => a.ts - b.ts);
    await save(all);
    return all.length;
  }

  return { load, append, ratiosFor, target, quantile, exportJson, importJson, MIN_SAMPLES };
})();
