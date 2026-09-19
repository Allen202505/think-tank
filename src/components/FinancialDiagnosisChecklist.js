'use client';

const STATUS_META = {
  normal: { icon: '🟢', label: '暂未发现明显异常', cls: 'normal' },
  watch: { icon: '🟡', label: '重点核查', cls: 'watch' },
  abnormal: { icon: '🟠', label: '异常信号', cls: 'abnormal' },
  high: { icon: '🔴', label: '异常信号', cls: 'high' },
  insufficient: { icon: '⚪', label: '数据不足', cls: 'insufficient' },
};

const PRIORITY_META = {
  P0: { label: '先查', desc: '不先解决，会影响基本面理解' },
  P1: { label: '重点', desc: '重要，但不是第一顺位' },
  P2: { label: '补充', desc: '延伸问题或暂未发现异常' },
};

function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.insufficient;
}

function priorityOf(row) {
  const raw = String(row?.priority || '').toUpperCase();
  const priority = PRIORITY_META[raw] ? raw : 'P1';
  const changeKind = row?.change?.kind;
  if (changeKind === 'improve') return 'P1';
  if (changeKind === 'persistent' && row?.status === 'watch' && priority === 'P0') return 'P1';
  if (row?.status === 'normal' && priority === 'P0') return 'P2';
  if (row?.status === 'insufficient' && priority === 'P0') return 'P1';
  return priority;
}

function text(value) {
  return value == null ? '' : String(value).trim();
}

function rowQuestion(row) {
  return text(row.question || row.metric || row.domain) || '这项财务数据是否出现了需要继续核查的变化？';
}

function rowEvidence(row) {
  const raw = Array.isArray(row.evidence) ? row.evidence : [row.evidence];
  const list = raw.map(text).filter(Boolean);
  if (list.length) return list.slice(0, 3);
  return [row.current, row.trend, row.finding].map(text).filter((v) => v && v !== '—').slice(0, 3);
}

function rowJudgment(row) {
  return text(row.judgment || row.finding || row.interpretation || row.conclusion) || '当前证据不足，需继续补充披露后再判断。';
}

function isNarrativeConclusion(value) {
  const valueText = text(value);
  const chinese = (valueText.match(/[\u4e00-\u9fff]/g) || []).length;
  const digits = (valueText.match(/\d/g) || []).length;
  return chinese >= 8 && (digits === 0 || chinese >= digits / 2) && (/[，。；：、？！]/.test(valueText) || chinese >= 12);
}

function readableConclusion(value, fallback) {
  const valueText = text(value);
  return isNarrativeConclusion(valueText) ? valueText : fallback;
}

function rowNextCheck(row) {
  if (row.nextCheck && typeof row.nextCheck === 'object') {
    return {
      what: text(row.nextCheck.what || row.nextCheck.check),
      lookAt: text(row.nextCheck.lookAt || row.nextCheck.look || row.nextCheck.watch),
      judge: text(row.nextCheck.judge || row.nextCheck.judgment || row.nextCheck.verify),
    };
  }
  const raw = text(row.next || row.nextStep);
  const parts = raw.split(/\s*(?:→|->|；|;)\s*/).filter(Boolean);
  if (parts.length >= 3) return { what: parts[0], lookAt: parts[1], judge: parts.slice(2).join('；') };
  return { what: raw, lookAt: '', judge: '' };
}

function rowAskPrompt(row) {
  const q = rowQuestion(row);
  const next = rowNextCheck(row);
  const action = [next.what, next.lookAt, next.judge].filter(Boolean).join('；');
  return `请继续侦查“${q}”这条线索：${action || '回到财报原文核对关键数据和附注口径'}。`;
}

function evidenceExplainPrompt(row) {
  const details = row.details && typeof row.details === 'object' ? row.details : {};
  const evidence = rowEvidence(row);
  const lines = [
    `请用小白能听懂的方式解释这条财报证据，不要重新下全局结论，也不要编造数字。`,
    `侦查问题：${rowQuestion(row)}`,
    `关键证据：${evidence.join('；') || '数据不足'}`,
    `当前值/变化：${text(details.current || row.current) || '数据不足'}`,
    `趋势/对比：${text(details.trend || row.trend) || '数据不足'}`,
    `计算口径：${text(details.calculation || row.metric) || '数据不足'}`,
    `数据来源：${text(row.source) || '数据不足'}`,
    '请按这 5 点回答：1）这个指标和计算口径是什么意思，分子分母分别代表什么；2）为什么这样算，想验证什么问题；3）当前值和趋势说明什么，正常范围或好坏怎么判断；4）小白最容易误解什么；5）下一步具体看财报哪里、怎么验证。',
  ];
  return lines.join('\n');
}

