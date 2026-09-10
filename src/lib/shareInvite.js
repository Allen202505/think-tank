'use client';

export const FEATURE_USED_EVENT = 'thinktank:feature-used';
export const SHARE_PROMPT_KEY = 'thinktank_share_prompt_seen_v1';
export const FEATURE_COMPLETION_KEY = 'thinktank_feature_completion_count_v1';
export const SHARE_PANEL_EVENT = 'thinktank:open-share-invite';

export function getShareSiteUrl() {
  const configured = String(process.env.NEXT_PUBLIC_SITE_URL || '').trim();
  if (!configured || /your-domain\.com|think-tank\.example\.com/i.test(configured)) {
    return 'https://yieldglide.com';
  }
  return /^https?:\/\//i.test(configured) ? configured.replace(/\/+$/, '') : `https://${configured.replace(/\/+$/, '')}`;
}

export function buildShareCopy() {
  return `我发现一个很好用的 AI 投资研究工具「大师吵股」：可以让大师围绕问题辩论、读财报，还能做行业周期分析和股票基本面研究。推荐你也试试：\n${getShareSiteUrl()}`;
}

export function notifyFeatureUsed(feature = '') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(FEATURE_USED_EVENT, { detail: { feature } }));
}

export function markFeatureCompleted(feature = '') {
  if (typeof window === 'undefined') return;
  let count = 0;
  try { count = Number(localStorage.getItem(FEATURE_COMPLETION_KEY) || 0) || 0; } catch (e) { /* ignore */ }
  const next = count + 1;
  try { localStorage.setItem(FEATURE_COMPLETION_KEY, String(next)); } catch (e) { /* ignore */ }
  if (next !== 2) return;
  window.setTimeout(() => notifyFeatureUsed(feature), 700);
}

export function openSharePanel() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SHARE_PANEL_EVENT));
}

export async function copyShareInvite() {
  const text = buildShareCopy();
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall back below */ }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch (e) {
    return false;
  }
}
