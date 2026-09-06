// 侧边浮层（.explain-drawer）可拖拽调宽：左边缘拖拽把手，宽度记忆到本地
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

const KEY = 'thinktank_drawer_width';
const KEY_TERM_LIB = 'thinktank_term_lib_drawer_width';
const DEFAULT = 560;   // 默认宽度（与现有 CSS min(560px,94vw) 一致）
const DEFAULT_TERM_LIB = 1200; // 词条库浮层默认更宽（对齐“红色标注”宽度）
const MIN = 320;       // 最窄
const MAX_RATIO = 0.94; // 最宽不超过视口的 94%

function readStored(key) {
  try {
    const w = Number(localStorage.getItem(key));
    if (Number.isFinite(w) && w >= MIN) return w;
  } catch (e) { /* ignore */ }
  return null;
}

export { KEY_TERM_LIB, DEFAULT_TERM_LIB };
export function useDrawerResize({ defaultWidth = DEFAULT, storageKey = KEY } = {}) {
  const [width, setWidth] = useState(defaultWidth);
  const widthRef = useRef(defaultWidth);
  useEffect(() => {
    const s = readStored(storageKey);
    if (s) setWidth(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);
  useEffect(() => { widthRef.current = width; }, [width]);

  const onDragStart = useCallback((e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = widthRef.current;
    let latest = startW; // 同步记录最新宽度，避免 ref 异步导致持久化的是中途值
    const move = (ev) => {
      const next = Math.min(window.innerWidth * MAX_RATIO, Math.max(MIN, startW + (startX - ev.clientX)));
      latest = next;
      setWidth(next);
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      try { localStorage.setItem(storageKey, String(latest)); } catch (err) { /* ignore */ }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, [storageKey]);

  const handleProps = { onMouseDown: onDragStart, title: '拖拽调整宽度', 'aria-label': '拖拽调整宽度' };
  const style = { width: `min(${width}px, 94vw)` };
  return { style, handleProps };
}
