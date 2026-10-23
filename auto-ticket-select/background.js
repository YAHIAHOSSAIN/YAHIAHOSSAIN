// Shows desktop notifications on behalf of the content script.
chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "notify") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: msg.title || "Auto Ticket Select",
      message: msg.message || "",
      priority: 2,
      requireInteraction: true
    });
  }
});
