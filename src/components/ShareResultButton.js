'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Loader2, Share2 } from 'lucide-react';
import styles from './ShareResultButton.module.css';

async function copyText(value) {
  const text = String(value || '');
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
  } catch {
    return false;
  }
}

export default function ShareResultButton({
  kind,
  title,
  payload,
  resetKey = '',
  disabled = false,
  className = '',
  label = '分享链接',
}) {
  const [state, setState] = useState('idle'); // idle | creating | copied | error
  const busyRef = useRef(false);
  const [url, setUrl] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    setState('idle');
    setUrl('');
    setMessage('');
  }, [resetKey]);

  const handleClick = async () => {
    if (disabled || busyRef.current) return;
    busyRef.current = true;
    let nextUrl = url;
    try {
      if (!nextUrl) {
        setState('creating');
        setMessage('正在生成公开链接…');
        const response = await fetch('/api/share-results', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kind, title, payload }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok || !data.path) {
          throw new Error(data.error || '分享链接生成失败');
        }
        nextUrl = new URL(data.path, window.location.origin).toString();
        setUrl(nextUrl);
      }

      const copied = await copyText(nextUrl);
      if (!copied) throw new Error('链接已生成，请手动复制浏览器地址');
      setState('copied');
      setMessage('已复制，打开链接即可查看完整内容');
      window.setTimeout(() => {
        setState((current) => current === 'copied' ? 'idle' : current);
        setMessage('');
      }, 3200);
    } catch (error) {
      setState('error');
      setMessage(error?.message || '分享失败，请稍后重试');
    } finally {
      busyRef.current = false;
    }
  };

  const isCopied = state === 'copied';
  const isCreating = state === 'creating';
  const isError = state === 'error';

  return (
    <span className={`${styles.wrap} ${className}`.trim()}>
      <button
        type="button"
        className={`${styles.button}${isCopied ? ` ${styles.done}` : ''}${isError ? ` ${styles.error}` : ''}`}
        onClick={handleClick}
        disabled={disabled || isCreating}
        title={disabled ? '结果生成完成后可分享' : '生成公开只读链接并复制'}
      >
        {isCreating ? <Loader2 size={14} className={styles.spinner} /> : isCopied ? <Check size={14} /> : <Share2 size={14} />}
        {isCreating ? '生成中' : isCopied ? '已复制' : label}
      </button>
      {message ? <span className={`${styles.status}${isError ? ` ${styles.error}` : ''}`} role="status">{message}</span> : null}
    </span>
  );
}
