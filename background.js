// Service worker: the only place chrome.runtime.reload() is allowed.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === 'claude-eta-reload') chrome.runtime.reload();
});
