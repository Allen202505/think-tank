'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy, Share2, X } from 'lucide-react';
import { FEATURE_USED_EVENT, SHARE_PANEL_EVENT, SHARE_PROMPT_KEY, buildShareCopy, copyShareInvite, openSharePanel } from '../lib/shareInvite';
import styles from './ShareInvite.module.css';

export default function ShareInvite() {
  const [promptOpen, setPromptOpen] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const hideTimerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const seenRef = useRef(false);

  const markSeen = useCallback(() => {
    try { localStorage.setItem(SHARE_PROMPT_KEY, '1'); } catch (e) { /* ignore */ }
  }, []);

  useEffect(() => {
    try { seenRef.current = localStorage.getItem(SHARE_PROMPT_KEY) === '1'; } catch (e) { /* ignore */ }
    const onFeatureUsed = () => {
      if (seenRef.current) return;
      seenRef.current = true;
      markSeen();
      setPanelOpen(false);
      setPromptOpen(true);
      clearTimeout(hideTimerRef.current);
      hideTimerRef.current = setTimeout(() => setPromptOpen(false), 10000);
    };
    const onOpenPanel = () => { setPromptOpen(false); setPanelOpen(true); };
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      setPromptOpen(false);
      setPanelOpen(false);
    };
    window.addEventListener(FEATURE_USED_EVENT, onFeatureUsed);
    window.addEventListener(SHARE_PANEL_EVENT, onOpenPanel);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener(FEATURE_USED_EVENT, onFeatureUsed);
      window.removeEventListener(SHARE_PANEL_EVENT, onOpenPanel);
      window.removeEventListener('keydown', onKeyDown);
      clearTimeout(hideTimerRef.current);
      clearTimeout(closeTimerRef.current);
    };
  }, [markSeen]);

  const copy = useCallback(async () => {
    const ok = await copyShareInvite();
    if (!ok) return;
    setCopied(true);
    markSeen();
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setPromptOpen(false);
      setPanelOpen(false);
      setCopied(false);
    }, 2200);
  }, [markSeen]);

  const closePrompt = () => {
    clearTimeout(hideTimerRef.current);
    setPromptOpen(false);
  };

  const togglePanel = () => {
    closePrompt();
    setPanelOpen((value) => !value);
  };

  return (
    <>
      {promptOpen ? (
        <div className={styles.prompt} role="status" aria-live="polite">
          <div className={styles.promptBot} aria-hidden="true"><Share2 size={20} /></div>
          <div className={styles.promptCopy}>
            <strong>这个功能还不错？</strong>
            <p>把「大师吵股」推荐给一位朋友，让更多人一起用大师视角看投资。</p>
          </div>
          <button type="button" className={styles.copyBtn} onClick={copy} disabled={copied}>
            {copied ? <Check size={15} /> : <Copy size={15} />}
            {copied ? '已复制推荐文案' : '复制网站和推荐文案'}
          </button>
          <button type="button" className={styles.closePrompt} onClick={closePrompt} aria-label="关闭推荐提示">×</button>
        </div>
      ) : null}

      {panelOpen ? (
        <>
          <button type="button" className={styles.panelBackdrop} onClick={() => setPanelOpen(false)} aria-label="关闭分享面板" />
          <div className={styles.panel} role="dialog" aria-label="分享给好友">
            <div className={styles.panelHead}>
              <span aria-hidden="true"><Share2 size={18} /></span>
              <div>
                <strong>分享给好友</strong>
                <p>复制下面这段推荐文案，发给一位朋友。</p>
              </div>
              <button type="button" className={styles.closePanel} onClick={() => setPanelOpen(false)} aria-label="关闭分享面板"><X size={16} /></button>
            </div>
          <div className={styles.preview}>{buildShareCopy()}</div>
          <button type="button" className={styles.panelCopy} onClick={copy} disabled={copied}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? '已复制，去发给好友吧' : '复制链接和推荐文案'}
          </button>
            {copied ? <div className={styles.copyDone}>✓ 已复制到剪贴板</div> : null}
          </div>
        </>
      ) : null}

      <button type="button" className={styles.entry} onClick={togglePanel} aria-expanded={panelOpen} title="分享给好友">
        <span className={styles.bot} aria-hidden="true"><Share2 size={18} /></span>
        <span className={styles.entryText}>
          <strong>分享给好友</strong>
          <small>推荐大师吵股</small>
        </span>
      </button>
    </>
  );
}

export function ShareSidebarEntry() {
  return (
    <button type="button" className={styles.sidebarEntry} onClick={openSharePanel} title="分享给好友">
      <span className={styles.bot} aria-hidden="true"><Share2 size={18} /></span>
      <span className={styles.sidebarLabel}>分享给好友</span>
    </button>
  );
}
