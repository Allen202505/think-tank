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
function wrapLines(ctx, text, maxWidth, maxLines) {
  const s = String(text || '');
  const lines = [];
  let line = '';
  let truncated = false;
  // 数字(含单位)聚成原子 token 不拆行；其余按字符逐字折行
  const chars = [];
  const re = /-?\d+(?:\.\d+)?(?:万亿|亿|万|倍|%|％)?|[\s\S]/g;
  let m;
  while ((m = re.exec(s)) !== null) chars.push(m[0]);
  for (const ch of chars) {
    if (line && ctx.measureText(line + ch).width > maxWidth) {
      if (lines.length >= maxLines - 1) { truncated = true; break; }
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (truncated) {
    let last = lines.length ? lines[lines.length - 1] : '';
    while (last.length && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1);
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
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const masterMap = Object.fromEntries(masters.map((m) => [m.id, m]));

  // ── 背景 ──
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

  // ── 品牌（弱化） ──
  ctx.font = `500 20px ${FONT_MONO}`;
  ctx.fillStyle = DIM;
  ctx.fillText('MASTER DEBATE · 大师吵股', MARGIN, 78);

  // ── 议题小标签 ──
  ctx.font = `500 22px ${FONT_MONO}`;
  ctx.fillStyle = GOLD;
  ctx.fillText('本 期 议 题', MARGIN, 128);

  // ── 大标题 = 用户问题 ──
  ctx.font = `700 52px ${FONT_SERIF}`;
  ctx.fillStyle = INK;
  const titleLines = wrapLines(ctx, question || '（未提供问题）', W - MARGIN * 2, 2);
  let ty = 186;
  for (const ln of titleLines) {
    ctx.fillText(ln, MARGIN, ty);
    ty += 66;
  }
  y = ty + 18;

  // 金色分隔线
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(MARGIN, y);
  ctx.lineTo(MARGIN + 320, y);
  ctx.stroke();
  y += 46;

  // ── 主持人开场 ──
  if (hostOpening) {
    const host = masterMap[hostId] || masters[0];
    ctx.font = `600 24px ${FONT_SANS}`;
    ctx.fillStyle = GOLD;
    ctx.fillText(`主持人 · ${host?.name || '大师'}`, MARGIN, y);
    y += 38;
    ctx.font = `400 26px ${FONT_SERIF}`;
    ctx.fillStyle = '#5a564e';
    for (const ln of wrapLines(ctx, hostOpening, W - MARGIN * 2, 2)) {
      ctx.fillText(ln, MARGIN, y);
      y += 40;
    }
    y += 42;
  }

  // ── 大师观点卡片：精选最多 2 位（优先一多一空，辩论感更强） ──
  const bullPick = discussion.find((m) => m.stance === 'BULL');
  const bearPick = discussion.find((m) => m.stance === 'BEAR');
  const shown = bullPick && bearPick ? [bullPick, bearPick] : discussion.slice(0, 2);
  const avatarCache = {};
  const CARD_W = W - MARGIN * 2;
  const CARD_PAD = 30;
  const PAD_TOP = 44;
  const PAD_BOTTOM = 36;
  const LINE_H = 40;
  const NAME_H = 60;
  const KP_GAP = 8;
  const BODY_GAP = 30;

  for (const msg of shown) {
    const m = masterMap[msg.investorId];
    const st = STANCE[msg.stance] || STANCE.NEUTRAL;
    const name = m?.name || '大师';
    let keyPoint = clean(msg.keyPoint);
    keyPoint = keyPoint.replace(/^观点[：:]\s*/, ''); // 避免重复"观点："前缀

    // 先测量，确定行数与卡片高度（避免内容溢出/空档）
    ctx.font = `400 26px ${FONT_SANS}`;
    const contentLines = wrapLines(ctx, msg.content || '', CARD_W - CARD_PAD * 2 - 14, 2);
    ctx.font = `700 27px ${FONT_SANS}`;
    const kpLines = keyPoint ? wrapLines(ctx, `观点：${keyPoint}`, CARD_W - CARD_PAD * 2 - 14, 2) : [];
    const kpH = kpLines.length * 40;
    const contentTop = PAD_TOP + NAME_H + (kpLines.length ? KP_GAP + kpH : 0) + BODY_GAP + 26;
    const cardH = contentTop + contentLines.length * LINE_H + PAD_BOTTOM - 10;

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

    // 头像 + 姓名 + 立场徽章
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

    // 观点标签（最多 2 行，正常折行）
    if (kpLines.length) {
      cy += KP_GAP;
      ctx.font = `700 27px ${FONT_SANS}`;
      ctx.fillStyle = GOLD_BRIGHT;
      for (const ln of kpLines) {
        ctx.fillText(ln, cardX + CARD_PAD, cy + 30);
        cy += 40;
      }
    }

    // 发言内容（数字高亮）
    cy += BODY_GAP;
    const bodyX = cardX + CARD_PAD;
    ctx.font = `400 26px ${FONT_SANS}`;
    for (const ln of contentLines) {
      drawRichLine(ctx, ln, bodyX, cy + 26);
      cy += LINE_H;
    }

    y += cardH + 26;
  }

  // ── 裁决区 ──
  const v = verdict || {};
  const total = (v.bullCount || 0) + (v.bearCount || 0) + (v.neutralCount || 0) || 1;
  y += 8;
  ctx.font = `700 32px ${FONT_SANS}`;
  ctx.fillStyle = GOLD;
  ctx.fillText('⚖ 智囊团裁决', MARGIN, y);
  y += 34;
  const barW = W - MARGIN * 2;
  const barH = 24;
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  roundedRect(ctx, MARGIN, y, barW, barH, 12);
  ctx.fill();
  let bx = MARGIN;
  for (const s of [
    { c: '#4caf7d', n: v.bullCount || 0 },
    { c: '#c9a84c', n: v.neutralCount || 0 },
    { c: '#e05555', n: v.bearCount || 0 },
  ]) {
    const w = barW * (s.n / total);
    if (w > 2) {
      ctx.fillStyle = s.c;
      roundedRect(ctx, bx, y, w, barH, 12);
      ctx.fill();
      bx += w;
    }
  }
  y += barH + 20;
  ctx.font = `500 24px ${FONT_SANS}`;
  ctx.fillStyle = '#4caf7d';
  ctx.fillText(`看多 ${v.bullCount || 0}`, MARGIN, y);
  ctx.fillStyle = '#c9a84c';
  ctx.fillText(`中性 ${v.neutralCount || 0}`, MARGIN + 190, y);
  ctx.fillStyle = '#e05555';
  ctx.fillText(`看空 ${v.bearCount || 0}`, MARGIN + 380, y);
  y += 46;
  if (v.consensus) {
    ctx.font = `500 25px ${FONT_SANS}`;
    ctx.fillStyle = INK;
    for (const ln of wrapLines(ctx, `共识：${clean(v.consensus)}`, W - MARGIN * 2, 1)) {
      ctx.fillText(ln, MARGIN, y);
      y += 38;
    }
    y += 4;
  }
  if (v.mainRisk) {
    ctx.font = `500 25px ${FONT_SANS}`;
    ctx.fillStyle = '#e05555';
    for (const ln of wrapLines(ctx, `风险：${clean(v.mainRisk)}`, W - MARGIN * 2, 1)) {
      ctx.fillText(ln, MARGIN, y);
      y += 38;
    }
  }

  // ── 二维码（引导扫码访问网站） ──
  y += 40;
  const qrSize = 176;
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
    // 白色二维码卡片 + 金边
    ctx.fillStyle = '#ffffff';
    roundedRect(ctx, qrX - 14, y - 14, qrSize + 28, qrSize + 28, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(154,120,48,0.5)';
    ctx.lineWidth = 2;
    roundedRect(ctx, qrX - 14, y - 14, qrSize + 28, qrSize + 28, 12);
    ctx.stroke();
    ctx.drawImage(img, qrX, y, qrSize, qrSize);
  } catch (e) { /* 二维码生成失败不阻塞 */ }

  ctx.textAlign = 'center';
  ctx.font = `600 26px ${FONT_SANS}`;
  ctx.fillStyle = INK;
  ctx.fillText('扫码访问「大师吵股」', W / 2, y + qrSize + 44);
  ctx.font = `400 21px ${FONT_MONO}`;
  ctx.fillStyle = MUTED;
  ctx.fillText(`${siteUrl.replace(/^https?:\/\//, '')} · 查看完整辩论与最新数据`, W / 2, y + qrSize + 76);
  ctx.textAlign = 'left';

  // ── 页脚 ──
  const date = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' });
  ctx.font = `400 21px ${FONT_MONO}`;
  ctx.fillStyle = DIM;
  ctx.fillText(`yieldglide.com · ${date} · 仅供研究参考，不构成投资建议`, MARGIN, H - 56);

  return canvas;
}
