'use client';

import { useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import styles from './ShareLinkActions.module.css';

async function copyText(value) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (e) { /* fall through */ }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export default function ShareLinkActions({ title = '大师吵股分析结果' }) {
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState('');

  const copy = async () => {
    const url = window.location.href;
    const ok = await copyText(url);
    setCopied(ok);
    setStatus(ok ? '链接已复制' : '复制失败，请从地址栏复制');
    window.setTimeout(() => {
      setCopied(false);
      setStatus('');
    }, 2600);
  };

  const share = async () => {
    const url = window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title, text: title, url });
        setStatus('已唤起系统分享');
        window.setTimeout(() => setStatus(''), 2600);
        return;
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
    await copy();
  };

  return (
    <div className={styles.actions}>
      <button type="button" className={styles.button} onClick={share}>
        <Share2 size={16} />
        分享给朋友
      </button>
      <button type="button" className={`${styles.button} ${styles.secondary}`} onClick={copy}>
        {copied ? <Check size={16} /> : <Copy size={16} />}
        {copied ? '已复制' : '复制链接'}
      </button>
      <span className={styles.status} role="status">{status}</span>
    </div>
  );
}
