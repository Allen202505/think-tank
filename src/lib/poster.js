// poster.js —— 客户端生成辩论分享海报（#10 v2）
// 重新设计：问题作为大标题 / 观点卡片化 / 关键数字高亮 / 控制文字量 / 更多留白
import QRCode from 'qrcode';

// 二维码指向的网站地址（.env.local 里是占位符时兜底真实域名）
function getSiteUrl() {
  const env = process.env.NEXT_PUBLIC_SITE_URL || '';
  if (env && !/your-domain|example\.com|think-tank\.example/.test(env)) return env;
  return 'https://yieldglide.com';
}

const W = 1080;
const H = 1920;

// 浅色（暖白）主题
const GOLD = '#9a7830';       // 金色点缀/标签（白底可读）
const GOLD_BRIGHT = '#b56b00'; // 数字高亮色（深琥珀）
const INK = '#1f1d19';        // 主文字（近黑）
const MUTED = '#6b675f';      // 次级文字
const DIM = '#a39d90';        // 弱文字/页脚
const CONTENT = '#4a463f';    // 正文
const STANCE = {
  BULL: { label: '看多 ▲', color: '#2e7d57' },
  BEAR: { label: '看空 ▼', color: '#c04040' },
  NEUTRAL: { label: '中性 —', color: '#9a7830' },
};
const MARGIN = 70;

const FONT_SERIF = '"Songti SC","SimSun",Georgia,serif';
const FONT_SANS = '"PingFang SC","Heiti SC",-apple-system,"Microsoft YaHei",sans-serif';
const FONT_MONO = '"SF Mono","Consolas",monospace';

