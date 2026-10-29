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

  function classifyHistoryItem(item) {
    const myUA = (navigator.userAgent || "").trim();
    const isSelf = !!(item.userAgent && item.userAgent.trim() === myUA);

    let envNote = "";
    if (item.userAgent) {
      if (item.userAgent.includes("GoogleImageProxy") || item.ip === "66.249.84.198" || item.ip === "66.249.84.199") {
        envNote = "Google邮箱代理";
      } else if (item.ip === "48.209.223.68" || item.userAgent.includes("Chrome/109")) {
        envNote = "微软企业网关预读";
      } else if (item.userAgent.includes("Foxmail")) {
        envNote = "Foxmail客户端";
      } else if (item.userAgent.includes("Outlook")) {
        envNote = "Outlook客户端";
      } else if (item.userAgent.includes("iPhone") || item.userAgent.includes("iPad")) {
        envNote = "iOS移动端";
      } else if (item.userAgent.includes("Android")) {
        envNote = "Android移动端";
      }
    }

    return { ...item, isSelf, envNote };
  }

  function processRecord(rec) {
    if (!rec) return rec;
    const rawHistory = rec.history || [];
    const classifiedHistory = rawHistory.map(classifyHistoryItem);

    const clientHistory = classifiedHistory.filter((h) => !h.isSelf);
    const selfHistory = classifiedHistory.filter((h) => h.isSelf);

    const clientOpenCount = clientHistory.length;
    const selfOpenCount = selfHistory.length;

    let lastClientOpenedAt = null;
    let lastClientLocation = "";
    if (clientHistory.length > 0) {
      const last = clientHistory[clientHistory.length - 1];
      lastClientOpenedAt = last.time;
      lastClientLocation = `${last.country} ${last.city}`.trim();
    }

    let lastSelfOpenedAt = null;
    let lastSelfLocation = "";
    if (selfHistory.length > 0) {
      const last = selfHistory[selfHistory.length - 1];
      lastSelfOpenedAt = last.time;
      lastSelfLocation = `${last.country} ${last.city}`.trim();
    }

    return {
      ...rec,
      history: classifiedHistory,
      clientHistory,
      selfHistory,
      clientOpenCount,
      selfOpenCount,
      lastClientOpenedAt,
      lastClientLocation,
      lastSelfOpenedAt,
      lastSelfLocation
    };
  }

  function isValidRecipientRecord(rec) {
    if (!rec || !rec.to) return false;
    const to = rec.to.toLowerCase().trim();
    if (to.includes("pansey@kingstarco.com") || to === "pansey") return false;
    if (rec.id && (rec.id.startsWith("internal_") || rec.id.includes("archive_verify") || rec.id.includes("test_"))) return false;
    return true;
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
      const records = rawRecords.filter(isValidRecipientRecord).map(processRecord);

      // 更新汇总卡片：以真实客户打开为准
      const totalSent = records.length;
      const openedCount = records.filter(r => (r.clientOpenCount || 0) > 0).length;
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
        const isClientOpened = (item.clientOpenCount || 0) > 0;
        const isSelfOnly = !isClientOpened && (item.selfOpenCount || 0) > 0;

        let statusBadge = "";
        let locationText = "";
        let timeText = "";

        if (isClientOpened) {
          statusBadge = `<span class="badge opened">客户已读 ${item.clientOpenCount} 次</span>`;
          locationText = item.lastClientLocation ? `📍 ${item.lastClientLocation}` : "📍 海外地区";
          timeText = `客户最后查看: ${formatTime(item.lastClientOpenedAt)}`;
        } else if (isSelfOnly) {
          statusBadge = `<span class="badge self-opened">仅本机自测</span>`;
          locationText = item.lastSelfLocation ? `📍 ${item.lastSelfLocation}` : "📍 暂无地点";
          timeText = `本机自测于: ${formatTime(item.lastSelfOpenedAt)}`;
        } else {
          statusBadge = `<span class="badge unopened">未读</span>`;
          locationText = "📍 暂无地点";
          timeText = `发送于: ${formatTime(item.createdAt)}`;
        }

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
