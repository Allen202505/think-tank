'use client';

// 导入股票池弹窗（共享组件）：早餐「快捷创建我的股票池」与「选股池·导入股票池」两个入口共用。
// 交互与原选股池导入一致：类型（我的/大师）→ 输入方式（手动填写 / 文本或链接提取）→ 解析预览 → 创建。
// 创建结果直接写入 localStorage（thinktank_user_pools），各页自动同步。
import { useEffect, useRef, useState } from 'react';
import { PRESET_MASTERS } from '../data/masters';

const LS_KEY = 'thinktank_user_pools';

function loadUserPools() {
  try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; }
}
function saveUserPools(pools) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(pools)); } catch (e) { /* ignore */ }
}

const MASTER_OPTIONS = PRESET_MASTERS.map((m) => ({ value: m.name, label: m.name }));

export default function StockPoolImportModal({ open, onClose, initialType = 'mine', onCreated }) {
  const [importType, setImportType] = useState(initialType || 'mine');
  const [importMode, setImportMode] = useState('manual');
  const [masterSelect, setMasterSelect] = useState('');
  const [form, setForm] = useState({ name: '', source: '', stocks: '' });
  const [extractInput, setExtractInput] = useState('');
  const [extractLoading, setExtractLoading] = useState(false);
  const [extractError, setExtractError] = useState('');
  const [extracted, setExtracted] = useState([]);
  const [extractSource, setExtractSource] = useState('');
  const [extractEmpty, setExtractEmpty] = useState(false);
  const [manualPreview, setManualPreview] = useState([]);
  const [manualMissing, setManualMissing] = useState([]);
  const [manualResolving, setManualResolving] = useState(false);
  const [error, setError] = useState('');
  const lastInit = useRef(initialType);

  // 每次打开重置为初始类型（早餐快捷创建 → 我的股票池；选股池 → 按入口）
  useEffect(() => {
    if (open && lastInit.current !== initialType) {
      setImportType(initialType || 'mine');
      lastInit.current = initialType;
    }
    if (open) {
      setImportMode('manual');
      setMasterSelect('');
      setForm({ name: '', source: '', stocks: '' });
      setExtractInput('');
      setExtracted([]);
      setExtractSource('');
      setExtractError('');
      setExtractEmpty(false);
      setManualPreview([]);
      setManualMissing([]);
      setError('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const selectedMasterName = () => masterSelect.trim();

  const createPool = (name, source, symbols) => {
    const pool = {
      id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      name,
      source: source || '手动导入',
      createdAt: new Date().toISOString().slice(0, 10),
      symbols: [...new Set(symbols)],
    };
    saveUserPools([...loadUserPools(), pool]);
    return pool;
  };

  const nextPoolName = (isMaster) => {
    if (isMaster && selectedMasterName()) return `${selectedMasterName()} · 选股池`;
    const pools = loadUserPools();
    const prefix = isMaster ? '大师的股票池' : '我的股票池';
    const n = pools.filter((p) => p.name.startsWith(prefix)).length + 1;
    return `${prefix} ${n}`;
  };

  const parseManual = async () => {
    if (!form.stocks.trim()) { setError('请填写至少一只股票（名称或 6 位代码）'); return; }
    setManualResolving(true);
    setManualPreview([]);
    setManualMissing([]);
    setError('');
    try {
      const res = await fetch('/api/pools/resolve-names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: form.stocks }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '解析失败，请重试');
      setManualPreview(data.result.found || []);
      setManualMissing(data.result.missing || []);
    } catch (e) {
      setError(e.message || '解析失败，请重试');
    } finally {
      setManualResolving(false);
    }
  };

  const removeManualStock = (code) => setManualPreview((prev) => prev.filter((st) => st.code !== code));

  const submitManual = () => {
    const codes = manualPreview.map((st) => st.code);
    if (!codes.length) { setError('请先解析出至少一只股票'); return; }
    const isMaster = importType === 'master';
    if (isMaster && !selectedMasterName()) { setError('请先选择大师'); return; }
    const pool = createPool(nextPoolName(isMaster), isMaster ? '手动整理' : '手动导入', codes);
    if (onCreated) onCreated(pool);
    if (onClose) onClose();
  };

  const runExtract = async () => {
    const val = extractInput.trim();
    if (!val || extractLoading) return;
    setExtractLoading(true);
    setExtractError('');
    setExtracted([]);
    setExtractEmpty(false);
    const isUrl = /^https?:\/\/\S+$/i.test(val);
    try {
      const res = await fetch('/api/pools/extract', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isUrl ? { url: val } : { text: val }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || '提取失败，请重试');
      const stocks = (data.result && data.result.stocks) || [];
      setExtracted(stocks);
      setExtractSource((data.result && data.result.source) || '');
      setExtractEmpty(stocks.length === 0);
    } catch (e) {
      setExtractError(e.message || '提取失败，请重试');
    } finally {
      setExtractLoading(false);
    }
  };

  const removeExtracted = (code) => setExtracted((prev) => prev.filter((st) => st.code !== code));

  const submitExtracted = () => {
    const codes = extracted.map((st) => st.code);
    if (!codes.length) { setError('请先提取出至少一只股票'); return; }
    const isMaster = importType === 'master';
    if (isMaster && !selectedMasterName()) { setError('请先选择大师'); return; }
    const pool = createPool(nextPoolName(isMaster), extractSource || (isMaster ? '手动整理' : '手动导入'), codes);
    if (onCreated) onCreated(pool);
    if (onClose) onClose();
  };

  return (
    <>
      <div className="invite-drawer-backdrop" onClick={onClose} />
      <div className="invite-drawer" role="dialog" aria-modal="true" aria-labelledby="poolDrawerTitle" onClick={(e) => e.stopPropagation()}>
        <div className="invite-head invite-drawer-head">
          <h3 className="invite-title" id="poolDrawerTitle">导入股票池</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="invite-drawer-body">
          {error && <div className="mg-error">⚠ {error}</div>}

          <div className="sp-form sp-form-drawer">
            <div className="sp-form-label">导入类型</div>
            <div className="mg-mode" role="group" aria-label="导入类型">
              <button type="button" className={importType === 'mine' ? 'active' : ''} onClick={() => setImportType('mine')}>我的股票池</button>
              <button type="button" className={importType === 'master' ? 'active' : ''} onClick={() => setImportType('master')}>大师的股票池</button>
            </div>
            {importType === 'master' && (
              <>
                <div className="sp-form-label">选择大师</div>
                <select className="mg-input mg-input-line sp-master-select" value={masterSelect} onChange={(e) => setMasterSelect(e.target.value)}>
                  <option value="">请选择大师…</option>
                  {MASTER_OPTIONS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </>
            )}
            <div className="sp-form-label">输入方式</div>
            <div className="mg-mode" role="group" aria-label="输入方式">
              <button type="button" className={importMode === 'manual' ? 'active' : ''} onClick={() => setImportMode('manual')}>手动填写</button>
              <button type="button" className={importMode === 'extract' ? 'active' : ''} onClick={() => setImportMode('extract')}>文本或链接提取</button>
            </div>

            {importMode === 'manual' && (
              <>
                <textarea className="mg-input" rows={6} placeholder={'输入股票名称或 6 位代码，一行一个或用逗号/空格分隔，如：\n齐翔腾达\n300750 600519'} value={form.stocks} onChange={(e) => { setForm({ ...form, stocks: e.target.value }); setManualPreview([]); setManualMissing([]); }} />
                <button type="button" className="mg-btn" onClick={parseManual} disabled={!form.stocks.trim() || manualResolving}>
                  {manualResolving ? '正在解析…' : (manualPreview.length ? '重新解析' : '解析并预览')}
                </button>
                {manualMissing.length > 0 && (
                  <div className="sp-manual-missing">⚠ 以下名称未能识别，未纳入：{manualMissing.join('、')}</div>
                )}
                {manualPreview.length > 0 && (
                  <div className="sp-extract">
                    <div className="sp-extract-head">已解析 {manualPreview.length} 只，可删除不需要的：</div>
                    <div className="sp-extract-list">
                      {manualPreview.map((st) => (
                        <div key={st.code} className="sp-extract-item">
                          <span className="mono">{st.code}</span>
                          <span className="sp-extract-name">{st.name || '—'}</span>
                          <button type="button" className="sp-extract-del" onClick={() => removeManualStock(st.code)} aria-label="删除">✕</button>
                        </div>
                      ))}
                    </div>
                    <button type="button" className="mg-btn" onClick={submitManual} disabled={!manualPreview.length}>创建股票池</button>
                  </div>
                )}
              </>
            )}

            {importMode === 'extract' && (
              <>
                <textarea className="mg-input" rows={4} placeholder="粘贴报道全文，或云文档 / 网页链接（https://…）" value={extractInput} onChange={(e) => { setExtractInput(e.target.value); setExtractEmpty(false); }} />
                <button type="button" className="mg-btn" onClick={runExtract} disabled={!extractInput.trim() || extractLoading}>
                  {extractLoading ? '正在提取…' : '提取股票'}
                </button>
                {extractError && <div className="mg-error">⚠ {extractError}</div>}
                {extracted.length > 0 && (
                  <div className="sp-extract">
                    <div className="sp-extract-head">提取到 {extracted.length} 只标的，可删除不需要的：</div>
                    <div className="sp-extract-list">
                      {extracted.map((st) => (
                        <div key={st.code} className="sp-extract-item">
                          <span className="mono">{st.code}</span>
                          <span className="sp-extract-name">{st.name || '待确认'}</span>
                          <button type="button" className="sp-extract-del" onClick={() => removeExtracted(st.code)} aria-label="删除">✕</button>
                        </div>
                      ))}
                    </div>
                    <button type="button" className="mg-btn" onClick={submitExtracted} disabled={!extracted.length}>提交到选股池</button>
                  </div>
                )}
                {extractEmpty && (
                  <div className="sp-suggest-empty">
                    <div className="sp-suggest-empty-title">没有提取到 A 股标的</div>
                    <p className="sp-suggest-empty-desc">可换个链接或文本重试，或切换到「手动填写」直接输入 6 位代码。</p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