function coverageText(coverage) {
  if (!coverage || typeof coverage !== 'object') return [];
  const out = [];
  if (Number(coverage.structured) > 0) out.push(`结构化 ${Number(coverage.structured)} 项`);
  if (Number(coverage.filing) > 0) out.push(`年报/附注 ${Number(coverage.filing)} 项`);
  if (Number(coverage.missing) > 0) out.push(`明确缺口 ${Number(coverage.missing)} 项`);
  return out;
}

function deriveConclusions(rows) {
  const riskRows = rows.filter((row) => ['high', 'abnormal', 'watch'].includes(row.status));
  const primary = riskRows[0] || rows[0];
  const positive = rows.find((row) => row.status === 'normal' && row !== primary);
  return {
    coreContradiction: primary ? rowJudgment(primary) : '当前没有足够证据识别核心矛盾。',
    mainRisk: riskRows.slice(0, 2).map(rowJudgment).filter(Boolean).join('；') || '暂未形成明确风险线索。',
    keyLead: positive ? `${rowQuestion(positive).replace(/？$/, '')}暂未见明显异常，可继续观察后续披露。` : '当前以风险排查为主，暂未形成可直接验证的积极线索。',
  };
}

function EvidenceDetails({ row, onAsk }) {
  const details = row.details && typeof row.details === 'object' ? row.details : {};
  const items = [
    ['当前值 / 变化', details.current || row.current],
    ['趋势 / 对比', details.trend || row.trend],
    ['计算口径', details.calculation],
    ['原始证据', details.rawEvidence],
    ['数据来源', row.source],
  ].filter(([, value]) => text(value) && text(value) !== '—');
  if (!items.length && !onAsk) return null;
  return (
    <div className="mg-forensic-detail-tools">
      {items.length > 0 && (
        <details className="mg-forensic-row-details">
          <summary>查看证据详情</summary>
          <dl>
            {items.map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{text(value)}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {onAsk && (
        <button
          type="button"
          className="mg-forensic-evidence-explain"
          onClick={() => onAsk(evidenceExplainPrompt(row), { displayText: `小白答疑：${rowQuestion(row)}` })}
        >
          ? 小白答疑
        </button>
      )}
    </div>
  );
}

function NextCheck({ row }) {
  const next = rowNextCheck(row);
  const steps = [
    ['查什么', next.what],
    ['看什么', next.lookAt],
    ['判断什么', next.judge],
  ].filter(([, value]) => value);
  if (!steps.length) return <span className="mg-forensic-muted">补充财报原文或附注后继续核查。</span>;
  return (
    <div className="mg-forensic-next-steps">
      {steps.map(([label, value], index) => (
        <div className="mg-forensic-next-step" key={label}>
          <span>{label}</span>
          <p>{value}</p>
          {index < steps.length - 1 ? <i aria-hidden="true">→</i> : null}
        </div>
      ))}
    </div>
  );
}

function SourceLinks({ sources }) {
  const list = Array.isArray(sources) ? sources.filter((source) => source && (source.title || source.url)).slice(0, 8) : [];
  if (!list.length) return null;
  return (
    <details className="mg-forensic-sources">
      <summary>证据来源与口径</summary>
      <ul>
        {list.map((source, index) => (
          <li key={`${source.type || 'source'}-${index}`}>
            {source.url ? <a href={source.url} target="_blank" rel="noreferrer">{source.title || '查看原文'}</a> : (source.title || '系统数据')}
            {source.date ? <span> · {source.date}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function EmptyChecklist() {
  return (
    <section className="mg-forensic">
      <div className="mg-forensic-head">
        <div>
          <div className="mg-forensic-kicker">A-SHARE FINANCIAL FORENSICS</div>
          <h3>一页纸财务诊断清单</h3>
        </div>
        <span className="mg-forensic-badge insufficient">⚪ 待生成</span>
      </div>
      <p className="mg-forensic-empty">本次旧结果中没有诊断清单。重新解读一份 A 股财报后会自动生成。</p>
    </section>
  );
}

export default function FinancialDiagnosisChecklist({ diagnosis, dataCard, onAsk }) {
  if (!diagnosis) return <EmptyChecklist />;

  const rows = Array.isArray(diagnosis.rows) ? diagnosis.rows.slice(0, 10) : [];
  const fallbackConclusions = deriveConclusions(rows);
  const conclusions = {
    coreContradiction: readableConclusion(diagnosis.coreContradiction, fallbackConclusions.coreContradiction),
    mainRisk: readableConclusion(diagnosis.mainRisk, fallbackConclusions.mainRisk),
    keyLead: readableConclusion(diagnosis.keyLead, fallbackConclusions.keyLead),
  };
  const coverage = coverageText(diagnosis.coverage);
  const gaps = rows
    .filter((row) => row.status === 'insufficient')
    .map(rowQuestion)
    .filter((question) => question && !/^0+(?:\.0+)?$/.test(question));
  const focusTags = (Array.isArray(diagnosis.focus) ? diagnosis.focus : [])
    .map(text)
    .filter((item) => item && item.length <= 12 && !/[，。；！？]/.test(item))
    .slice(0, 6);
  if (!focusTags.length) {
    for (const row of rows) {
      const domain = text(row.domain);
      if (domain && !focusTags.includes(domain) && focusTags.length < 6) focusTags.push(domain);
    }
  }
  const topQuestions = Array.isArray(diagnosis.topQuestions)
    ? diagnosis.topQuestions.map(text).filter((q) => q && !/^0+(?:\.0+)?$/.test(q)).slice(0, 3)
    : [];

  return (
    <section className="mg-forensic">
      <div className="mg-forensic-head">
        <div>
          <div className="mg-forensic-kicker">A-SHARE FINANCIAL FORENSICS</div>
          <h3>一页纸财务诊断清单</h3>
          <p>先发现问题，再下结论。异常只是排查信号，不等于已经证实造假。</p>
        </div>
        {diagnosis.asOf && <span className="mg-forensic-period">{diagnosis.asOf}</span>}
      </div>

      <div className="mg-forensic-profile">
        <div className="mg-forensic-profile-main">
          <div className="mg-forensic-company">{diagnosis.company || '待识别公司'}</div>
          <p className="mg-forensic-model">{diagnosis.businessModel || '经营模式证据不足。'}</p>
        </div>
        <div className="mg-forensic-profile-foot">
          {focusTags.length > 0 && (
            <div className="mg-forensic-focus-tags">
              <span className="mg-forensic-inline-label">本期重点</span>
              {focusTags.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}
            </div>
          )}
          {coverage.length > 0 && (
            <div className="mg-forensic-coverage-tags">
              <span className="mg-forensic-inline-label">证据覆盖</span>
              {coverage.map((item, index) => <span key={`${item}-${index}`}>{item}</span>)}
            </div>
          )}
        </div>
      </div>

      <div className="mg-forensic-conclusions-wrap">
        <div className="mg-forensic-section-title">本期核心结论</div>
        <div className="mg-forensic-conclusions">
          <article className="core">
            <div className="mg-forensic-conclusion-icon" aria-hidden="true">⚖</div>
            <div>
              <span>核心矛盾</span>
              <p>{conclusions.coreContradiction}</p>
            </div>
          </article>
          <article className="risk">
            <div className="mg-forensic-conclusion-icon" aria-hidden="true">⚠</div>
            <div>
              <span>主要风险</span>
              <p>{conclusions.mainRisk}</p>
            </div>
          </article>
          <article className="lead">
            <div className="mg-forensic-conclusion-icon" aria-hidden="true">↗</div>
            <div>
              <span>重点线索</span>
              <p>{conclusions.keyLead}</p>
            </div>
          </article>
        </div>
      </div>

      <div className="mg-forensic-list-head">
        <div>
          <strong>一页纸侦查清单</strong>
          <span>优先级只代表调查顺序，不代表股票评级</span>
        </div>
        <div className="mg-forensic-priority-legend">
          <span className="p0">P0 先查</span>
          <span className="p1">P1 重点</span>
          <span className="p2">P2 补充</span>
        </div>
      </div>

      {rows.length > 0 ? (
        <>
          <div className="mg-forensic-table-wrap">
            <table className="mg-forensic-table">
              <thead>
                <tr>
                  <th scope="col">优先级</th>
                  <th scope="col">侦查问题</th>
                  <th scope="col">关键证据</th>
                  <th scope="col">侦查判断</th>
                  <th scope="col">下一步核查</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => {
                  const priority = priorityOf(row);
                  const meta = statusMeta(row.status);
                  const evidence = rowEvidence(row);
                  return (
                    <tr key={`${rowQuestion(row)}-${index}`} className={`${priority.toLowerCase()} ${meta.cls}`}>
                      <td>
                        <span className={`mg-forensic-priority ${priority.toLowerCase()}`}>{priority}</span>
                        <small>{PRIORITY_META[priority].label}</small>
                      </td>
                      <td>
                        <strong className="mg-forensic-question">{rowQuestion(row)}</strong>
                        <div className="mg-forensic-question-meta">
                          <span>{row.domain || '财务排查'}</span>
                        </div>
                        <div className="mg-forensic-status-line">
                          <span className={`mg-forensic-badge ${meta.cls}`}>{meta.icon} {meta.label}</span>
                        </div>
                      </td>
                      <td>
                        {evidence.length ? (
                          <ul className="mg-forensic-evidence-list">
                            {evidence.map((item, evidenceIndex) => <li key={`${item}-${evidenceIndex}`}>{item}</li>)}
                          </ul>
                        ) : <span className="mg-forensic-muted">数据不足</span>}
                        <EvidenceDetails row={row} onAsk={onAsk} />
                      </td>
                      <td><p className="mg-forensic-judgment">{rowJudgment(row)}</p></td>
                      <td>
                        <NextCheck row={row} />
                        <button type="button" className="mg-forensic-row-ask" onClick={() => onAsk && onAsk(rowAskPrompt(row))}>
                          让芒格继续查 <span aria-hidden="true">›</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mg-forensic-cards">
            {rows.map((row, index) => {
              const priority = priorityOf(row);
              const meta = statusMeta(row.status);
              const evidence = rowEvidence(row);
              return (
                <article className={`mg-forensic-card ${priority.toLowerCase()} ${meta.cls}`} key={`${rowQuestion(row)}-card-${index}`}>
                  <div className="mg-forensic-card-head">
                    <div>
                      <span className={`mg-forensic-priority ${priority.toLowerCase()}`}>{priority}</span>
                      <strong>{rowQuestion(row)}</strong>
                    </div>
                  </div>
                  <div className="mg-forensic-status-line">
                    <span className={`mg-forensic-badge ${meta.cls}`}>{meta.icon} {meta.label}</span>
                  </div>
                  <div className="mg-forensic-card-block">
                    <b>关键证据</b>
                    {evidence.length ? <ul>{evidence.map((item, evidenceIndex) => <li key={`${item}-${evidenceIndex}`}>{item}</li>)}</ul> : <p>数据不足</p>}
                    <EvidenceDetails row={row} onAsk={onAsk} />
                  </div>
                  <div className="mg-forensic-card-block">
                    <b>侦查判断</b>
                    <p>{rowJudgment(row)}</p>
                  </div>
                  <div className="mg-forensic-card-block">
                    <b>下一步核查</b>
                    <NextCheck row={row} />
                  </div>
                  <button type="button" className="mg-forensic-row-ask" onClick={() => onAsk && onAsk(rowAskPrompt(row))}>
                    让芒格继续查 <span aria-hidden="true">›</span>
                  </button>
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <p className="mg-forensic-empty">本次没有足够证据生成诊断项。请补充年报、附注或公司代码后重试。</p>
      )}

      {gaps.length > 0 && (
        <div className="mg-forensic-gaps">
          <div>
            <strong>数据缺口</strong>
            <span>以下问题需要补充披露后再判断，当前不猜测结论</span>
          </div>
          <ul>{gaps.slice(0, 5).map((gap, index) => <li key={`${gap}-${index}`}>{gap}</li>)}</ul>
        </div>
      )}

      {topQuestions.length > 0 && (
        <div className="mg-forensic-questions">
          <div className="mg-forensic-questions-title">下一步最值得追问的 3 个问题</div>
          {topQuestions.map((question, index) => (
            <button key={`${question}-${index}`} type="button" onClick={() => onAsk && onAsk(question)} title="举手提问芒格">
              <span>{String(index + 1).padStart(2, '0')}</span>
              {question}
            </button>
          ))}
        </div>
      )}

      {Boolean(dataCard || diagnosis.sources?.length) && (
        <div className="mg-forensic-supplement">
          <div className="mg-forensic-supplement-title">补充信息</div>
          {dataCard && (
            <details className="mg-forensic-evidence">
              <summary>系统数据核验与原始口径</summary>
              <pre>{dataCard}</pre>
            </details>
          )}
          <SourceLinks sources={diagnosis.sources} />
        </div>
      )}
    </section>
  );
}
