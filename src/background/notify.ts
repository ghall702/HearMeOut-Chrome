export function notify(id: string, title: string, message: string) {
  chrome.notifications
    ?.create(`hmo-${id}-${Date.now()}`, { type: "basic", iconUrl: chrome.runtime.getURL("icons/icon-128.png"), title, message, priority: 1 })
    .catch(() => undefined);
}
