/**
 * Cloudflare Worker: 专属邮件追踪云端节点
 * 功能：
 * 1. 响应 1x1 像素隐形透明 GIF 图像
 * 2. 自动捕获收件人的打开时间、打开频次、IP、国家、城市、设备 User-Agent
 * 3. 提供统计 API 供 Chrome 插件面板查看
 */

// 1x1 像素透明 GIF 的二进制 Buffer
const TRANSPARENT_GIF = new Uint8Array([
  0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00,
  0x80, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21,
  0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00,
  0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44,
  0x01, 0x00, 0x3b
]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 跨域响应头设置
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // 1. 追踪像素请求: /pixel?id=xxx&to=xxx
    if (url.pathname === "/pixel" || url.pathname === "/pixel.gif") {
      const trackId = url.searchParams.get("id");
      const recipient = url.searchParams.get("to") || "unknown";

      if (trackId) {
        // 获取收件人的环境信息
        const ip = request.headers.get("cf-connecting-ip") || "Unknown IP";
        const userAgent = request.headers.get("user-agent") || "Unknown Device";
        const country = request.cf?.country || "未知国家";
        const city = request.cf?.city || "未知城市";
        const region = request.cf?.region || "";
        const now = new Date().toISOString();

        // 异步记录追踪事件到 KV 数据库 (如果绑定了 TRACKING_KV)
        if (env.TRACKING_KV) {
          ctx.waitUntil((async () => {
            const rawData = await env.TRACKING_KV.get(trackId);
            let item = rawData ? JSON.parse(rawData) : {
              id: trackId,
              to: recipient,
              subject: url.searchParams.get("sub") || "外贸业务邮件",
              createdAt: now,
              openCount: 0,
              history: []
            };

            item.openCount = (item.openCount || 0) + 1;
            item.lastOpenedAt = now;
            item.lastLocation = `${country} ${city}`.trim();
            item.history.push({
              time: now,
              ip: ip,
              country: country,
              city: city,
              region: region,
              userAgent: userAgent
            });

            // 限制最多保留最近 20 次打开记录
            if (item.history.length > 20) {
              item.history = item.history.slice(-20);
            }

            await env.TRACKING_KV.put(trackId, JSON.stringify(item), { expirationTtl: 60 * 60 * 24 * 90 }); // 保留90天
            
            // 同时更新全部邮件索引列表
            let indexRaw = await env.TRACKING_KV.get("__index__");
            let indexList = indexRaw ? JSON.parse(indexRaw) : [];
            if (!indexList.includes(trackId)) {
              indexList.unshift(trackId);
              if (indexList.length > 100) indexList = indexList.slice(0, 100);
              await env.TRACKING_KV.put("__index__", JSON.stringify(indexList));
            }
          })());
        }
      }

      // 返回 1x1 透明 GIF，强制禁止客户端与代理缓存
      return new Response(TRANSPARENT_GIF, {
        headers: {
          "Content-Type": "image/gif",
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
          "Pragma": "no-cache",
          "Expires": "0",
          ...corsHeaders
        }
      });
    }

    // 2. 发信前登记接口: POST /api/register
    if (url.pathname === "/api/register" && request.method === "POST") {
      try {
        const body = await request.json();
        const { id, to, subject } = body;
        if (!id) return new Response("Missing id", { status: 400 });

        if (env.TRACKING_KV) {
          const item = {
            id,
            to: to || "未知收件人",
            subject: subject || "未命名邮件",
            createdAt: new Date().toISOString(),
            openCount: 0,
            history: []
          };
          await env.TRACKING_KV.put(id, JSON.stringify(item), { expirationTtl: 60 * 60 * 24 * 90 });

          let indexRaw = await env.TRACKING_KV.get("__index__");
          let indexList = indexRaw ? JSON.parse(indexRaw) : [];
          if (!indexList.includes(id)) {
            indexList.unshift(id);
            if (indexList.length > 100) indexList = indexList.slice(0, 100);
            await env.TRACKING_KV.put("__index__", JSON.stringify(indexList));
          }
        }
        return new Response(JSON.stringify({ success: true, id }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
      }
    }

    // 3. 查询追踪数据: GET /api/records
    if (url.pathname === "/api/records") {
      if (!env.TRACKING_KV) {
        return new Response(JSON.stringify({
          error: "请先在 Cloudflare 中绑定 KV 命名空间 TRACKING_KV",
          records: []
        }), {
          headers: { "Content-Type": "application/json", ...corsHeaders }
        });
      }

      const indexRaw = await env.TRACKING_KV.get("__index__");
      const indexList = indexRaw ? JSON.parse(indexRaw) : [];
      const records = [];

      for (const id of indexList) {
        const itemRaw = await env.TRACKING_KV.get(id);
        if (itemRaw) {
          records.push(JSON.parse(itemRaw));
        }
      }

      return new Response(JSON.stringify({ records }), {
        headers: { "Content-Type": "application/json", ...corsHeaders }
      });
    }

    // 默认测试主页
    return new Response("⚡ 邮件追踪云端服务运行中 (Email Tracker Worker is running!)", {
      headers: { "Content-Type": "text/plain; charset=utf-8", ...corsHeaders }
    });
  }
};
