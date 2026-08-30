// 侧边浮层（.explain-drawer）可拖拽调宽：左边缘拖拽把手，宽度记忆到本地
'use client';
import { useState, useEffect, useCallback, useRef } from 'react';

const KEY = 'thinktank_drawer_width';
const DEFAULT = 560;   // 默认宽度（与现有 CSS min(560px,94vw) 一致）
const MIN = 320;       // 最窄
const MAX_RATIO = 0.94; // 最宽不超过视口的 94%

function readStored() {
  try {
    const w = Number(localStorage.getItem(KEY));
    if (Number.isFinite(w) && w >= MIN) return w;
  } catch (e) { /* ignore */ }
  return null;
}

export function useDrawerResize() {
  const [width, setWidth] = useState(DEFAULT);
  const widthRef = useRef(DEFAULT);
  useEffect(() => {
    const s = readStored();
    if (s) setWidth(s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
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
      try { localStorage.setItem(KEY, String(latest)); } catch (err) { /* ignore */ }
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }, []);

  const handleProps = { onMouseDown: onDragStart, title: '拖拽调整宽度', 'aria-label': '拖拽调整宽度' };
  const style = { width: `min(${width}px, 94vw)` };
  return { style, handleProps };
}
