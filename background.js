/**
 * Background Service Worker:
 * 1. 负责后台拉取数据，彻底绕过网页端 CSP 策略限制
 * 2. 在浏览器网络底层拦截任何发往 /pixel 的请求，彻底杜绝发件人本地预览或撰写邮件时误触发追踪
 */

function setupBlockRule() {
  if (chrome.declarativeNetRequest) {
    chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [1001],
      addRules: [
        {
          id: 1001,
          priority: 1,
          action: { type: "block" },
          condition: {
            urlFilter: "/pixel",
            resourceTypes: ["image", "xmlhttprequest", "sub_frame", "other"]
          }
        }
      ]
    }).catch(() => {});
  }
}

chrome.runtime.onInstalled.addListener(() => {
  setupBlockRule();
});

setupBlockRule();

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
