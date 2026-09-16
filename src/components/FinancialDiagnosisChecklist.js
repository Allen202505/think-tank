'use client';

const STATUS_META = {
  normal: { icon: '🟢', label: '正常', cls: 'normal' },
  watch: { icon: '🟡', label: '关注', cls: 'watch' },
  abnormal: { icon: '🟠', label: '明显异常', cls: 'abnormal' },
  high: { icon: '🔴', label: '高风险信号', cls: 'high' },
  insufficient: { icon: '⚪', label: '数据不足', cls: 'insufficient' },
};

function statusMeta(status) {
  return STATUS_META[status] || STATUS_META.insufficient;
}

function coverageText(coverage) {
  if (!coverage || typeof coverage !== 'object') return [];
  const out = [];
  if (Number(coverage.structured) > 0) out.push(`结构化财报 ${Number(coverage.structured)} 项`);
  if (Number(coverage.filing) > 0) out.push(`年报/附注 ${Number(coverage.filing)} 项`);
  if (Number(coverage.missing) > 0) out.push(`明确缺口 ${Number(coverage.missing)} 项`);
  return out;
}

function SourceLinks({ sources }) {
  const list = Array.isArray(sources) ? sources.filter((s) => s && (s.title || s.url)).slice(0, 8) : [];
  if (!list.length) return null;
  return (
    <details className="mg-forensic-sources">
      <summary>证据来源</summary>
      <ul>
        {list.map((s, i) => (
          <li key={`${s.type || 'source'}-${i}`}>
            {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title || '查看原文'}</a> : (s.title || '系统数据')}
            {s.date ? <span> · {s.date}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function FinancialDiagnosisChecklist({ diagnosis, dataCard, onAsk }) {
  if (!diagnosis) {
    return (
      <section className="mg-forensic">
        <div className="mg-forensic-head">
          <div>
            <div className="mg-forensic-kicker">FINANCIAL FORENSICS</div>
            <h3>一页纸财务诊断清单</h3>
          </div>
          <span className="mg-forensic-badge insufficient">⚪ 待生成</span>
        </div>
        <p className="mg-forensic-empty">本次旧结果中没有诊断清单。重新解读一份 A 股财报后会自动生成。</p>
      </section>
    );
  }

  const rows = Array.isArray(diagnosis.rows) ? diagnosis.rows.slice(0, 10) : [];
  const coverage = coverageText(diagnosis.coverage);
  const topQuestions = Array.isArray(diagnosis.topQuestions) ? diagnosis.topQuestions.filter(Boolean).slice(0, 3) : [];

  return (
    <section className="mg-forensic">
      <div className="mg-forensic-head">
        <div>
          <div className="mg-forensic-kicker">FINANCIAL FORENSICS · A股</div>
          <h3>一页纸财务诊断清单</h3>
          <p>先发现问题，再下结论；异常是排查信号，不代表已经证实造假。</p>
        </div>
        {diagnosis.asOf && <span className="mg-forensic-period">{diagnosis.asOf}</span>}
      </div>

      <div className="mg-forensic-summary">
        <div className="mg-forensic-company">{diagnosis.company || '待识别公司'}</div>
        <p className="mg-forensic-model">{diagnosis.businessModel || '经营模式证据不足。'}</p>
        <div className="mg-forensic-meta">
          {(diagnosis.focus || []).map((item, i) => <span key={`${item}-${i}`}>{item}</span>)}
          {coverage.map((item, i) => <span key={`${item}-${i}`} className="coverage">{item}</span>)}
        </div>
      </div>

      {rows.length > 0 ? (
        <>
          <div className="mg-forensic-table-wrap">
            <table className="mg-forensic-table">
              <thead>
                <tr>
                  <th>优先级</th>
                  <th>诊断项</th>
                  <th>当前 / 趋势</th>
                  <th>状态</th>
                  <th>核心发现</th>
                  <th>下一步</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => {
                  const meta = statusMeta(row.status);
                  return (
                    <tr key={`${row.metric}-${i}`}>
                      <td><span className={`mg-forensic-priority ${String(row.priority || '').toLowerCase()}`}>{row.priority || 'P1'}</span></td>
                      <td>
                        <strong>{row.metric}</strong>
                        <small>{row.domain}</small>
                      </td>
                      <td>
                        <strong>{row.current}</strong>
                        <small>{row.trend}</small>
                      </td>
                      <td><span className={`mg-forensic-badge ${meta.cls}`}>{meta.icon} {meta.label}</span></td>
                      <td>{row.finding}</td>
                      <td>
                        <span>{row.next}</span>
                        {row.source && <small>{row.source}</small>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mg-forensic-cards">
            {rows.map((row, i) => {
              const meta = statusMeta(row.status);
              return (
                <article className="mg-forensic-card" key={`${row.metric}-card-${i}`}>
                  <div className="mg-forensic-card-head">
                    <div>
                      <span className={`mg-forensic-priority ${String(row.priority || '').toLowerCase()}`}>{row.priority || 'P1'}</span>
                      <strong>{row.metric}</strong>
                    </div>
                    <span className={`mg-forensic-badge ${meta.cls}`}>{meta.icon} {meta.label}</span>
                  </div>
                  <div className="mg-forensic-card-value">{row.current}<small>{row.trend}</small></div>
                  <p>{row.finding}</p>
                  <div className="mg-forensic-card-next"><b>下一步：</b>{row.next}</div>
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <p className="mg-forensic-empty">本次没有足够证据生成诊断项。请补充年报、附注或公司代码后重试。</p>
      )}

      {topQuestions.length > 0 && (
        <div className="mg-forensic-questions">
          <div className="mg-forensic-questions-title">本次最值得继续调查的 3 个问题</div>
          {topQuestions.map((q, i) => (
            <button key={`${q}-${i}`} type="button" onClick={() => onAsk && onAsk(q)} title="举手提问芒格">
              <span>{String(i + 1).padStart(2, '0')}</span>
              {q}
            </button>
          ))}
        </div>
      )}

      {dataCard && (
        <details className="mg-forensic-evidence">
          <summary>查看原始系统数据核验</summary>
          <pre>{dataCard}</pre>
        </details>
      )}
      <SourceLinks sources={diagnosis.sources} />
    </section>
  );
}
