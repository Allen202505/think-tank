import { Fragment } from 'react';
import FinancialDiagnosisChecklist from './FinancialDiagnosisChecklist';
import { SHARE_RESULT_KINDS } from '../lib/shareResults.mjs';

function inline(text) {
  const normalized = String(text || '').replace(/\*\*\*/g, '**');
  const parts = normalized.split(/\*\*([\s\S]+?)\*\*/g);
  return parts.map((part, index) => (
    index % 2 === 1 ? <strong key={index}>{part}</strong> : <Fragment key={index}>{part}</Fragment>
  ));
}

function RichText({ value, className = '' }) {
  const lines = String(value || '').split('\n');
  const blocks = [];
  let list = [];

  const flushList = () => {
    if (!list.length) return;
    blocks.push(<ul key={`list-${blocks.length}`} className="share-rich-list">{list}</ul>);
    list = [];
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushList();
      continue;
    }
    const heading = line.match(/^#{1,4}\s+(.+)$/);
    if (heading) {
      flushList();
      blocks.push(<h3 key={`heading-${blocks.length}`}>{inline(heading[1])}</h3>);
      continue;
    }
    const marker = line.match(/^【(.+?)】$/);
    if (marker) {
      flushList();
      blocks.push(<div key={`marker-${blocks.length}`} className="share-rich-marker">{marker[1]}</div>);
      continue;
    }
    const bullet = line.match(/^[-*•]\s+(.+)$/);
    if (bullet) {
      list.push(<li key={`li-${list.length}`}>{inline(bullet[1])}</li>);
      continue;
    }
    flushList();
    const numbered = line.match(/^\d+[.、)]\s+(.+)$/);
    blocks.push(<p key={`p-${blocks.length}`}>{inline(numbered ? numbered[1] : line)}</p>);
  }
  flushList();
  return <div className={`share-rich ${className}`.trim()}>{blocks.length ? blocks : <p>暂无内容</p>}</div>;
}

const STANCE = {
  BULL: { label: '看多', className: 'bull' },
  BEAR: { label: '看空', className: 'bear' },
  NEUTRAL: { label: '中性', className: 'neutral' },
};

function MasterAvatar({ master }) {
  const candidate = String(master?.avatar || '');
  const avatar = /^\/avatars\/[A-Za-z0-9_./-]+$/.test(candidate) && !candidate.includes('..') ? candidate : '';
  return (
    <span className="share-master-avatar" style={{ '--master-color': master?.color || '#b38b35' }}>
      {avatar ? <img src={avatar} alt="" /> : <span aria-hidden="true">{master?.emoji || '投'}</span>}
    </span>
  );
}

function MasterPkView({ payload }) {
  const masters = new Map((payload?.masters || []).map((master) => [master.id, master]));
  const rounds = Array.isArray(payload?.rounds) ? payload.rounds : [];
  const question = payload?.question || '大师PK';

  return (
    <div className="share-view share-master-pk">
      <div className="share-result-kicker">MASTER DEBATE · 大师PK</div>
      <h1>{question}</h1>
      {rounds.map((round, roundIndex) => (
        <section className="share-round" key={`round-${round.order || roundIndex}`}>
          {round.userMsg ? (
            <div className="share-user-question">
              <span>追问</span>
              <p>{round.userMsg}</p>
            </div>
          ) : null}
          {round.hostOpening ? <div className="share-host-opening"><b>主持人开场</b><RichText value={round.hostOpening} /></div> : null}
          <div className="share-speech-list">
            {(round.discussion || []).map((message, index) => {
              const master = masters.get(message.investorId) || {};
              const stance = STANCE[message.stance] || STANCE.NEUTRAL;
              return (
                <article className="share-speech-card" key={`${roundIndex}-${index}-${message.investorId}`}>
                  <div className="share-speech-head">
                    <MasterAvatar master={master} />
                    <div>
                      <strong>{master.name || '投资大师'}</strong>
                      <span>{master.title || master.tag || 'AI 模拟发言'}</span>
                    </div>
                    <em className={`stance-${stance.className}`}>{stance.label}</em>
                  </div>
                  <RichText value={message.content} />
                  {message.keyPoint ? <div className="share-key-point">核心观点：{message.keyPoint}</div> : null}
                </article>
              );
            })}
          </div>
          {round.hostClosing ? <div className="share-host-closing"><b>主持人收束</b><RichText value={round.hostClosing} /></div> : null}
          {round.verdict?.summary ? (
            <div className="share-verdict">
              <div className="share-verdict-title">综合裁决</div>
              <p>{round.verdict.summary}</p>
              <div className="share-verdict-grid">
                {round.verdict.consensus ? <span>共识：{round.verdict.consensus}</span> : null}
                {round.verdict.mainRisk ? <span>风险：{round.verdict.mainRisk}</span> : null}
                {round.verdict.opportunity ? <span>机会：{round.verdict.opportunity}</span> : null}
                {round.verdict.signal ? <span>信号：{round.verdict.signal}</span> : null}
              </div>
            </div>
          ) : null}
        </section>
      ))}
    </div>
  );
}

