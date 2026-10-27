/**
 * 专为网易、阿里等外贸企业邮箱定制的内容脚本 (Content Script)
 * 具备功能：
 * 1. 列表默认展示：已读频次 + 最后一次打开的中文国家城市 + 准确时间
 * 2. 鼠标悬停（Hover）：无缝滑动进入明细弹窗，支持流畅滚动查看所有记录
 * 3. 点击锁定（Click to Pin）：点击标签可直接固定弹窗，方便细看
 */

(() => {
  const href = location.href.toLowerCase();
  const isMailDomain = href.includes("mail") || href.includes("qiye") || href.includes("aliyun") || href.includes("163") || document.title.includes("邮箱");
  if (!isMailDomain) return;

  console.log("[EmailTracker] 追踪助手已在当前页面就绪:", location.href);

  const DEFAULT_SERVER = "https://young-email.yulong88-wang.workers.dev";
  let cachedRecords = [];
  let isTrackingEnabled = true;

  // 国家代码汉化字典
  const COUNTRY_NAMES = {
    US: "美国",
    JP: "日本",
    FR: "法国",
    DE: "德国",
    GB: "英国",
    UK: "英国",
    CN: "中国",
    CA: "加拿大",
    AU: "澳大利亚",
    SG: "新加坡",
    NL: "荷兰",
    IT: "意大利",
    ES: "西班牙",
    KR: "韩国",
    HK: "中国香港",
    TW: "中国台湾",
    RU: "俄罗斯",
    IN: "印度",
    BR: "巴西",
    VN: "越南",
    TH: "泰国",
    MY: "马来西亚",
    PH: "菲律宾",
    ID: "印尼",
    AE: "阿联酋",
    SA: "沙特",
    MX: "墨西哥"
  };

  function formatLocation(country, city) {
    const cName = COUNTRY_NAMES[country] || country || "";
    const cCity = city || "";
    if (cName && cCity) return `${cName} - ${cCity}`;
    return cName || cCity || "海外地区";
  }

  function formatFullDateTime(isoStr) {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    const Y = d.getFullYear();
    const M = String(d.getMonth() + 1).padStart(2, "0");
    const D = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    const s = String(d.getSeconds()).padStart(2, "0");
    return `${Y}-${M}-${D} ${h}:${m}:${s}`;
  }

  function formatShortTime(isoStr) {
    if (!isoStr) return "";
    const d = new Date(isoStr);
    const h = String(d.getHours()).padStart(2, "0");
    const m = String(d.getMinutes()).padStart(2, "0");
    return `${h}:${m}`;
  }

  function generateTrackId() {
    return "tr_" + Date.now().toString(36) + "_" + Math.random().toString(36).substr(2, 6);
  }

  // ==================== 1. 悬停与固定浮窗管理 ====================

  let hoverPopover = null;
  let hidePopoverTimer = null;
  let isPinned = false; // 是否点击固定

  function ensureHoverPopover() {
    if (hoverPopover) return hoverPopover;
    hoverPopover = document.getElementById("nt-hover-popover");
    if (!hoverPopover) {
      hoverPopover = document.createElement("div");
      hoverPopover.id = "nt-hover-popover";
      document.body.appendChild(hoverPopover);

      // 鼠标进入浮窗本身时，取消隐藏定时器
      hoverPopover.addEventListener("mouseenter", () => {
        if (hidePopoverTimer) clearTimeout(hidePopoverTimer);
      });

      // 鼠标离开浮窗且未点击锁定时，才触发延迟隐藏
      hoverPopover.addEventListener("mouseleave", () => {
        if (!isPinned) scheduleHidePopover();
      });

      // 点击网页空白处解除固定
      document.addEventListener("click", (e) => {
        if (!hoverPopover.contains(e.target) && !e.target.classList.contains("nt-inline-tag")) {
          isPinned = false;
          hoverPopover.style.display = "none";
        }
      });
    }
    return hoverPopover;
  }

  function showHistoryPopover(badge, rec, pin = false) {
    if (hidePopoverTimer) clearTimeout(hidePopoverTimer);
    const popover = ensureHoverPopover();

    if (pin) isPinned = true;

    const totalActions = (rec.clientOpenCount || 0) + (rec.selfOpenCount || 0);
    if (!rec || totalActions === 0) {
      popover.style.display = "none";
      return;
    }

    const historyList = [...(rec.history || [])];
    if (historyList.length === 0 && rec.lastOpenedAt) {
      const parts = (rec.lastLocation || "").split(" ");
      historyList.push({
        time: rec.lastOpenedAt,
        country: parts[0] || "",
        city: parts[1] || "",
        isSelf: false
      });
    }
    historyList.reverse();

    // 客户有效阅读的编号计算（从 clientOpenCount 倒序递减）
    let clientSeq = rec.clientOpenCount || 0;

    let rowsHtml = historyList.map((item) => {
      const locStr = formatLocation(item.country, item.city);
      const timeStr = formatFullDateTime(item.time);
      const envBadge = item.envNote ? `<span class="nt-env-tag">${item.envNote}</span>` : "";

      if (item.isSelf) {
        return `
          <tr class="nt-row-self">
            <td class="nt-col-count"><span class="nt-tag-self">本机自测</span></td>
            <td class="nt-col-location">在 ${locStr} 查看</td>
            <td class="nt-col-time">${timeStr}</td>
          </tr>
        `;
      } else {
        const curNum = clientSeq--;
        return `
          <tr class="nt-row-client">
            <td class="nt-col-count"><span class="nt-tag-client">第 ${curNum} 次客户查看</span></td>
            <td class="nt-col-location">在 ${locStr} 查看 ${envBadge}</td>
            <td class="nt-col-time">${timeStr}</td>
          </tr>
        `;
      }
    }).join("");

    let summaryText = "";
    if (rec.clientOpenCount > 0 && rec.selfOpenCount > 0) {
      summaryText = `客户有效已读 ${rec.clientOpenCount} 次 · 本机自测 ${rec.selfOpenCount} 次`;
    } else if (rec.clientOpenCount > 0) {
      summaryText = `客户已读 ${rec.clientOpenCount} 次`;
    } else if (rec.selfOpenCount > 0) {
      summaryText = `客户未读 (本机自测 ${rec.selfOpenCount} 次)`;
    } else {
      summaryText = `暂无记录`;
    }

    popover.innerHTML = `
      <div class="nt-popover-header">
        <span>📊 邮件阅读轨迹明细 (${summaryText})</span>
        <button class="nt-popover-close-btn" title="关闭">×</button>
      </div>
      <div class="nt-table-scroll-container">
        <table class="nt-history-table">
          <tbody>
            ${rowsHtml}
          </tbody>
        </table>
      </div>
    `;

    const closeBtn = popover.querySelector(".nt-popover-close-btn");
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        isPinned = false;
        popover.style.display = "none";
      });
    }

    const rect = badge.getBoundingClientRect();
    const popoverWidth = 560;
    let leftPos = rect.left;
    if (leftPos + popoverWidth > window.innerWidth - 20) {
      leftPos = window.innerWidth - popoverWidth - 20;
    }

    // 严密贴合在标签下方，无跳空断层
    popover.style.top = `${rect.bottom + 4}px`;
    popover.style.left = `${Math.max(10, leftPos)}px`;
    popover.style.display = "block";
  }

  function scheduleHidePopover() {
    if (isPinned) return; // 固定状态下不自动隐藏
    if (hidePopoverTimer) clearTimeout(hidePopoverTimer);
    hidePopoverTimer = setTimeout(() => {
      if (!isPinned && hoverPopover) {
        hoverPopover.style.display = "none";
      }
    }, 400); // 400ms 宽裕保护时间
  }

  // ==================== 2. 获取数据与渲染列表行标签 ====================

  async function getServerUrl() {
    return new Promise((resolve) => {
      try {
        chrome.storage.sync.get(["serverUrl"], (data) => {
          resolve(data?.serverUrl || DEFAULT_SERVER);
        });
      } catch (e) {
        resolve(DEFAULT_SERVER);
      }
    });
  }

  // 智能识别单条查看事件来源（区分客户查看与发件人自查，并识别企业安全网关与设备特征）
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

    return {
      ...item,
      isSelf,
      envNote
    };
  }

  // 对单封邮件数据做结构化处理：计算客户真实打开与发件人自查
  function processRecord(rec) {
    if (!rec) return rec;
    const rawHistory = rec.history || [];
    const classifiedHistory = rawHistory.map(classifyHistoryItem);

    // 区分客户真实查看记录与本机自读记录
    const clientHistory = classifiedHistory.filter((h) => !h.isSelf);
    const selfHistory = classifiedHistory.filter((h) => h.isSelf);

    const clientOpenCount = clientHistory.length;
    const selfOpenCount = selfHistory.length;

    let lastClientOpenedAt = null;
    let lastClientLocation = "";
    if (clientHistory.length > 0) {
      const last = clientHistory[clientHistory.length - 1];
      lastClientOpenedAt = last.time;
      lastClientLocation = formatLocation(last.country, last.city);
    }

    let lastSelfOpenedAt = null;
    let lastSelfLocation = "";
    if (selfHistory.length > 0) {
      const last = selfHistory[selfHistory.length - 1];
      lastSelfOpenedAt = last.time;
      lastSelfLocation = formatLocation(last.country, last.city);
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

  // 生成列表行内徽章配置
  function getBadgeConfig(rec) {
    const isClientOpened = (rec.clientOpenCount || 0) > 0;
    const isSelfOnly = !isClientOpened && (rec.selfOpenCount || 0) > 0;

    if (isClientOpened) {
      const timeStr = formatFullDateTime(rec.lastClientOpenedAt);
      const locPart = rec.lastClientLocation ? ` · ${rec.lastClientLocation}` : "";
      const timePart = timeStr ? ` · ${timeStr}` : "";
      return {
        badgeClass: "nt-inline-tag opened",
        badgeText: `✓✓ 客户已读 ${rec.clientOpenCount}次${locPart}${timePart}`
      };
    } else if (isSelfOnly) {
      const timeStr = formatFullDateTime(rec.lastSelfOpenedAt);
      const locPart = rec.lastSelfLocation ? ` · ${rec.lastSelfLocation}` : "";
      const timePart = timeStr ? ` · ${timeStr}` : "";
      return {
        badgeClass: "nt-inline-tag self-opened",
        badgeText: `✓ 客户未读 (本机自测${locPart}${timePart})`
      };
    } else {
      return {
        badgeClass: "nt-inline-tag unopened",
        badgeText: `✓ 未读`
      };
    }
  }

  async function updateRecords() {
    try {
      const serverUrl = await getServerUrl();
      const res = await fetch(`${serverUrl}/api/records`);
      const data = await res.json();
      if (data && data.records) {
        cachedRecords = data.records.map(processRecord);
        renderBadges();
      }
    } catch (e) {}
  }

  function renderBadges() {
    if (!cachedRecords || cachedRecords.length === 0) return;

    // 1. 标准语义化容器优先 (阿里企业邮箱 div[role="listitem"] / article，永久兼容前端框架重编译)
    const aliRows = document.querySelectorAll('div[role="listitem"], .sc-iYAFwr, .sc-hbNLnR, div[class*="item"][role="listitem"]');
    if (aliRows.length > 0) {
      aliRows.forEach((row) => {
        const rowText = row.innerText.toLowerCase();
        cachedRecords.forEach((rec) => {
          const username = (rec.to || "").split("@")[0].toLowerCase();
          if (!username || username.length < 2) return;

          if (rowText.includes(username)) {
            // 阿里邮箱中 article 元素代表邮件主题列，空间大、无溢出遮挡
            const subjectCol = row.querySelector("article") || row.children[4] || row.querySelector('[class*="subject"]') || row;
            let badge = row.querySelector(".nt-inline-tag");
            const { badgeClass, badgeText } = getBadgeConfig(rec);

            if (!badge) {
              badge = document.createElement("span");
              badge.className = badgeClass;
              badge.innerText = badgeText;

              badge.addEventListener("mouseenter", () => showHistoryPopover(badge, rec));
              badge.addEventListener("mouseleave", scheduleHidePopover);
              badge.addEventListener("click", (e) => {
                e.stopPropagation();
                showHistoryPopover(badge, rec, true); // 点击固定弹窗
              });

              if (subjectCol.firstChild) {
                subjectCol.insertBefore(badge, subjectCol.firstChild);
              } else {
                subjectCol.appendChild(badge);
              }
            } else {
              badge.className = badgeClass;
              badge.innerText = badgeText;
              badge.onmouseenter = () => showHistoryPopover(badge, rec);
              badge.onmouseleave = scheduleHidePopover;
              badge.onclick = (e) => {
                e.stopPropagation();
                showHistoryPopover(badge, rec, true);
              };
            }
          }
        });
      });
      return;
    }

    // 2. 通用/网易企业邮箱及传统表格匹配模式
    cachedRecords.forEach((rec) => {
      const username = (rec.to || "").split("@")[0].toLowerCase();
      if (!username || username.length < 2) return;

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const text = (node.nodeValue || "").trim().toLowerCase();
        if (text === username || text.startsWith(username)) {
          const parent = node.parentElement;
          if (!parent || parent.classList?.contains("nt-inline-tag")) continue;

          const row = parent.closest('tr, [role="row"], [role="listitem"], .mail-item, .list-item, li, div[class*="item"]');
          if (!row) continue;

          let badge = row.querySelector(".nt-inline-tag");
          const { badgeClass, badgeText } = getBadgeConfig(rec);

          if (!badge) {
            badge = document.createElement("span");
            badge.className = badgeClass;
            badge.innerText = badgeText;
            badge.addEventListener("mouseenter", () => showHistoryPopover(badge, rec));
            badge.addEventListener("mouseleave", scheduleHidePopover);
            badge.addEventListener("click", (e) => {
              e.stopPropagation();
              showHistoryPopover(badge, rec, true);
            });
            const targetCol = row.querySelector("article") || row.querySelector('[class*="subject"]') || parent;
            if (targetCol.firstChild) {
              targetCol.insertBefore(badge, targetCol.firstChild);
            } else {
              targetCol.appendChild(badge);
            }
          } else {
            badge.className = badgeClass;
            badge.innerText = badgeText;
            badge.onmouseenter = () => showHistoryPopover(badge, rec);
            badge.onmouseleave = scheduleHidePopover;
            badge.onclick = (e) => {
              e.stopPropagation();
              showHistoryPopover(badge, rec, true);
            };
          }
          break;
        }
      }
    });
  }

  // ==================== 3. 写信界面与自动注入 ====================

  function findEditorElement() {
    const iframes = document.querySelectorAll("iframe");
    for (const iframe of iframes) {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc && doc.body && (doc.body.contentEditable === "true" || doc.designMode === "on")) {
          return { type: "iframe", element: doc.body };
        }
      } catch (e) {}
    }
    const editableDivs = document.querySelectorAll('div[contenteditable="true"]');
    if (editableDivs.length > 0) {
      return { type: "div", element: editableDivs[editableDivs.length - 1] };
    }
    return null;
  }

  function getMailMeta() {
    let to = "";
    let subject = "";

    const toInputs = document.querySelectorAll(
      'input[aria-label*="收件人"], input[placeholder*="收件人"], .js-component-emailinput input, input[name="to"], .nui-editableAddr-ipt, .mail-to-input, input[id*="to"]'
    );
    for (const inp of toInputs) {
      if (inp.value) { to = inp.value; break; }
    }
    if (!to) {
      const tags = document.querySelectorAll('.nui-editableAddr .nui-addr-name, .nui-addr-email, .contact-item, .mail-contact-item, [data-role="contact"]');
      if (tags.length > 0) {
        to = Array.from(tags).map(t => t.textContent.trim()).join(", ");
      }
    }

    const subInputs = document.querySelectorAll(
      'input[aria-label*="主题"], input[placeholder*="主题"], input[name="subject"], .nui-ipt-input, input[id*="subject"], .subject-input input'
    );
    for (const inp of subInputs) {
      if (inp.value) { subject = inp.value; break; }
    }

    return { to: to || "待定收件人", subject: subject || "未命名外贸业务邮件" };
  }

  async function injectTrackingPixel(trackId, serverUrl) {
    const editor = findEditorElement();
    if (!editor) return false;

    const { to, subject } = getMailMeta();
    const pixelUrl = `${serverUrl}/pixel?id=${encodeURIComponent(trackId)}&to=${encodeURIComponent(to)}&sub=${encodeURIComponent(subject)}`;
    const pixelHtml = `<img id="net-tracker-pixel" src="${pixelUrl}" width="1" height="1" style="display:none!important;width:1px!important;height:1px!important;" alt="" />`;

    if (editor.element.innerHTML.includes(trackId)) return true;

    editor.element.innerHTML += pixelHtml;
    console.log("[EmailTracker] 追踪像素已成功注入邮件末尾:", pixelUrl);

    try {
      await fetch(`${serverUrl}/api/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: trackId, to, subject })
      });
    } catch (e) {}

    return true;
  }

  function createTrackerWidget() {
    if (window.self !== window.top) return;
    if (document.getElementById("netease-tracker-bar")) return;

    const bar = document.createElement("div");
    bar.id = "netease-tracker-bar";
    bar.innerHTML = `
      <div class="nt-header">
        <span class="nt-logo">⚡ 邮件已读追踪</span>
        <button id="nt-close-btn" class="nt-icon-btn">×</button>
      </div>
      <div class="nt-body">
        <label class="nt-switch">
          <input type="checkbox" id="nt-toggle" checked />
          <span class="nt-slider"></span>
          <span class="nt-label-text">已开启阅读追踪</span>
        </label>
        <div class="nt-actions">
          <button id="nt-inject-btn" class="nt-action-btn">手动注入追踪码</button>
        </div>
        <div id="nt-status-msg" class="nt-tip">已就绪：点击“发送”自动激活</div>
      </div>
    `;

    document.body.appendChild(bar);

    const toggle = document.getElementById("nt-toggle");
    const statusMsg = document.getElementById("nt-status-msg");
    const injectBtn = document.getElementById("nt-inject-btn");
    const closeBtn = document.getElementById("nt-close-btn");

    toggle.addEventListener("change", (e) => {
      isTrackingEnabled = e.target.checked;
      statusMsg.textContent = isTrackingEnabled ? "已开启：发信时将自动记录打开次数与地点" : "已关闭：当前邮件不会被追踪";
      statusMsg.style.color = isTrackingEnabled ? "#10b981" : "#9ca3af";
    });

    injectBtn.addEventListener("click", async () => {
      const serverUrl = await getServerUrl();
      const trackId = generateTrackId();
      const success = await injectTrackingPixel(trackId, serverUrl);
      if (success) {
        statusMsg.textContent = `✓ 追踪码已植入 (ID: ${trackId.slice(0, 8)})`;
        statusMsg.style.color = "#10b981";
      } else {
        statusMsg.textContent = "未检测到编辑器，请先点击邮件正文";
        statusMsg.style.color = "#ef4444";
      }
    });

    closeBtn.addEventListener("click", () => {
      bar.style.display = "none";
    });

    document.addEventListener("click", async (e) => {
      const target = e.target;
      if (!target) return;
      const btnText = (target.innerText || target.textContent || "").trim();
      const ariaLabel = target.getAttribute("aria-label") || "";
      const isSendButton = (
        btnText === "发送" || btnText.includes("发送") || ariaLabel.includes("发送") ||
        target.classList?.contains("nui-mainBtn") || target.classList?.contains("btn-send") ||
        target.closest(".nui-mainBtn") || target.closest(".btn-send") || target.closest('[data-action="send"]')
      );

      if (isSendButton && isTrackingEnabled) {
        const serverUrl = await getServerUrl();
        const trackId = generateTrackId();
        await injectTrackingPixel(trackId, serverUrl);
      }
    }, true);
  }

  // ==================== 4. 定时调度 ====================

  setTimeout(createTrackerWidget, 2000);
  setInterval(() => {
    if (!document.getElementById("netease-tracker-bar")) createTrackerWidget();
  }, 4000);

  updateRecords();
  setInterval(updateRecords, 3000);

})();
