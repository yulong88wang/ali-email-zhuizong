/**
 * Popup 脚本：加载与展示追踪日志
 */

document.addEventListener("DOMContentLoaded", async () => {
  const settingsToggle = document.getElementById("settings-toggle");
  const settingsPanel = document.getElementById("settings-panel");
  const serverUrlInput = document.getElementById("server-url");
  const saveServerBtn = document.getElementById("save-server-btn");
  const refreshBtn = document.getElementById("refresh-btn");
  const recordsList = document.getElementById("records-list");

  const totalSentEl = document.getElementById("total-sent");
  const totalOpenedEl = document.getElementById("total-opened");
  const openRateEl = document.getElementById("open-rate");

  // 1. 初始化读取设置
  const { serverUrl = "" } = await chrome.storage.sync.get(["serverUrl"]);
  if (serverUrl) {
    serverUrlInput.value = serverUrl;
  } else {
    // 首次未配置时自动展开设置面板
    settingsPanel.classList.remove("hidden");
  }

  // 切换设置面板显示
  settingsToggle.addEventListener("click", () => {
    settingsPanel.classList.toggle("hidden");
  });

  // 保存设置
  saveServerBtn.addEventListener("click", async () => {
    let url = serverUrlInput.value.trim();
    if (url.endsWith("/")) url = url.slice(0, -1);
    await chrome.storage.sync.set({ serverUrl: url });
    alert("云端服务地址已保存！");
    settingsPanel.classList.add("hidden");
    loadRecords(url);
  });

  // 刷新按钮
  refreshBtn.addEventListener("click", () => {
    const url = serverUrlInput.value.trim();
    loadRecords(url);
  });

  // 时间格式化辅助
  function formatTime(isoStr) {
    if (!isoStr) return "";
    const date = new Date(isoStr);
    const m = (date.getMonth() + 1).toString().padStart(2, "0");
    const d = date.getDate().toString().padStart(2, "0");
    const h = date.getHours().toString().padStart(2, "0");
    const min = date.getMinutes().toString().padStart(2, "0");
    return `${m}-${d} ${h}:${min}`;
  }

  function cleanSenderSelfRecords(record) {
    if (!record) return record;
    if (!record.history || record.history.length === 0) return record;

    const myUA = (navigator.userAgent || "").trim();
    const validHistory = record.history.filter((evt) => {
      if (evt.userAgent && evt.userAgent.trim() === myUA) {
        return false;
      }
      return true;
    });

    const cleaned = { ...record };
    cleaned.history = validHistory;
    cleaned.openCount = validHistory.length;

    if (validHistory.length > 0) {
      const last = validHistory[validHistory.length - 1];
      cleaned.lastOpenedAt = last.time;
      cleaned.lastLocation = `${last.country} ${last.city}`.trim();
    } else {
      cleaned.lastOpenedAt = null;
      cleaned.lastLocation = "";
    }

    return cleaned;
  }

  // 加载数据
  async function loadRecords(baseUrl) {
    if (!baseUrl) {
      recordsList.innerHTML = `
        <div class="empty-state">
          <span>请先配置云端地址</span>
          <p>点击右上角 ⚙️ 填入您的 Cloudflare Worker 网址即可同步数据。</p>
        </div>
      `;
      return;
    }

    recordsList.innerHTML = `<div class="empty-state"><span>正在同步数据...</span></div>`;

    try {
      const res = await fetch(`${baseUrl}/api/records`);
      const data = await res.json();
      const rawRecords = data.records || [];
      const records = rawRecords.map(cleanSenderSelfRecords);

      // 更新汇总卡片
      const totalSent = records.length;
      const openedCount = records.filter(r => r.openCount > 0).length;
      const rate = totalSent > 0 ? Math.round((openedCount / totalSent) * 100) : 0;

      totalSentEl.textContent = totalSent;
      totalOpenedEl.textContent = openedCount;
      openRateEl.textContent = `${rate}%`;

      if (records.length === 0) {
        recordsList.innerHTML = `
          <div class="empty-state">
            <span>暂无外发邮件数据</span>
            <p>在网易邮箱中发信并激活追踪后，记录将实时显示在此处。</p>
          </div>
        `;
        return;
      }

      // 渲染列表
      recordsList.innerHTML = records.map(item => {
        const isOpened = item.openCount > 0;
        const statusBadge = isOpened
          ? `<span class="badge opened">已读 ${item.openCount} 次</span>`
          : `<span class="badge unopened">未读</span>`;

        const locationText = item.lastLocation ? `📍 ${item.lastLocation}` : "📍 暂无地点";
        const timeText = isOpened ? `最后查看: ${formatTime(item.lastOpenedAt)}` : `发送于: ${formatTime(item.createdAt)}`;

        return `
          <div class="record-item">
            <div class="record-top">
              <span class="record-to" title="${item.to}">${item.to}</span>
              ${statusBadge}
            </div>
            <div class="record-sub" title="${item.subject}">主题: ${item.subject}</div>
            <div class="record-meta">
              <span>${timeText}</span>
              <span class="meta-location">${locationText}</span>
            </div>
          </div>
        `;
      }).join("");

    } catch (err) {
      recordsList.innerHTML = `
        <div class="empty-state">
          <span style="color:#ef4444">连接服务失败</span>
          <p>${err.message}</p>
        </div>
      `;
    }
  }

  // 默认尝试加载一次
  if (serverUrl) {
    loadRecords(serverUrl);
  }
});