function QuickBreakfastView({ step, guests }) {
  const speakerName = (speaker) => {
    if (speaker === 'host') return '巴菲特';
    const index = Math.max(0, Number(String(speaker).replace('guest', '')) || 0);
    return guests[index]?.name || '嘉宾';
  };
  return (
    <section className="share-breakfast-step">
      <div className="share-breakfast-step-head"><span>快速解读</span><b>圆桌发言</b></div>
      <div className="share-quick-turns">
        {(step.turns || []).map((turn, index) => (
          <div className={`share-quick-turn${turn.speaker === 'host' ? ' host' : ''}`} key={`${turn.speaker}-${index}`}>
            <strong>{speakerName(turn.speaker)}</strong>
            <p>{turn.text}</p>
          </div>
        ))}
      </div>
      {step.summary ? <div className="share-quick-summary"><b>巴菲特总结</b><RichText value={step.summary} /></div> : null}
    </section>
  );
}

function BreakfastView({ payload }) {
  const news = payload?.news || {};
  const guests = Array.isArray(payload?.guests) ? payload.guests : [];
  const speaker = (leadId) => {
    if (!leadId || leadId === 'buffett') return { name: '巴菲特', emoji: '🎩' };
    return guests.find((guest) => guest.id === leadId) || { name: '圆桌嘉宾', emoji: '💬' };
  };

  return (
    <div className="share-view share-breakfast">
      <div className="share-result-kicker">BREAKFAST NEWSROOM · 巴菲特的早餐</div>
      <h1>{news.title || '新闻事件解读'}</h1>
      <div className="share-news-card">
        <div className="share-news-meta">{news.source || '原始新闻'}{news.time ? ` · ${news.time}` : ''}</div>
        <p>{news.content || '未附新闻正文'}</p>
      </div>
      <div className="share-seat-row">
        <span><b>🎩 巴菲特</b>主持</span>
        {guests.map((guest) => (
          <span key={guest.id}><b>{guest.emoji || '💬'} {guest.name}</b>{guest.groupKey || '嘉宾'}</span>
        ))}
      </div>

      {(payload?.steps || []).map((step, index) => {
        if (step.type === 'quick' || step.stepKey === 'quick') {
          return <QuickBreakfastView key={`quick-${index}`} step={step} guests={guests} />;
        }
        const lead = speaker(step.leadId);
        return (
          <section className={`share-breakfast-step${step.type === 'conclusion' ? ' conclusion' : ''}`} key={`${step.stepKey || 'step'}-${index}`}>
            <div className="share-breakfast-step-head">
              <span>{step.title || `步骤 ${index + 1}`}</span>
              <b>{lead.emoji || '💬'} {lead.name}</b>
            </div>
            {step.verdict ? <div className="share-step-verdict">{step.verdict}{step.reason ? ` · ${step.reason}` : ''}</div> : null}
            <RichText value={step.content} />
            {Array.isArray(step.pool) && step.pool.length ? (
              <div className="share-opportunity-list">
                {step.pool.map((item, itemIndex) => (
                  <article key={`${item.name || 'pool'}-${itemIndex}`}>
                    <b>{item.tier || '机会候选'} {item.name || '待验证'}{item.code ? `（${item.code}）` : ''}</b>
                    {item.logic ? <p>{item.logic}</p> : null}
                    {item.status ? <span>状态：{item.status}</span> : null}
                    {item.risk ? <span>风险：{item.risk}</span> : null}
                    {item.falsify ? <span>证伪：{item.falsify}</span> : null}
                  </article>
                ))}
              </div>
            ) : null}
            {Array.isArray(step.opportunities) && step.opportunities.length ? (
              <div className="share-opportunity-list">
                {step.opportunities.map((item, itemIndex) => (
                  <article key={`${item.name || 'opportunity'}-${itemIndex}`}>
                    <b>{item.tier || '重点关注'} {item.name || '待验证'}{item.code ? `（${item.code}）` : ''}</b>
                    {item.logic ? <p>{item.logic}</p> : null}
                    {item.risk ? <span>风险：{item.risk}</span> : null}
                    {item.falsify ? <span>证伪：{item.falsify}</span> : null}
                  </article>
                ))}
              </div>
            ) : null}
            {step.action?.verdict ? (
              <div className="share-action-line">
                <b>操作建议：{step.action.verdict}</b>
                {step.action.entry ? <span>买入：{step.action.entry}</span> : null}
                {step.action.stopLoss ? <span>止损：{step.action.stopLoss}</span> : null}
                {step.action.cycle ? <span>周期：{step.action.cycle}</span> : null}
              </div>
            ) : null}
            {step.risk ? <div className="share-risk-line">风险：{step.risk}</div> : null}
          </section>
        );
      })}

      {Array.isArray(payload?.followups) && payload.followups.length ? (
        <section className="share-followups">
          <h2>后续追问</h2>
          {payload.followups.map((item, index) => {
            const lead = speaker(item.leadId);
            return (
              <article key={index}>
                <div className="share-followup-q">问：{item.q}</div>
                <div className="share-followup-a"><b>{lead.name}：</b><RichText value={item.content} /></div>
                {item.hostNote ? <div className="share-followup-note"><b>巴菲特补充：</b>{item.hostNote}</div> : null}
              </article>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}

function MungerView({ payload }) {
  const report = payload?.report || {};
  const analysis = payload?.analysis || {};
  return (
    <div className="share-view share-munger">
      <div className="share-result-kicker">REPORT · FINANCIAL FORENSICS</div>
      <h1>{analysis.diagnosis?.company || report.fileName || '芒格财报解读'}</h1>
      {(report.fileName || report.link || report.note) ? (
        <div className="share-report-meta">
          {report.fileName ? <span>文件：{report.fileName}</span> : null}
          {report.link ? <span>来源：{report.link}</span> : null}
          {report.note ? <span>补充说明：{report.note}</span> : null}
        </div>
      ) : null}
      <article className="share-munger-speech">
        <div className="share-munger-head"><span>🎩</span><b>芒格：这份财报我是这么看的</b></div>
        <RichText value={analysis.content} />
      </article>
      <FinancialDiagnosisChecklist
        diagnosis={analysis.diagnosis}
        dataCard={analysis.dataCard}
        readOnly
      />
      {Array.isArray(analysis.followUps) && analysis.followUps.length ? (
        <section className="share-followup-questions">
          <h2>建议继续追问</h2>
          {analysis.followUps.map((question, index) => <p key={index}>{index + 1}. {question}</p>)}
        </section>
      ) : null}
    </div>
  );
}

export default function ShareResultView({ kind, payload }) {
  if (kind === SHARE_RESULT_KINDS.MASTER_PK) return <MasterPkView payload={payload} />;
  if (kind === SHARE_RESULT_KINDS.BREAKFAST) return <BreakfastView payload={payload} />;
  if (kind === SHARE_RESULT_KINDS.MUNGER) return <MungerView payload={payload} />;
  return <div className="share-view share-empty">暂不支持这种分享内容。</div>;
}
