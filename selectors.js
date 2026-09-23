// Everything that touches the claude.ai DOM lives here.
// When the panel stops updating after a frontend change, fix this file only.
//
// Each selector is a list of candidates tried in order. Keep the old ones;
// add the new one at the front.
//
// Verified against claude.ai on 2026-09-23:
//   [data-testid="assistant-message"][data-is-streaming="true|false"]
//   [data-testid="TurnStatus"][data-step-key="thinking-N"|absent][data-state="busy|done"]
//   button[data-testid="model-selector-dropdown"]  (aria-label="Model: <name>")

window.CLAUDE_ETA_SELECTORS = {
  // A reply is in progress while any of these matches.
  streaming: [
    '[data-testid="assistant-message"][data-is-streaming="true"]',
    '[data-testid="TurnStatus"][data-state="busy"]',
    'button[aria-label="Stop response"]',
    'button[aria-label*="Stop" i]',
  ],

  // The model picker in the composer. Its text is the model name.
  modelPicker: [
    'button[data-testid="model-selector-dropdown"]',
    'button[aria-label^="Model:"]',
    'button[aria-haspopup="menu"][aria-label*="model" i]',
  ],

  // Assistant message containers, newest last.
  assistantMessage: [
    '[data-testid="assistant-message"]',
    'div[data-is-streaming]',
    '.font-claude-message',
  ],

  // Step blocks inside an assistant message (the "thinking / doing X" rows).
  // Thinking rows carry data-step-key="thinking-N"; tool rows carry no key.
  step: [
    '[data-testid="TurnStatus"]',
    'div[data-cds="TurnStatus"]',
  ],
  stepIsThinking: (el) => /^thinking-/.test(el.getAttribute('data-step-key') || ''),
};

// Estimate line, parsed from the first ~300 chars of the streaming reply.
//   ⏱ 預估 3–6 分 · 約 5 步 · 搜尋+檔案
//   ⏱ ETA 3–6 min · ~5 steps · search+files
//   ⏱ 預估 40 秒 · 翻譯
window.CLAUDE_ETA_PARSE = function parseEstimateLine(text) {
  if (!text) return null;
  // Status rows and other blocks are concatenated before the reply text with
  // no newlines, so locate the marker directly and parse a short window after it.
  const idx = text.indexOf('⏱');
  if (idx < 0) return null;
  let line = text.slice(idx, idx + 160);
  const nl = line.indexOf('\n');
  if (nl > 0) line = line.slice(0, nl);

  const range = line.match(/(\d+(?:\.\d+)?)\s*(?:[–\-~到]\s*(\d+(?:\.\d+)?))?\s*(分鐘|分|min|秒|sec|s)(?![a-z])/i);
  if (!range) return null;
  let lo = parseFloat(range[1]);
  let hi = range[2] ? parseFloat(range[2]) : lo;
  const unit = range[3].toLowerCase();
  const toSec = unit.startsWith('分') || unit.startsWith('min') ? 60 : 1;
  lo *= toSec;
  hi *= toSec;

  const steps = line.match(/(?:約|~|about)\s*(\d+)\s*(?:步|steps?)/i);

  // Category: the last "·"-separated segment that is not the range or the steps.
  const segs = line.split(/[·|]/).map((s) => s.trim()).filter(Boolean);
  let category = null;
  for (let i = segs.length - 1; i >= 0; i--) {
    const s = segs[i];
    if (/⏱|預估|ETA|分|min|秒|sec|步|steps?/i.test(s)) continue;
    category = s.replace(/\s+/g, '').toLowerCase().slice(0, 24);
    break;
  }

  return {
    estLo: lo,
    estHi: hi,
    estMid: (lo + hi) / 2,
    estSteps: steps ? parseInt(steps[1], 10) : null,
    category: category || 'none',
  };
};
