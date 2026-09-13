'use client';

import { useEffect, useRef, useState } from 'react';
import { FileUp, Plus } from 'lucide-react';
import { snapColorToPalette } from '../data/masters';
import styles from './MasterLeague.module.css';

function slugify(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fa5-]/g, '').slice(0, 28);
}

function parseSkill(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export default function MasterLeagueInviteDrawer({ open, onClose, onAddMaster }) {
  const [name, setName] = useState('');
  const [title, setTitle] = useState('');
  const [style, setStyle] = useState('');
  const [prompt, setPrompt] = useState('');
  const [skillText, setSkillText] = useState('');
  const [skillFileName, setSkillFileName] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setError('');
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const onFile = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > 300 * 1024) {
      setError('Skill 文件请控制在 300KB 以内');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const parsed = parseSkill(text);
      setSkillText(text);
      setSkillFileName(file.name);
      if (parsed) {
        setName((current) => current || parsed.name || '');
        setTitle((current) => current || parsed.title || '');
        setStyle((current) => current || parsed.style || '');
        setPrompt((current) => current || parsed.prompt || parsed.knowledge || '');
      }
      setError('');
    };
    reader.readAsText(file);
  };

  const submit = async () => {
    const cleanName = name.trim();
    if (!cleanName) {
      setError('请填写大师名称');
      return;
    }
    if (!prompt.trim() && !skillText.trim()) {
      setError('请写一段投资提示词，或上传 Skill 文件');
      return;
    }
    const parsed = parseSkill(skillText);
    const master = {
      id: `custom_league_${Date.now()}_${slugify(cleanName) || 'master'}`,
      name: cleanName,
      nameEn: '',
      emoji: parsed?.emoji || '🧩',
      color: snapColorToPalette(parsed?.color || '#7d5f1f'),
      avatar: '',
      status: 'alive',
      source: 'custom',
      title: title.trim() || parsed?.title || '公开赛挑战者',
      titleEn: '',
      style: style.trim() || parsed?.style || '自定义投资策略',
      styleEn: '',
      personality: parsed?.personality || '按照用户提供的提示词和 Skill 独立决策，风格鲜明，允许犯错并复盘。',
      quote: parsed?.quote || '让真实比赛结果检验这套方法。',
      biography: parsed?.biography || '由用户邀请参加大师实盘公开赛，初始额度 10 万元。',
      classicTheory: parsed?.classicTheory || style.trim() || '自定义投资框架',
      knowledge: parsed?.knowledge || prompt.trim(),
      coreViews: parsed?.coreViews || '',
      phrases: parsed?.phrases || '',
      decisionHabits: parsed?.decisionHabits || prompt.trim(),
      riskPref: parsed?.riskPref || '自定义风险偏好',
      styleSample: parsed?.styleSample || '',
      intro: parsed?.intro || `用户邀请的公开赛挑战者，按照「${style.trim() || '自定义策略'}」参与比赛。`,
      aShareAngle: parsed?.aShareAngle || prompt.trim().slice(0, 100) || '自定义 A 股投资策略',
      leaguePrompt: prompt.trim(),
      leagueSkill: skillText.trim().slice(0, 1200),
      leagueSkillName: skillFileName,
    };
    setSubmitting(true);
    try {
      await onAddMaster(master);
      setName('');
      setTitle('');
      setStyle('');
      setPrompt('');
      setSkillText('');
      setSkillFileName('');
      setError('');
      onClose();
    } catch (submitError) {
      setError(submitError?.message || '邀请发布失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <div className="invite-drawer-backdrop" onClick={onClose} />
      <div className="invite-drawer" role="dialog" aria-modal="true" aria-labelledby="leagueInviteTitle" onClick={(event) => event.stopPropagation()}>
        <div className="invite-head invite-drawer-head">
          <h3 className="invite-title" id="leagueInviteTitle">邀请大师参赛</h3>
          <button type="button" className="modal-close" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <div className="invite-drawer-body">
          <p className="invite-desc">填写人物设定，或上传投资风格与习惯 Skill。参赛后自动获得 10 万元初始额度，并同步到大师 PK 成员库。</p>
          <div className={styles.drawerField}><label className="invite-label" htmlFor="league-master-name">大师名称 *</label><input id="league-master-name" className="invite-input" value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：趋势猎手阿远" autoFocus /></div>
          <div className={styles.drawerField}><label className="invite-label" htmlFor="league-master-title">称号</label><input id="league-master-title" className="invite-input" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：纪律型趋势玩家" /></div>
          <div className={styles.drawerField}><label className="invite-label" htmlFor="league-master-style">投资风格</label><input id="league-master-style" className="invite-input" value={style} onChange={(event) => setStyle(event.target.value)} placeholder="例如：突破、趋势、严格止损" /></div>
          <div className={styles.drawerField}><label className="invite-label" htmlFor="league-master-prompt">投资提示词</label><textarea id="league-master-prompt" className={`invite-input ${styles.drawerTextarea}`} rows={6} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="写清楚选股、买卖、仓位和风控规则……" /></div>
          <div className={styles.skillUpload}>
            <button type="button" className={`invite-btn invite-btn-ghost ${styles.drawerActionButton}`} onClick={() => fileRef.current?.click()}><FileUp size={14} /> 上传 Skill / 投资习惯</button>
            <input ref={fileRef} type="file" accept=".md,.txt,.json,.yaml,.yml" hidden onChange={onFile} />
            <span>{skillFileName || '支持 MD / TXT / JSON，最多 300KB'}</span>
          </div>
          {error ? <div className="invite-error">⚠ {error}</div> : null}
        </div>
        <div className="invite-drawer-footer"><div className="invite-actions"><button type="button" className="invite-btn invite-btn-ghost" onClick={onClose} disabled={submitting}>取消</button><button type="button" className={`invite-btn invite-btn-primary ${styles.drawerActionButton}`} onClick={submit} disabled={submitting}><Plus size={15} /> {submitting ? '发布中…' : '参赛并赠送 10 万'}</button></div></div>
      </div>
    </>
  );
}