// 按宽度换行；超出 maxLines 时在末行补 "…"
// opts.boldDigits=true 时按富文本测宽（数字 token 用粗体，与 drawRichLine 一致，避免实际绘制溢出）
function wrapLines(ctx, text, maxWidth, maxLines, opts = {}) {
  const s = String(text || '');
  const baseFont = opts.baseFont || '';
  const boldFont = opts.boldFont || '';
  const boldDigits = !!opts.boldDigits;
  const lines = [];
  let line = '';
  let truncated = false;
  // 数字(含单位)聚成原子 token 不拆行；其余按字符逐字折行
  const chars = [];
  // 数字(含单位)与英文单词(含 / . - % 等)聚成原子 token 不拆行；其余按字符逐字折行
  const re = /-?\d+(?:\.\d+)?(?:万亿|亿|万|倍|%|％)?|[A-Za-z][A-Za-z0-9./%\-]*|\s|[\s\S]/g;
  let m;
  while ((m = re.exec(s)) !== null) chars.push(m[0]);
  // 富文本感知测宽：数字 token 用粗体，其余用常规（与绘制一致，防溢出）
  const measure = (str) => {
    if (!boldDigits || !boldFont) return ctx.measureText(str).width;
    let w = 0;
    const re2 = /-?\d+(?:\.\d+)?(?:万亿|亿|万|倍|%|％)?|[^-?\d]+/g;
    let mm;
    while ((mm = re2.exec(str)) !== null) {
      const tk = mm[0];
      ctx.font = /^-?\d/.test(tk) ? boldFont : baseFont;
      w += ctx.measureText(tk).width;
    }
    ctx.font = baseFont;
    return w;
  };
  const trimStart = (str) => str.replace(/^[\s、。，；：,.，!！?？、]+/, '');
  for (const ch of chars) {
    if (line && measure(line + ch) > maxWidth) {
      if (lines.length >= maxLines - 1) { truncated = true; break; }
      lines.push(line);
      line = trimStart(ch);
    } else {
      line += ch;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (truncated) {
    let last = lines.length ? lines[lines.length - 1] : '';
    while (last.length && measure(last + '…') > maxWidth) last = last.slice(0, -1);
    if (lines.length) lines[lines.length - 1] = last + '…';
    else lines.push('…');
  }
  return lines;
}

// 画一行富文本：数字/百分比用高亮色加粗
function drawRichLine(ctx, text, x, y, maxWidth) {
  const tokens = (text || '').match(/(?:-?\d+(?:\.\d+)?)(?:万亿|亿|万|倍|%|％)?|[^-?\d]+/g) || [text || ''];
  let cx = x;
  for (const tk of tokens) {
    const isNum = /^-?\d/.test(tk);
    ctx.font = isNum ? `700 26px ${FONT_SANS}` : `400 26px ${FONT_SANS}`;
    ctx.fillStyle = isNum ? GOLD_BRIGHT : CONTENT;
    ctx.fillText(tk, cx, y);
    cx += ctx.measureText(tk).width;
  }
  return cx;
}

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 过滤模型可能输出的脏值（undefined/null/空串）
function clean(v) {
  if (v == null) return '';
  const t = String(v).trim();
  return (t === 'undefined' || t === 'null') ? '' : t;
}

function hexA(hex, alpha) {
  const h = String(hex || GOLD).replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

function drawAvatar(ctx, img, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(154,120,48,0.8)';
  ctx.lineWidth = 3;
  ctx.stroke();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

/**
 * 生成辩论海报 canvas
 * @param {object} opts { question, hostId, masters, hostOpening, discussion, hostClosing, verdict }
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function generatePoster(opts) {
  const { question, hostId, masters = [], hostOpening, discussion = [], verdict = {} } = opts;
  const masterMap = Object.fromEntries(masters.map((m) => [m.id, m]));

  const bullPick = discussion.find((m) => m.stance === 'BULL');
  const bearPick = discussion.find((m) => m.stance === 'BEAR');
  const shown = bullPick && bearPick ? [bullPick, bearPick] : discussion.slice(0, 2);
  const shownSet = new Set(shown);
  const unshown = discussion.filter((m) => !shownSet.has(m));
  const unshownNames = unshown.map((m) => masterMap[m.investorId]?.name).filter(Boolean);

  const CARD_W = W - MARGIN * 2;
  const CARD_PAD = 30;
  const PAD_TOP = 38;
  const PAD_BOTTOM = 30;
  const NAME_H = 56;
  const KP_GAP = 8;
  const BODY_GAP = 30;
  const LINE_H = 40;

  // ── 测量阶段：先按内容算行数，画布高度随内容自适应（不截断） ──
  const scratch = document.createElement('canvas').getContext('2d');
  const measureLines = (font, text, maxW, maxLines, opts = {}) => {
    scratch.font = font;
    return wrapLines(scratch, text || '', maxW, maxLines, { ...opts, baseFont: font });
  };

  const titleLines = measureLines(`700 52px ${FONT_SERIF}`, question || '（未提供问题）', CARD_W, 2);
  const hostLines = hostOpening ? measureLines(`400 26px ${FONT_SERIF}`, hostOpening, CARD_W, 6) : [];

  const cards = shown.map((msg) => {
    const m = masterMap[msg.investorId];
    const st = STANCE[msg.stance] || STANCE.NEUTRAL;
    const name = m?.name || '大师';
    let keyPoint = clean(msg.keyPoint);
    keyPoint = keyPoint.replace(/^观点[：:]\s*/, '');
    const kpLines = keyPoint
      ? measureLines(`700 27px ${FONT_SANS}`, `观点：${keyPoint}`, CARD_W - CARD_PAD * 2 - 14, 2)
      : [];
    const contentLines = measureLines(`400 26px ${FONT_SANS}`, msg.content, CARD_W - CARD_PAD * 2 - 14, 6, { boldDigits: true, boldFont: `700 26px ${FONT_SANS}` });
    const kpH = kpLines.length * 40;
    const contentTop = PAD_TOP + NAME_H + (kpLines.length ? KP_GAP + kpH : 0) + BODY_GAP + 26;
    const cardH = contentTop + contentLines.length * LINE_H + PAD_BOTTOM - 10;
    return { msg, m, st, name, kpLines, contentLines, cardH };
  });

  const verdictH = 8 + 34 + 20 + 18 + 42 + (clean(verdict?.consensus) ? 42 : 0) + (clean(verdict?.mainRisk) ? 38 : 0);
  const teaserH = unshownNames.length ? 16 + 98 + 22 : 0;
  const qrBlockH = 40 + 160 + 14 + 44 + 30;

  let H = 96 + 50 + titleLines.length * 66 + 20 + 46;
  if (hostLines.length) H += 38 + hostLines.length * LINE_H + 42;
  for (const c of cards) H += c.cardH + 26;
  H += verdictH + teaserH + qrBlockH + 90;
  H = Math.max(1600, Math.ceil(H));

  // ── 创建画布 ──
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // 背景
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#fdfbf6');
  bg.addColorStop(1, '#f3eee3');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(150, 130, 20, 150, 130, 420);
  glow.addColorStop(0, 'rgba(154,120,48,0.10)');
  glow.addColorStop(1, 'rgba(154,120,48,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  let y = 0;

  // 品牌 + 议题
  ctx.font = `500 20px ${FONT_MONO}`;
  ctx.fillStyle = DIM;
  ctx.fillText('MASTER DEBATE · 大师吵股', MARGIN, 78);
  ctx.font = `500 22px ${FONT_MONO}`;
  ctx.fillStyle = GOLD;
  ctx.fillText('本 期 议 题', MARGIN, 128);

  // 大标题
  ctx.font = `700 52px ${FONT_SERIF}`;
  ctx.fillStyle = INK;
  let ty = 186;
  for (const ln of titleLines) {
    ctx.fillText(ln, MARGIN, ty);
    ty += 66;
  }
  y = ty + 18;
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y);
  ctx.lineTo(MARGIN + 320, y);
  ctx.stroke();
  y += 46;

  // 主持人开场（完整展示，最多 6 行）
  if (hostLines.length) {
    const host = masterMap[hostId] || masters[0];
    ctx.font = `600 24px ${FONT_SANS}`;
    ctx.fillStyle = GOLD;
    ctx.fillText(`主持人 · ${host?.name || '大师'}`, MARGIN, y);
    y += 38;
    ctx.font = `400 26px ${FONT_SERIF}`;
    ctx.fillStyle = '#5a564e';
    for (const ln of hostLines) {
      ctx.fillText(ln, MARGIN, y);
      y += LINE_H;
    }
    y += 42;
  }

  // 大师观点卡片（正文完整展示，最多 6 行）
  const avatarCache = {};
  for (const c of cards) {
    const { m, st, name, kpLines, contentLines, cardH } = c;
    const cardX = MARGIN;
    ctx.fillStyle = hexA(st.color, 0.05);
    roundedRect(ctx, cardX, y, CARD_W, cardH, 18);
    ctx.fill();
    ctx.strokeStyle = hexA(st.color, 0.35);
    ctx.lineWidth = 1.5;
    roundedRect(ctx, cardX, y, CARD_W, cardH, 18);
    ctx.stroke();
    ctx.fillStyle = st.color;
    roundedRect(ctx, cardX, y + 24, 6, cardH - 48, 3);
    ctx.fill();

    let cy = y + PAD_TOP;
    let img = null;
    if (m?.avatar) {
      if (!avatarCache[m.id]) {
        try { avatarCache[m.id] = await loadImage(m.avatar); } catch (e) { avatarCache[m.id] = null; }
      }
      img = avatarCache[m.id];
    }
    const avatarCY = cy + 24;
    if (img) drawAvatar(ctx, img, cardX + 48, avatarCY, 28);
    else { ctx.font = `600 30px ${FONT_SANS}`; ctx.fillStyle = MUTED; ctx.fillText(m?.emoji || '💬', cardX + 28, avatarCY + 10); }

    ctx.font = `700 34px ${FONT_SANS}`;
    ctx.fillStyle = INK;
    const nameW = ctx.measureText(name).width;
    ctx.fillText(name, cardX + 90, avatarCY + 10);

    const badge = ` ${st.label} `;
    ctx.font = `500 20px ${FONT_MONO}`;
    const bw = ctx.measureText(badge).width + 24;
    const badgeX = cardX + 90 + nameW + 16;
    ctx.fillStyle = hexA(st.color, 0.12);
    roundedRect(ctx, badgeX, avatarCY - 24, bw, 34, 17);
    ctx.fill();
    ctx.strokeStyle = hexA(st.color, 0.5);
    ctx.lineWidth = 1;
    roundedRect(ctx, badgeX, avatarCY - 24, bw, 34, 17);
    ctx.stroke();
    ctx.fillStyle = st.color;
    ctx.fillText(badge, badgeX + 12, avatarCY + 2);

    cy += NAME_H;
    if (kpLines.length) {
      cy += KP_GAP;
      ctx.font = `700 27px ${FONT_SANS}`;
      ctx.fillStyle = GOLD_BRIGHT;
      for (const ln of kpLines) {
        ctx.fillText(ln, cardX + CARD_PAD, cy + 30);
        cy += 40;
      }
    }
    cy += BODY_GAP;
    const bodyX = cardX + CARD_PAD;
    ctx.font = `400 26px ${FONT_SANS}`;
    for (const ln of contentLines) {
      drawRichLine(ctx, ln, bodyX, cy + 26);
      cy += LINE_H;
    }

    y += cardH + 26;
  }

  // 裁决
  const v = verdict || {};
  const total = (v.bullCount || 0) + (v.bearCount || 0) + (v.neutralCount || 0) || 1;
  y += 8;
  ctx.font = `700 32px ${FONT_SANS}`;
  ctx.fillStyle = GOLD;
  ctx.fillText('⚖ 智囊团裁决', MARGIN, y);
  y += 34;
  const barW = CARD_W;
  const barH = 20;
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  roundedRect(ctx, MARGIN, y, barW, barH, 10);
  ctx.fill();
  let bx = MARGIN;
  for (const s of [
    { c: '#2e7d57', n: v.bullCount || 0 },
    { c: '#9a7830', n: v.neutralCount || 0 },
    { c: '#c04040', n: v.bearCount || 0 },
  ]) {
    const w = barW * (s.n / total);
    if (w > 2) {
      ctx.fillStyle = s.c;
      roundedRect(ctx, bx, y, w, barH, 10);
      ctx.fill();
      bx += w;
    }
  }
  y += barH + 18;
  ctx.font = `500 24px ${FONT_SANS}`;
  ctx.fillStyle = '#2e7d57';
  ctx.fillText(`看多 ${v.bullCount || 0}`, MARGIN, y);
  ctx.fillStyle = '#9a7830';
  ctx.fillText(`中性 ${v.neutralCount || 0}`, MARGIN + 190, y);
  ctx.fillStyle = '#c04040';
  ctx.fillText(`看空 ${v.bearCount || 0}`, MARGIN + 380, y);
  y += 42;
  if (clean(v.consensus)) {
    ctx.font = `500 25px ${FONT_SANS}`;
    ctx.fillStyle = INK;
    for (const ln of wrapLines(ctx, `共识：${clean(v.consensus)}`, CARD_W, 1)) {
      ctx.fillText(ln, MARGIN, y);
      y += 38;
    }
    y += 4;
  }
  if (clean(v.mainRisk)) {
    ctx.font = `500 25px ${FONT_SANS}`;
    ctx.fillStyle = '#c04040';
    for (const ln of wrapLines(ctx, `风险：${clean(v.mainRisk)}`, CARD_W, 1)) {
      ctx.fillText(ln, MARGIN, y);
      y += 38;
    }
  }

  // 悬念引导
  if (unshownNames.length) {
    y += 16;
    ctx.fillStyle = 'rgba(154,120,48,0.08)';
    roundedRect(ctx, MARGIN, y, CARD_W, 98, 14);
    ctx.fill();
    ctx.strokeStyle = 'rgba(154,120,48,0.45)';
    ctx.lineWidth = 1.5;
    roundedRect(ctx, MARGIN, y, CARD_W, 98, 14);
    ctx.stroke();
    ctx.textAlign = 'center';
    ctx.font = `600 26px ${FONT_SANS}`;
    ctx.fillStyle = '#9a7830';
    ctx.fillText(`还有 ${unshownNames.length} 位大师也想聊聊这个话题`, W / 2, y + 40);
    ctx.font = `500 24px ${FONT_SANS}`;
    ctx.fillStyle = INK;
    for (const ln of wrapLines(ctx, `想知道 ${unshownNames.slice(0, 3).join('、')} 怎么看？扫码进网站问问他们吧`, CARD_W - 60, 1)) {
      ctx.fillText(ln, W / 2, y + 74);
    }
    ctx.textAlign = 'left';
    y += 98 + 22;
  }

  // 二维码
  y += 40;
  const qrSize = 160;
  const qrX = (W - qrSize) / 2;
  const siteUrl = getSiteUrl();
  try {
    const qrData = await QRCode.toDataURL(siteUrl, {
      width: qrSize * 4,
      margin: 0,
      color: { dark: '#1f1d19', light: '#ffffff' },
    });
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = qrData; });
    ctx.fillStyle = '#ffffff';
    roundedRect(ctx, qrX - 14, y - 14, qrSize + 28, qrSize + 28, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(154,120,48,0.5)';
    ctx.lineWidth = 2;
    roundedRect(ctx, qrX - 14, y - 14, qrSize + 28, qrSize + 28, 12);
    ctx.stroke();
    ctx.drawImage(img, qrX, y, qrSize, qrSize);
  } catch (e) { /* 二维码失败不阻塞 */ }

  ctx.textAlign = 'center';
  ctx.font = `600 26px ${FONT_SANS}`;
  ctx.fillStyle = INK;
  ctx.fillText('扫码访问「大师吵股」', W / 2, y + qrSize + 44);
  ctx.font = `400 21px ${FONT_MONO}`;
  ctx.fillStyle = MUTED;
  ctx.fillText(`${siteUrl.replace(/^https?:\/\//, '')} · 查看完整辩论与最新数据`, W / 2, y + qrSize + 76);
  ctx.textAlign = 'left';

  return canvas;
}
