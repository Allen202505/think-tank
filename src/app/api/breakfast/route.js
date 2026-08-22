// src/app/api/breakfast/route.js
// 巴菲特的早餐 · 事件穿透框架：一次生成一步（逐步推演）
// POST { news, hostId, guests:[{id,groupKey}], mode:'quick'|'deep', stepKey, prevSteps:[{title,content}] }
// mode='quick' → 快速解读（单次返回）；mode='deep'（默认）→ 框架逐步推演
import { SYSTEM_GUARD } from '../../../lib/security';
import { getQuoteContext } from '../chat/quoteContext.js';
import { getClientIp, rateLimit, limitResponse } from '../../../lib/rateLimit';
import { buildFrameworkStepPrompt, buildFollowupPrompt, buildQuickBreakfastPrompt, buildQuickTurnPrompt } from '../../../lib/prompts';
import { FRAMEWORK_STEPS, resolveLead } from '../../../lib/framework';
import { findMasterById } from '../../../lib/breakfast';

import { resolveAiConfig } from '../../../lib/llm.js';

function extractJson(text) {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  try {
    return JSON.parse(candidate);
  } catch (e) {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1));
      } catch (e2) {
        return null;
      }
    }
    return null;
  }
}

async function callDeepSeek(messages, maxTokens = 6000, cfg = null) {
  const aiCfg = resolveAiConfig(cfg);
  if (!aiCfg.apiKey) {
    throw new Error('未配置 API Key，请在设置中填写');
  }
  const url = /\/chat\/completions$/.test(aiCfg.baseUrl) ? aiCfg.baseUrl : `${aiCfg.baseUrl}/chat/completions`;
  const attempt = async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${aiCfg.apiKey}`,
        },
        body: JSON.stringify({
          model: aiCfg.model,
          max_tokens: maxTokens,
          messages,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const msg = err?.error?.message || `模型服务错误: ${res.status}`;
        if (res.status === 401 || res.status === 403) throw new Error('API Key 无效或无权限（401/403），请检查设置中的 Key');
        throw new Error(msg);
      }
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? '';
    } finally {
      clearTimeout(timer);
    }
  };
  // 网络/服务偶发抖动或排队：最多尝试 3 次，间隔递增（600ms / 1200ms）
  let lastErr;
  for (let i = 0; i < 3; i++) {
    try {
      return await attempt();
    } catch (e) {
      lastErr = e;
      if (i < 2) await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw lastErr;
}

// 模型偶尔会把「内层 JSON 整体塞进 content 字符串」：尝试解包，合并内层字段
function unwrapNested(parsed) {
  if (!parsed || typeof parsed.content !== 'string') return parsed;
  const c = parsed.content.trim();
  if (!c.startsWith('{')) return parsed;
  const inner = extractJson(c);
  if (!inner || typeof inner.content !== 'string') return parsed;
  return { ...parsed, ...inner, content: inner.content.trim() };
}

// 提取圆桌讨论轮次（turns）：speaker 只能是 host 或 guestN
function extractTurns(normalized) {
  if (!Array.isArray(normalized?.turns)) return [];
  return normalized.turns
    .filter((t) => t && typeof t.text === 'string' && String(t.text).trim())
    .map((t) => ({ speaker: String(t.speaker || 'host').trim(), text: String(t.text).trim().slice(0, 100) }))
    .filter((t) => t.speaker === 'host' || /^guest\d+$/.test(t.speaker))
    .slice(0, 8);
}

// 请求 AI 并尽量解析出 JSON；解析失败自动修复重试一次
// schemaHint：修复消息里展示的 JSON 结构（普通步骤为 {content, followUps}，结构化步骤为完整字段）
async function generateJson(messages, schemaHint = '{"content":"本步完整分析正文","followUps":["追问1","追问2"]}', maxTokens = 6000, requireContent = true, userConfig = null) {
  const isValid = (obj) => {
    if (!obj || typeof obj !== 'object') return false;
    if (requireContent) return typeof obj.content === 'string' && obj.content.trim();
    return Object.keys(obj).length > 0; // 初筛/快速等可能没有 content，只要有结构即可
  };
  let raw = await callDeepSeek(messages, maxTokens, userConfig);
  let parsed = extractJson(raw);
  if (!isValid(parsed)) {
    messages.push(
      { role: 'assistant', content: raw },
      { role: 'user', content: `你刚才的输出不是合法 JSON。请严格只输出一个 JSON 对象，不要任何解释、不要 Markdown 代码块、不要用引号包裹整个 JSON：${schemaHint}。所有字符串内只允许中文引号「」或“”。` },
    );
    raw = await callDeepSeek(messages, maxTokens, userConfig);
    parsed = extractJson(raw);
  }
  return { raw, parsed };
}

function buildMessages(prompt, snapshot, userAsk) {
  const messages = [{ role: 'system', content: SYSTEM_GUARD }];
  if (snapshot) {
    messages.push(
      { role: 'user', content: snapshot },
      { role: 'assistant', content: '我已收到最新市场数据快照，将基于快照数据参与分析。' },
    );
  }
  messages.push(
    { role: 'system', content: prompt },
    { role: 'user', content: userAsk },
  );
  return messages;
}

export async function POST(request) {
  try {
  const _rl = rateLimit('breakfast:' + getClientIp(request), { limit: 30, windowMs: 60000 });
  if (!_rl.ok) return limitResponse(_rl.retryAfter);

    const body = await request.json();
    const news = body.news;
    const hostId = body.hostId || 'buffett';
    const guestItems = Array.isArray(body.guests) ? body.guests : [];
    const mode = body.mode === 'quick' ? 'quick' : 'deep';
    const stepKey = body.stepKey || 'step0';
    const prevSteps = Array.isArray(body.prevSteps) ? body.prevSteps : [];
    const aiCfg = resolveAiConfig(body.aiConfig);

    if (!news || !news.title) {
      return Response.json({ error: '缺少新闻内容' }, { status: 400 });
    }
    // 支持粘贴链接：抓取页面标题/描述，失败则用原文
    let resolvedNews = { ...news };
    if (/^https?:\/\/\S+$/i.test(String(news.title || '').trim())) {
      const link = news.title.trim();
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        const res = await fetch(link, {
          signal: ctrl.signal,
          headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
          redirect: 'follow',
        });
        clearTimeout(timer);
        if (res.ok) {
          const html = (await res.text()).slice(0, 300000);
          const clean = (str) => String(str || '')
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
          const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
                            html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
          if (titleMatch) resolvedNews = { ...resolvedNews, title: clean(titleMatch[1]).slice(0, 120) || resolvedNews.title };
          if (descMatch) resolvedNews = { ...resolvedNews, content: clean(descMatch[1]).slice(0, 500) || resolvedNews.content };
          if (!resolvedNews.content || resolvedNews.content === resolvedNews.title) {
            resolvedNews = { ...resolvedNews, content: resolvedNews.content || resolvedNews.title };
          }
          resolvedNews = { ...resolvedNews, source: '用户链接', tags: ['用户链接'] };
        }
      } catch (e) { /* 抓取失败：保持原文 */ }
    }

    const host = findMasterById(hostId);
    const guests = guestItems
      .map((g) => {
        const master = findMasterById(g.id);
        return master ? { master, groupKey: g.groupKey || '' } : null;
      })
      .filter(Boolean);
    if (!host || !guests.length) {
      return Response.json({ error: '主持人或嘉宾缺失' }, { status: 400 });
    }

    const useNews = resolvedNews;

    // 信息层梳理：新闻里提到公司 → 拉最新行情/财务/深度分析快照
    const queryText = `${useNews.title}\n${useNews.content || ''}`;
    const snapshot = await getQuoteContext(queryText).catch(() => '');

    // ── 快速解读：逐条生成（一人一条，边分析边出结论） ──
    if (mode === 'quick') {
      if (stepKey === 'quickturn') {
        const turnKey = body.turnKey || '';
        const prevTurns = Array.isArray(body.prevTurns) ? body.prevTurns.slice(0, 8) : [];
        if (!turnKey) return Response.json({ error: '缺少 turnKey' }, { status: 400 });
        const speakerRole = /^guest\d+$/.test(turnKey) ? turnKey : 'host';
        const isSummary = turnKey === 'summary';
        const prompt = buildQuickTurnPrompt(useNews, host, guests, turnKey, prevTurns);
        const messages = buildMessages(prompt, snapshot, '请输出这一句，直接输出 JSON。');
        const schema = isSummary ? '{"summary":"巴菲特最后总结（150-250字）"}' : '{"text":"这句话（≤100字）"}';
        const { raw, parsed } = await generateJson(messages, schema, 600, false, aiCfg);
        const normalized = unwrapNested(parsed);
        if (isSummary) {
          const summary = normalized && typeof normalized.summary === 'string' ? normalized.summary.trim() : '';
          if (!summary) {
            if (raw && raw.trim()) return Response.json({ ok: true, result: { turnKey: 'summary', speaker: 'host', summary: raw.trim() } });
            return Response.json({ error: 'AI 输出格式异常，请重试一次' }, { status: 502 });
          }
          return Response.json({ ok: true, result: { turnKey: 'summary', speaker: 'host', summary } });
        }
        const text = normalized && typeof normalized.text === 'string' ? normalized.text.trim().slice(0, 100) : '';
        if (!text) {
          if (raw && raw.trim()) return Response.json({ ok: true, result: { turnKey, speaker: speakerRole, text: raw.trim().slice(0, 100) } });
          return Response.json({ error: 'AI 输出格式异常，请重试一次' }, { status: 502 });
        }
        return Response.json({ ok: true, result: { turnKey, speaker: speakerRole, text } });
      }

      const prompt = buildQuickBreakfastPrompt(useNews, host, guests);
      const messages = buildMessages(prompt, snapshot, '请完成快速解读，直接输出 JSON。');
      const { raw, parsed } = await generateJson(
        messages,
        '{"turns":[{"speaker":"host","text":"抛题"},{"speaker":"guest0","text":"快速观点"},{"speaker":"guest1","text":"快速观点或反驳"},{"speaker":"host","text":"收束"}],"summary":"巴菲特最后总结","verdict":"🟢","reason":"一句话理由","followUps":["追问1","追问2"]}',
        2500,
        false,
        aiCfg,
      );
      const quickParsed = unwrapNested(parsed);
      const quickTurns = extractTurns(quickParsed);
      let quickSummary = quickParsed && typeof quickParsed.summary === 'string' ? quickParsed.summary.trim() : '';
      // 兜底：模型没给总结时，用巴菲特最后一轮收束发言当总结
      if (!quickSummary) {
        const hostTurns = quickTurns.filter((t) => t.speaker === 'host');
        quickSummary = hostTurns.length ? hostTurns[hostTurns.length - 1].text : '';
      }
      if (!quickParsed || quickTurns.length === 0) {
        if (raw && raw.trim()) {
          return Response.json({
            ok: true,
            result: {
              stepKey: 'quick',
              title: '快速解读',
              leadId: host.id,
              type: 'quick',
              content: raw.trim(),
              turns: [],
              followUps: [],
            },
          });
        }
        return Response.json({ error: 'AI 输出格式异常，请重试一次' }, { status: 502 });
      }
      const followUps = Array.isArray(quickParsed.followUps)
        ? quickParsed.followUps.filter((f) => typeof f === 'string' && f.trim()).slice(0, 3)
        : [];
      return Response.json({
        ok: true,
        result: {
          stepKey: 'quick',
          title: '快速解读',
          leadId: host.id,
          type: 'quick',
          content: '',
          turns: quickTurns,
          summary: quickSummary,
          verdict: typeof quickParsed.verdict === 'string' ? quickParsed.verdict.trim() : '',
          reason: typeof quickParsed.reason === 'string' ? quickParsed.reason.trim() : '',
          followUps,
        },
      });
    }

    // ── 追问：想深挖？点击即可追问（一步简短问答，不复制文本） ──
    if (stepKey === 'followup') {
      const question = typeof body.followUp === 'string' ? body.followUp.trim() : '';
      if (!question) return Response.json({ error: '缺少追问内容' }, { status: 400 });
      const leadMaster = (body.followUpLead && findMasterById(body.followUpLead)) || host;
      const prompt = buildFollowupPrompt(useNews, host, guests, leadMaster, question, prevSteps);
      const messages = buildMessages(prompt, snapshot, '请回答用户的追问，直接输出 JSON。');
      const { raw, parsed } = await generateJson(
        messages,
        '{"content":"你对追问的回答","hostNote":"主持人一句话补充(可空)"}',
        1600,
        true,
        aiCfg,
      );
      const normalized = unwrapNested(parsed);
      if (!normalized || typeof normalized.content !== 'string' || !normalized.content.trim()) {
        if (raw && raw.trim()) {
          return Response.json({
            ok: true,
            result: { stepKey: 'followup', title: '追问', leadId: leadMaster.id, type: 'followup', content: raw.trim(), hostNote: '', followUps: [] },
          });
        }
        return Response.json({ error: 'AI 输出格式异常，请重试一次' }, { status: 502 });
      }
      return Response.json({
        ok: true,
        result: {
          stepKey: 'followup',
          title: '追问',
          leadId: leadMaster.id,
          type: 'followup',
          content: normalized.content.trim(),
          hostNote: typeof normalized.hostNote === 'string' ? normalized.hostNote.trim() : '',
          followUps: [],
        },
      });
    }

    // ── 深度模式：框架逐步推演（一次一步） ──
    const step = FRAMEWORK_STEPS.find((s) => s.key === stepKey);
    if (!step) {
      return Response.json({ error: `未知步骤: ${stepKey}` }, { status: 400 });
    }
    const lead = resolveLead(host, guests, step.lead);
    const prompt = buildFrameworkStepPrompt(useNews, host, guests, step, prevSteps);
    const messages = buildMessages(prompt, snapshot, `请完成【${step.title}】，直接输出 JSON。`);
    let schemaHint;
    if (step.key === 'gate') {
      schemaHint = '{"content":"你的初筛发言","verdict":"🟢","reason":"一句话理由","followUps":["追问1"]}';
    } else if (step.structured) {
      schemaHint = '{"content":"你的收束发言","opportunities":[{"tier":"🔴 重点关注","name":"公司名称","code":"代码","logic":"一句逻辑","risk":"一句风险","falsify":"一句可证伪红线"}],"action":{"verdict":"可以考虑","entry":"买入区间","stopLoss":"止损位","cycle":"短线"},"risk":"一句风险提示","followUps":["追问1"]}';
    } else if (step.pool) {
      schemaHint = '{"content":"你的发言","pool":[{"name":"机会/方向名","code":"代码(可空)","tier":"🔴/🟡/⚪","logic":"一句逻辑","risk":"一句风险","falsify":"一句可证伪红线(可空)","status":"候选/排除/保留/待验证/落地","reason":"本轮更新说明"}],"followUps":["追问1","追问2"]}';
    } else {
      schemaHint = '{"content":"你的发言","followUps":["追问1","追问2"]}';
    }
    const { raw, parsed } = await generateJson(messages, schemaHint, 6000, true, aiCfg);
    const normalized = unwrapNested(parsed);
    const turns = extractTurns(normalized);
    const content = normalized && typeof normalized.content === 'string' ? normalized.content.trim() : '';
    const isValidResult = normalized && (step.key === 'gate'
      ? (content || turns.length > 0 || (typeof normalized.verdict === 'string' && normalized.verdict.trim()))
      : content);
    if (!isValidResult) {
      // 兜底：尽力保留原文，不让整轮推演断掉（turns/followUps 置空）
      if (raw && raw.trim()) {
        const result = {
          stepKey,
          title: step.title,
          leadId: lead.id,
          type: step.key === 'gate' ? 'gate' : (step.structured ? 'conclusion' : undefined),
          content: raw.trim(),
          turns: [],
          followUps: [],
        };
        if (step.key === 'gate') { result.verdict = ''; result.reason = ''; result.stop = false; }
        return Response.json({ ok: true, result });
      }
      return Response.json({ error: 'AI 输出格式异常，请重试一次' }, { status: 502 });
    }

    const followUps = Array.isArray(normalized.followUps)
      ? normalized.followUps.filter((f) => typeof f === 'string' && f.trim()).slice(0, 3)
      : [];

    if (step.key === 'gate') {
      // 初筛闸门：verdict=⚪ 时前端停止后续步骤
      const verdict = typeof normalized.verdict === 'string' ? normalized.verdict.trim() : '';
      const reason = typeof normalized.reason === 'string' ? normalized.reason.trim() : '';
      return Response.json({
        ok: true,
        result: {
          stepKey,
          title: step.title,
          leadId: lead.id,
          type: 'gate',
          content,
          turns,
          verdict,
          reason,
          stop: verdict.includes('⚪'),
          followUps,
        },
      });
    }

    if (step.structured) {
      // 核心结论：结构化字段透传给前端渲染结论卡
      const opportunities = Array.isArray(normalized.opportunities)
        ? normalized.opportunities
            .filter((o) => o && typeof o === 'object' && (o.name || o.logic))
            .slice(0, 3)
        : [];
      const action = (normalized.action && typeof normalized.action === 'object') ? normalized.action : {};
      return Response.json({
        ok: true,
        result: {
          stepKey,
          title: step.title,
          leadId: lead.id,
          type: 'conclusion',
          content,
          turns,
          opportunities,
          action,
          risk: typeof normalized.risk === 'string' ? normalized.risk.trim() : '',
          followUps,
        },
      });
    }

    const pool = step.pool && Array.isArray(normalized.pool)
      ? normalized.pool
          .filter((o) => o && typeof o === 'object' && (o.name || o.logic))
          .slice(0, 8)
      : [];

    return Response.json({
      ok: true,
      result: {
        stepKey,
        title: step.title,
        leadId: lead.id,
        content,
        turns,
        followUps,
        pool,
      },
    });
  } catch (e) {
    const isNet = e && (e.name === 'TypeError' || /fetch|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(String(e.message)));
    return Response.json(
      { error: isNet ? '连接 AI 服务失败（网络异常），请稍后重试' : (e.message || '服务器内部错误') },
      { status: 500 },
    );
  }
}
