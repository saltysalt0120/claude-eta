# Claude ETA — self-estimate + calibration for claude.ai

A Chrome extension (Manifest V3) that shows **elapsed time vs. a calibrated
estimate** while Claude is working on claude.ai.

> Status: v0.1 — works as a proof of concept. Selectors that read the claude.ai
> page are in `selectors.js` and will need retuning whenever Anthropic ships a
> frontend change. Expect to fix them every few weeks.

---

## The problem this records

This project started from a user question, kept here verbatim in spirit so the
reasoning is not lost:

> Can you make a Claude widget that shows an *estimated completion time*?
> Right now the UI only shows what Claude is thinking or about to do. I want
> something like a loading bar so I can clearly see how far along the run is.

The follow-up questions were:

1. Other people have built token-usage widgets for claude.ai, so there must be
   a way for a widget to read data. Can that be extended to an ETA?
2. If the widget tracks token consumption rate (including the 5-hour and weekly
   quota resets), can it compute an ETA *before* the task runs, getting more
   accurate over time by learning per task type and per model?

The conclusions we reached, which drive the design below:

- **The ETA does not exist anywhere to be read.** Usage widgets read data that
  already exists (message text, the quota API). An agentic task has no total
  step count until it finishes; the model decides the next step from the result
  of the last one.
- **Token rate is the wrong signal for wall-clock time.** Most of a long
  agentic turn is spent waiting on tool calls (web search, file operations,
  subagents), during which tokens barely move. Quota reset windows are billing
  boundaries, not speed boundaries, and add nothing to a time estimate.
- **Task type cannot be reliably classified before the run** from the prompt
  text alone. A one-line prompt can be a 15-second single search or a
  five-minute eight-round investigation.
- **The one thing that *can* converge is the model's own estimate.** The model
  can see what it is about to do, which beats keyword guessing from outside.
  Its estimate will be biased, but bias is measurable and correctable.

So the design is: **Claude states an estimate at the top of each reply; the
extension records estimate vs. actual, learns the bias per model and task
category, and shows a corrected ETA on a bar.**

---

## How it works

### 1. The estimate line

Claude is asked (via a saved preference) to begin every non-trivial reply with
a single machine-readable line:

```
⏱ 預估 3–6 分 · 約 5 步 · 搜尋+檔案
```

Format (regex in `selectors.js`):

- leading `⏱`
- `預估 <min>–<max> 分` — estimated duration range in minutes
  (`秒` is accepted for sub-minute tasks)
- `約 <n> 步` — expected number of tool calls (optional)
- `<category>` — a short free-text tag such as `搜尋`, `檔案`, `翻譯`,
  `程式`, or a combination joined by `+` (optional; used as the calibration
  bucket)

English variants (`ETA 3–6 min · ~5 steps · search+files`) are also parsed.

### 2. What the content script observes

Verified against the live claude.ai DOM on 2026-09-23:

- **Turn start / end:** `[data-testid="assistant-message"]` flips
  `data-is-streaming` between `true` and `false`. The Stop button is only a
  fallback.
- **Model:** `button[data-testid="model-selector-dropdown"]`, whose
  `aria-label` is `Model: <name>`.
- **Tool calls so far:** `[data-testid="TurnStatus"]` rows inside the streaming
  message, excluding those with `data-step-key="thinking-N"`. claude.ai
  collapses long runs into "… and 7 more steps", so this undercounts on long
  turns; it is a floor, not an exact figure.
- **Estimate line:** parsed from the streaming message's text as soon as it
  appears.

Everything is read from the DOM. No cookies, no internal API calls, nothing
leaves the browser.

### 3. Calibration

Each finished turn is stored in `chrome.storage.local` as

```json
{ "ts": 1758650000000, "model": "Fable 5.1", "category": "搜尋+檔案",
  "estMid": 270, "estSteps": 5, "actualSec": 412, "toolCalls": 7 }
```

For a new turn with a parsed estimate `estMid`:

1. Take the last 200 records with the same `(model, category)`; fall back to
   same `model`, then to everything, until at least 5 samples exist.
2. Compute the ratio `actualSec / estMid` for each sample and take the
   **median** → the bias factor. Corrected ETA = `estMid × bias`.
3. **Live quantile walk** (borrowed from `claude-prompt-monitor`): once elapsed
   time passes the corrected ETA, the bar re-targets to the 75th percentile of
   ratios, then the 90th, then the 98th. The bar therefore never claims a task
   is about to finish when the history says it might not be.
4. Turns without an estimate line are still recorded (for elapsed-time history)
   but excluded from bias calculation.

With fewer than 5 samples the panel shows `?` after the estimate.

### 4. The panel

A small fixed panel in the lower-right corner of claude.ai:

```
 ▸ 2:14 / ~4:30     [████████░░░░░░░░]
   Fable 5.1 · 搜尋+檔案 · 7 tools · n=23
```

- Turns amber past the corrected ETA, red past p90.
- Click the sample count to export the history as JSON; a file picker imports.

---

## Prior art

Nothing does this for claude.ai. Closest:

- [som3669/claude-prompt-monitor](https://github.com/som3669/claude-prompt-monitor)
  (MIT) — Claude Code only; reads local transcripts; estimates from the median
  of comparable past prompts in the same project, with an elapsed-time quantile
  walk. No model self-estimate. The author reports ~43% of up-front estimates
  landing within 2× of actual. We borrow the quantile-walk idea.
- [task-progress-bar](https://dev.to/prafulreddy/a-zero-token-progress-bar-for-claude-code-51bp)
  — Claude Code hook that renders the native task list as a bar with an EMA of
  time per completed task. Requires a known task count.
- Usage/quota trackers for claude.ai such as
  [lugia19/Claude-Usage-Extension](https://github.com/lugia19/Claude-Usage-Extension),
  [she-llac/claude-counter](https://github.com/she-llac/claude-counter) and
  [Bitcoineo/claudeUsageExtension](https://github.com/Bitcoineo/claudeUsageExtension)
  — all measure tokens or quota, none estimate time.

---

## Install

1. Clone or download this repo.
2. Chrome → `chrome://extensions` → enable **Developer mode**.
3. **Load unpacked** → select this folder.
4. Open claude.ai. The panel appears when a reply starts streaming.
5. Tell Claude (once, as a saved preference) to start every non-trivial reply
   with the estimate line described above.

### Does it work in the Claude desktop app?

No. The desktop app is an Electron shell and does not load Chrome extensions,
so there is no way to inject the content script there. Use claude.ai in Chrome
(or any Chromium browser that loads unpacked extensions: Edge, Brave, Arc) when
you want the panel. The calibration history lives in that browser's
`chrome.storage.local`, so it does not follow you to the app either.

## Known limits

- **Breaks on frontend changes.** All page reads go through `selectors.js`.
  When the panel stops updating, that file is where to look.
- **Estimates are only as good as the model's self-estimate plus your
  history.** Expect the first weeks to be useful only at the "seconds vs.
  minutes" level.
- Interrupted turns (you pressed Stop) are recorded with `aborted: true` and
  excluded from calibration.
- A single long tool call looks like one step until it returns; elapsed time
  moves, the tool count does not.
- The turn-end signal also fires when you switch to another chat mid-run; that
  turn is recorded as `aborted`.
- Model detection depends on the model-picker text; if it cannot be read the
  turn is bucketed under `unknown`.

## License

MIT. See [LICENSE](LICENSE).
