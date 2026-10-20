/**
 * Background Service Worker: 负责后台拉取数据，彻底绕过网页端 CSP 策略限制
 */

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "fetchRecords") {
    chrome.storage.sync.get(["serverUrl"], async ({ serverUrl }) => {
      if (!serverUrl) {
        sendResponse({ error: "未配置云端地址", records: [] });
        return;
      }
      try {
        const res = await fetch(`${serverUrl}/api/records`);
        const data = await res.json();
        sendResponse(data);
      } catch (err) {
        sendResponse({ error: err.message, records: [] });
      }
    });
    return true; // 保持异步响应通道
  }
});
