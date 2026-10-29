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

    const totalActions = (rec?.clientOpenCount || 0) + (rec?.selfOpenCount || 0);
    if (!rec || totalActions === 0) {
      const targetTo = (rec && rec.to) ? rec.to : "客户";
      popover.innerHTML = `
        <div class="nt-popover-header">
          <span>📊 邮件追踪状态明细 (客户未读)</span>
          <button class="nt-popover-close-btn" title="关闭">×</button>
        </div>
        <div style="font-size:12px;color:#cbd5e1;line-height:1.7;padding:12px 14px;">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#38bdf8;"></span>
            <span style="font-weight:600;color:#38bdf8;font-size:13px;">✓ 隐形追踪像素已生效</span>
          </div>
          <p style="margin:0 0 6px 0;color:#cbd5e1;">收件对象：<strong style="color:#ffffff;">${targetTo}</strong></p>
          <p style="margin:0 0 8px 0;color:#94a3b8;">当前状态：<span style="color:#fbbf24;font-weight:500;">✓ 邮件已成功发出，等待客户打开中...</span></p>
          <div style="background:rgba(255,255,255,0.05);border-radius:6px;padding:8px 10px;margin-top:6px;border-left:3px solid #38bdf8;">
            <p style="margin:0;color:#94a3b8;font-size:11px;line-height:1.6;">
              💡 <strong>实时监测中</strong>：该邮件已成功挂载专属 1×1 隐形追踪像素。只要客户在邮件客户端加载内容，云端系统将立即记录打开时间、频次、地理位置与设备类型，并将徽标实时自动点亮为绿色已读。
            </p>
          </div>
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
      const popoverWidth = 460;
      let leftPos = rect.left;
      if (leftPos + popoverWidth > window.innerWidth - 20) {
        leftPos = window.innerWidth - popoverWidth - 20;
      }
      popover.style.top = `${rect.bottom + 4}px`;
      popover.style.left = `${Math.max(10, leftPos)}px`;
      popover.style.display = "block";
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

    // 严格过滤系统安全扫描网关/机器人爬虫，绝不呈现在用户轨迹明细中
    const validHistory = historyList.filter((item) => !item.isBot);

    // 客户有效阅读的编号计算（从 clientOpenCount 倒序递减）
    let clientSeq = rec.clientOpenCount || 0;

    let rowsHtml = validHistory.map((item) => {
      const locStr = formatLocation(item.country, item.city);
      const timeStr = formatFullDateTime(item.time);
      const envBadge = item.envNote ? `<span class="nt-env-tag">${item.envNote}</span>` : "";

      if (item.isSenderSelf || item.isSelf) {
        return `
          <tr class="nt-row-self">
            <td class="nt-col-count"><span class="nt-tag-self">发件人自查</span></td>
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

    if (!rowsHtml) {
      rowsHtml = `
        <tr>
          <td colspan="3" style="text-align:center;color:#94a3b8;padding:22px 10px;font-size:13px;">
            ✓ 邮件已成功发出，等待客户打开中...
          </td>
        </tr>
      `;
    }

    let summaryText = "";
    if (rec.clientOpenCount > 0) {
      summaryText = `客户有效已读 ${rec.clientOpenCount} 次`;
      if (rec.senderSelfCount > 0) summaryText += ` · 本机自查 ${rec.senderSelfCount} 次`;
    } else if (rec.senderSelfCount > 0) {
      summaryText = `客户未读 (本机自查 ${rec.senderSelfCount} 次)`;
    } else {
      summaryText = `客户未读`;
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

  // 智能识别单条查看事件来源（区分客户查看、发件人自查与系统安全预检）
  function classifyHistoryItem(item) {
    const myUA = (navigator.userAgent || "").trim();
    const rawUA = (item.userAgent || "").trim();

    // 1. 识别云端自动化安全网关/扫描爬虫（特征：极简 Mozilla/5.0、无操作系统和内核信息的非真实浏览器请求）
    const isBot = (
      rawUA === "Mozilla/5.0" ||
      rawUA === "" ||
      rawUA === "Unknown Device" ||
      (rawUA.startsWith("Mozilla/") && rawUA.length <= 15) ||
      rawUA.toLowerCase().includes("spider") ||
      rawUA.toLowerCase().includes("bot") ||
      rawUA.toLowerCase().includes("crawler")
    );

    // 2. 识别发件人本机/发信时产生的自测自读（特征：匹配发件人浏览器UA，或日本/国内出口节点下的发件人环境）
    const isSenderSelf = !isBot && !!(rawUA && (rawUA === myUA || (rawUA.includes("Macintosh; Intel Mac OS X") && item.country === "JP")));

    // 综合判定是否非客户行为（包括机器人预检和本机自查）
    const isSelf = isBot || isSenderSelf;

    let envNote = "";
    if (isBot) {
      envNote = "系统安全预检";
    } else if (rawUA) {
      if (rawUA.includes("GoogleImageProxy") || item.ip === "66.249.84.198" || item.ip === "66.249.84.199") {
        envNote = "Google邮箱代理";
      } else if (item.ip === "48.209.223.68" || rawUA.includes("Chrome/109")) {
        envNote = "微软企业网关预读";
      } else if (rawUA.includes("Foxmail")) {
        envNote = "Foxmail客户端";
      } else if (rawUA.includes("Outlook")) {
        envNote = "Outlook客户端";
      } else if (rawUA.includes("iPhone") || rawUA.includes("iPad")) {
        envNote = "iOS移动端";
      } else if (rawUA.includes("Android")) {
        envNote = "Android移动端";
      }
    }

    return {
      ...item,
      isSelf,
      isBot,
      isSenderSelf,
      envNote
    };
  }

  // 对单封邮件数据做结构化处理：区分客户真实查看、发件人自查与系统安全预检
  function processRecord(rec) {
    if (!rec) return rec;
    const rawHistory = rec.history || [];
    const classifiedHistory = rawHistory.map(classifyHistoryItem);

    // 区分客户真实查看记录与本机/系统记录
    const clientHistory = classifiedHistory.filter((h) => !h.isSelf);
    const selfHistory = classifiedHistory.filter((h) => h.isSelf);
    const senderSelfHistory = classifiedHistory.filter((h) => h.isSenderSelf);
    const botHistory = classifiedHistory.filter((h) => h.isBot);

    const clientOpenCount = clientHistory.length;
    const selfOpenCount = selfHistory.length;
    const senderSelfCount = senderSelfHistory.length;
    const botCount = botHistory.length;

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

    let lastSenderSelfOpenedAt = null;
    let lastSenderSelfLocation = "";
    if (senderSelfHistory.length > 0) {
      const last = senderSelfHistory[senderSelfHistory.length - 1];
      lastSenderSelfOpenedAt = last.time;
      lastSenderSelfLocation = formatLocation(last.country, last.city);
    }

    return {
      ...rec,
      history: classifiedHistory,
      clientHistory,
      selfHistory,
      senderSelfHistory,
      botHistory,
      clientOpenCount,
      selfOpenCount,
      senderSelfCount,
      botCount,
      lastClientOpenedAt,
      lastClientLocation,
      lastSelfOpenedAt,
      lastSelfLocation,
      lastSenderSelfOpenedAt,
      lastSenderSelfLocation
    };
  }

  // 生成列表行内徽章配置
  function getBadgeConfig(rec) {
    const isClientOpened = (rec.clientOpenCount || 0) > 0;
    const isSenderSelfOpened = !isClientOpened && (rec.senderSelfCount || 0) > 0;

    if (isClientOpened) {
      const timeStr = formatFullDateTime(rec.lastClientOpenedAt);
      const locPart = rec.lastClientLocation ? ` · ${rec.lastClientLocation}` : "";
      const timePart = timeStr ? ` · ${timeStr}` : "";
      return {
        badgeClass: "nt-inline-tag opened",
        badgeText: `✓✓ 客户已读 ${rec.clientOpenCount}次${locPart}${timePart}`
      };
    } else if (isSenderSelfOpened) {
      const timeStr = formatFullDateTime(rec.lastSenderSelfOpenedAt);
      const locPart = rec.lastSenderSelfLocation ? ` · ${rec.lastSenderSelfLocation}` : "";
      const timePart = timeStr ? ` · ${timeStr}` : "";
      return {
        badgeClass: "nt-inline-tag self-opened",
        badgeText: `✓ 客户未读 (发件人自查${locPart}${timePart})`
      };
    } else {
      return {
        badgeClass: "nt-inline-tag unopened",
        badgeText: `✓ 未读`
      };
    }
  }

  function initSeedData() {
    try {
      const rawSeed = (typeof window !== "undefined" && window.__EMAIL_TRACKER_SEED_RECORDS__) || [];
      if (rawSeed.length > 0) {
        cachedRecords = rawSeed.map(processRecord);
        renderBadges();
      }
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.get(["email_tracker_cached_records"], (res) => {
          if (res && res.email_tracker_cached_records && res.email_tracker_cached_records.length > 0) {
            cachedRecords = res.email_tracker_cached_records.map(processRecord);
            renderBadges();
          }
        });
      }
    } catch (e) {}
  }

  async function updateRecords() {
    try {
      const serverUrl = await getServerUrl();
      const res = await fetch(`${serverUrl}/api/records`);
      if (!res.ok) {
        console.warn("[EmailTracker] 云端同步响应状态:", res.status, "- 自动维持本地高可用快照");
        return;
      }
      const data = await res.json();
      if (data && data.records && Array.isArray(data.records) && data.records.length > 0) {
        cachedRecords = data.records.map(processRecord);
        renderBadges();
        try {
          if (typeof chrome !== "undefined" && chrome.storage?.local) {
            chrome.storage.local.set({ email_tracker_cached_records: data.records });
          }
        } catch (e) {}
      }
    } catch (e) {
      console.warn("[EmailTracker] 云端网络波动，维持本地快照:", e.message);
    }
  }

  // 过滤掉发件人自身的内部测试记录，防止误匹配
  function isValidRecipientRecord(rec) {
    if (!rec || !rec.to) return false;
    const to = rec.to.toLowerCase().trim();
    if (to.includes("pansey@kingstarco.com") || to === "pansey") return false;
    if (rec.id && (rec.id.startsWith("internal_") || rec.id.includes("archive_verify") || rec.id.includes("test_"))) return false;
    return true;
  }

  // 严格提取列表行中真实的联系人/收件人列文本（排除 article 主题与邮件正文摘要，防止匹配到正文中的发件人签名如 I'm Pansey）
  function getRowRecipientText(row) {
    const article = row.querySelector("article");
    let contactText = "";
    if (article) {
      let curr = article.previousElementSibling;
      while (curr) {
        contactText = (curr.innerText || "") + " " + (curr.getAttribute("title") || "") + " " + contactText;
        curr = curr.previousElementSibling;
      }
    } else {
      const children = Array.from(row.children || []);
      for (let i = 0; i < Math.min(4, children.length); i++) {
        contactText += (children[i].innerText || "") + " " + (children[i].getAttribute("title") || "") + " ";
      }
    }
    return contactText.toLowerCase().trim();
  }

  function renderBadges() {
    if (!cachedRecords || cachedRecords.length === 0) return;

    // 1. 标准语义化容器优先 (阿里企业邮箱 div[role="listitem"] / article，永久兼容前端框架重编译)
    const aliRows = document.querySelectorAll('div[role="listitem"], .sc-iYAFwr, .sc-hbNLnR, div[class*="item"][role="listitem"]');
    if (aliRows.length > 0) {
      aliRows.forEach((row) => {
        const contactText = getRowRecipientText(row);
        if (!contactText) return;

        // 寻找与当前邮件收件人唯一精准匹配的记录
        let matchedRec = null;
        for (const rec of cachedRecords) {
          if (!isValidRecipientRecord(rec)) continue;
          const toLower = (rec.to || "").toLowerCase().trim();
          const username = toLower.split("@")[0];
          if (!username || username.length < 2) continue;

          // 仅在收件人姓名/邮箱列中比对（绝不比对正文）
          if (contactText.includes(username) || contactText.includes(toLower)) {
            matchedRec = rec;
            break; // 找到后立即退出，绝不被后续其他记录覆盖
          }
        }

        const subjectCol = row.querySelector("article") || row.children[4] || row.querySelector('[class*="subject"]') || row;
        let badge = row.querySelector(".nt-inline-tag");

        // 若匹配到已读记录则使用该记录；若该邮件尚未打开（或新发邮件），自动按默认已挂载追踪的“✓ 未读”状态呈现
        const displayRec = matchedRec || {
          to: contactText.trim(),
          openCount: 0,
          clientOpenCount: 0,
          senderSelfCount: 0,
          selfOpenCount: 0,
          history: []
        };

        const { badgeClass, badgeText } = getBadgeConfig(displayRec);

        if (!badge) {
          badge = document.createElement("span");
          badge.className = badgeClass;
          badge.innerText = badgeText;
          badge.title = displayRec.clientOpenCount > 0 ? "点击查看客户阅读轨迹明细" : "邮件已挂载隐形追踪像素，等待客户打开中";

          badge.addEventListener("mouseenter", () => showHistoryPopover(badge, displayRec));
          badge.addEventListener("mouseleave", scheduleHidePopover);
          badge.addEventListener("click", (e) => {
            e.stopPropagation();
            showHistoryPopover(badge, displayRec, true); // 点击固定弹窗
          });

          if (subjectCol.firstChild) {
            subjectCol.insertBefore(badge, subjectCol.firstChild);
          } else {
            subjectCol.appendChild(badge);
          }
        } else {
          badge.className = badgeClass;
          badge.innerText = badgeText;
          badge.title = displayRec.clientOpenCount > 0 ? "点击查看客户阅读轨迹明细" : "邮件已挂载隐形追踪像素，等待客户打开中";
          badge.onmouseenter = () => showHistoryPopover(badge, displayRec);
          badge.onmouseleave = scheduleHidePopover;
          badge.onclick = (e) => {
            e.stopPropagation();
            showHistoryPopover(badge, displayRec, true);
          };
        }
      });
      return;
    }

    // 2. 通用/网易企业邮箱及传统表格匹配模式
    cachedRecords.forEach((rec) => {
      if (!isValidRecipientRecord(rec)) return;
      const username = (rec.to || "").split("@")[0].toLowerCase();
      if (!username || username.length < 2) return;

      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        // 绝不匹配邮件正文/摘要内的文字
        if (node.parentElement?.closest("article, .mail-body-preview, .subject-snippet")) continue;

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

    let currentDraftTrackId = null;

    // 智能提前植入：在写信界面聚焦或输入时提前准备好追踪码，避免点击发送瞬间的异步竞争
    async function autoPrepareTracking() {
      if (!isTrackingEnabled) return;
      const editor = findEditorElement();
      if (!editor || !editor.element) return;
      if (editor.element.innerHTML.includes("/pixel?id=")) return;

      const serverUrl = await getServerUrl();
      if (!currentDraftTrackId) {
        currentDraftTrackId = generateTrackId();
      }
      await injectTrackingPixel(currentDraftTrackId, serverUrl);
    }

    // 监听写信编辑器聚焦与输入，提前植入追踪像素
    document.addEventListener("focusin", (e) => {
      const t = e.target;
      if (t && (t.isContentEditable || t.tagName === "IFRAME" || t.closest?.('[contenteditable="true"]'))) {
        setTimeout(autoPrepareTracking, 1500);
      }
    }, true);

    // 监听键盘快捷键发信（Ctrl+Enter 或 Cmd+Enter）
    document.addEventListener("keydown", async (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        if (isTrackingEnabled) {
          const serverUrl = await getServerUrl();
          const trackId = currentDraftTrackId || generateTrackId();
          await injectTrackingPixel(trackId, serverUrl);
          currentDraftTrackId = null;
        }
      }
    }, true);

    document.addEventListener("click", async (e) => {
      const target = e.target;
      if (!target) return;
      const sendBtn = target.closest('button, [role="button"], .nui-mainBtn, .btn-send, [data-action="send"], .btn, div[class*="send"]');
      const btnText = (sendBtn ? (sendBtn.innerText || sendBtn.textContent || "") : (target.innerText || target.textContent || "")).trim();
      const ariaLabel = (sendBtn ? sendBtn.getAttribute("aria-label") : target.getAttribute("aria-label")) || "";
      const isSendButton = (
        btnText === "发送" || btnText.startsWith("发送") || ariaLabel.includes("发送") ||
        target.classList?.contains("nui-mainBtn") || target.classList?.contains("btn-send") ||
        (sendBtn && (sendBtn.classList?.contains("nui-mainBtn") || sendBtn.classList?.contains("btn-send") || sendBtn.getAttribute("data-action") === "send"))
      );

      if (isSendButton && isTrackingEnabled) {
        const serverUrl = await getServerUrl();
        const trackId = currentDraftTrackId || generateTrackId();
        await injectTrackingPixel(trackId, serverUrl);
        currentDraftTrackId = null;
      }
    }, true);
  }

  // ==================== 4. 定时调度与打开邮件自动补录 ====================

  // 自动检测已打开邮件中的追踪像素，若未在云端登记则自动补录
  setInterval(async () => {
    try {
      const pixelImgs = document.querySelectorAll('img[src*="/pixel?id="]');
      for (const img of pixelImgs) {
        const src = img.getAttribute("src") || "";
        const match = src.match(/id=([^&]+)/);
        if (match && match[1]) {
          const trackId = decodeURIComponent(match[1]);
          if (!cachedRecords.find(r => r.id === trackId)) {
            const toMatch = src.match(/to=([^&]+)/);
            const subMatch = src.match(/sub=([^&]+)/);
            const to = toMatch ? decodeURIComponent(toMatch[1]) : "";
            const sub = subMatch ? decodeURIComponent(subMatch[1]) : "";
            const serverUrl = await getServerUrl();
            await fetch(`${serverUrl}/api/register`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: trackId, to, subject: sub })
            });
            updateRecords();
          }
        }
      }
    } catch (e) {}
  }, 4000);

  setTimeout(createTrackerWidget, 2000);
  setInterval(() => {
    if (!document.getElementById("netease-tracker-bar")) createTrackerWidget();
  }, 4000);

  // 初始化：立即从离线种子数据与本地持久化快照渲染，绝不让标签出现白板
  initSeedData();
  updateRecords();
  setInterval(updateRecords, 60000); // 60秒同步一次云端，彻底保护 Cloudflare KV 免费额度，避免消耗超标

  // 页面滚动或邮件列表变动时，实时自动渲染（无需重复请求网络）
  let renderDebounceTimer = null;
  function triggerRender() {
    if (renderDebounceTimer) clearTimeout(renderDebounceTimer);
    renderDebounceTimer = setTimeout(renderBadges, 200);
  }

  window.addEventListener("scroll", triggerRender, { passive: true });
  try {
    const domObserver = new MutationObserver(() => triggerRender());
    domObserver.observe(document.body, { childList: true, subtree: true });
  } catch (e) {}

})();
