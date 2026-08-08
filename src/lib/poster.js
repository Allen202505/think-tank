// poster.js —— 客户端生成辩论分享海报（#10）
// 把一场「大师吵股」辩论渲染成 9:16 竖版图片，供用户保存/分享到微信等
const W = 1080;
const H = 1920;

const GOLD = '#c9a84c';
const INK = '#e8e4d8';
const MUTED = '#8a8aa0';
const DIM = '#5a5a7a';
const STANCE = {
  BULL: { label: '看多 ▲', color: '#4caf7d' },
  BEAR: { label: '看空 ▼', color: '#e05555' },
  NEUTRAL: { label: '中性 —', color: '#c9a84c' },
};

function wrapText(ctx, text, maxWidth) {
  const lines = [];
  let line = '';
  for (const ch of String(text || '')) {
    if (ctx.measureText(line + ch).width > maxWidth && line) {
      lines.push(line);
      line = ch;
    } else {
      line += ch;
    }
  }
  if (line) lines.push(line);
  return lines;
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

function drawAvatar(ctx, img, cx, cy, r) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(201,168,76,0.85)';
  ctx.lineWidth = 4;
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

  const serif = '"Songti SC","SimSun",Georgia,serif';
  const sans = '"PingFang SC","Heiti SC",-apple-system,"Microsoft YaHei",sans-serif';
  const mono = '"SF Mono","Consolas",monospace';

  // 背景渐变 + 金色光晕
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, '#12121c');
  bg.addColorStop(1, '#0a0a0f');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(160, 150, 20, 160, 150, 440);
  glow.addColorStop(0, 'rgba(201,168,76,0.16)');
  glow.addColorStop(1, 'rgba(201,168,76,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  let y = 0;

  // 顶部
  ctx.font = `500 24px ${mono}`;
  ctx.fillStyle = GOLD;
  ctx.fillText('MASTER DEBATE · 大师吵股', 70, 92);
  ctx.font = `700 92px ${serif}`;
  ctx.fillStyle = INK;
  ctx.fillText('大师吵股', 70, 226);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(70, 276);
  ctx.lineTo(520, 276);
  ctx.stroke();

  y = 356;

  // 问题
  ctx.font = `600 30px ${sans}`;
  ctx.fillStyle = GOLD;
  ctx.fillText('你 的 问 题', 70, y);
  y += 58;
  ctx.font = `500 34px ${sans}`;
  ctx.fillStyle = INK;
  for (const ln of wrapText(ctx, question || '（无）', 940).slice(0, 4)) {
    ctx.fillText(ln, 70, y);
    y += 50;
  }
  y += 34;

  // 主持人开场
  if (hostOpening) {
    const host = masterMap[hostId] || masters[0];
    ctx.font = `600 26px ${sans}`;
    ctx.fillStyle = MUTED;
    ctx.fillText(`主持人 · ${host?.name || ''} 开场`, 70, y);
    y += 46;
    ctx.font = `500 30px ${sans}`;
    ctx.fillStyle = '#cfcbbf';
    for (const ln of wrapText(ctx, hostOpening, 940).slice(0, 3)) {
      ctx.fillText(ln, 70, y);
      y += 46;
    }
    y += 40;
  }

  // 大师发言（最多 4 条）
  const avatarCache = {};
  for (const msg of discussion.slice(0, 4)) {
    const m = masterMap[msg.investorId];
    const st = STANCE[msg.stance] || STANCE.NEUTRAL;
    const name = m?.name || '大师';
    // 头像
    let img = null;
    if (m?.avatar) {
      if (!avatarCache[m.id]) {
        try {
          avatarCache[m.id] = await loadImage(m.avatar);
        } catch (e) {
          avatarCache[m.id] = null;
        }
      }
      img = avatarCache[m.id];
    }
    const avatarCy = y + 44;
    if (img) {
      drawAvatar(ctx, img, 116, avatarCy, 46);
    } else {
      ctx.font = `700 44px ${sans}`;
      ctx.fillStyle = MUTED;
      ctx.fillText(m?.emoji || '💬', 82, avatarCy + 16);
    }
    // 名字 + 立场
    ctx.font = `700 28px ${sans}`;
    ctx.fillStyle = INK;
    ctx.fillText(name, 176, y + 30);
    ctx.font = `500 22px ${mono}`;
    ctx.fillStyle = st.color;
    ctx.fillText(st.label, 176 + ctx.measureText(name).width + 16, y + 30);
    y += 58;
    // 发言气泡
    const lines = wrapText(ctx, msg.content || '', 900).slice(0, 4);
    const boxH = lines.length * 46 + 30;
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    roundedRect(ctx, 176, y, 834, boxH, 18);
    ctx.fill();
    ctx.strokeStyle = st.color + '55';
    ctx.lineWidth = 2;
    roundedRect(ctx, 176, y, 834, boxH, 18);
    ctx.stroke();
    ctx.font = `400 27px ${sans}`;
    ctx.fillStyle = '#d8d4c8';
    let ty = y + 52;
    for (const ln of lines) {
      ctx.fillText(ln, 200, ty);
      ty += 46;
    }
    y += boxH + 36;
  }

  // 裁决
  const v = verdict || {};
  const total = (v.bullCount || 0) + (v.bearCount || 0) + (v.neutralCount || 0) || 1;
  y += 8;
  ctx.font = `700 34px ${sans}`;
  ctx.fillStyle = GOLD;
  ctx.fillText('⚖ 智囊团裁决', 70, y);
  y += 42;
  const barW = 940;
  const barH = 26;
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  roundedRect(ctx, 70, y, barW, barH, 13);
  ctx.fill();
  let bx = 70;
  for (const s of [
    { c: '#4caf7d', n: v.bullCount || 0 },
    { c: '#c9a84c', n: v.neutralCount || 0 },
    { c: '#e05555', n: v.bearCount || 0 },
  ]) {
    const w = barW * (s.n / total);
    if (w > 2) {
      ctx.fillStyle = s.c;
      roundedRect(ctx, bx, y, w, barH, 13);
      ctx.fill();
      bx += w;
    }
  }
  y += barH + 24;
  ctx.font = `500 26px ${sans}`;
  ctx.fillStyle = '#4caf7d';
  ctx.fillText(`看多 ${v.bullCount || 0}`, 70, y);
  ctx.fillStyle = '#c9a84c';
  ctx.fillText(`中性 ${v.neutralCount || 0}`, 260, y);
  ctx.fillStyle = '#e05555';
  ctx.fillText(`看空 ${v.bearCount || 0}`, 450, y);
  y += 54;
  if (v.consensus) {
    ctx.font = `500 26px ${sans}`;
    ctx.fillStyle = INK;
    for (const ln of wrapText(ctx, `共识：${v.consensus}`, 940).slice(0, 2)) {
      ctx.fillText(ln, 70, y);
      y += 40;
    }
    y += 6;
  }
  if (v.mainRisk) {
    ctx.font = `500 26px ${sans}`;
    ctx.fillStyle = '#e05555';
    for (const ln of wrapText(ctx, `风险：${v.mainRisk}`, 940).slice(0, 2)) {
      ctx.fillText(ln, 70, y);
      y += 40;
    }
  }

  // 页脚
  const date = new Date().toLocaleDateString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
  });
  ctx.font = `400 22px ${mono}`;
  ctx.fillStyle = DIM;
  ctx.fillText(`yieldglide.com · ${date} · 仅供研究参考，不构成投资建议`, 70, H - 64);

  return canvas;
}
