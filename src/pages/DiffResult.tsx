/** ④ 변경체크 결과 화면 — 변경대조표 · 수치·기한 · 대응 체크리스트 · 조항 연결 · 내보내기 · (선택) AI 보강 */
import { useMemo, useState } from 'react';
import { downloadBytes, engine, EngineFailure } from '../engine/client';
import type { AlignmentView, AnalysisView, ChangeView, ClauseView, EvidenceView, ExportFormat, ReviewDecision } from '../engine/types';
import { wordDiff } from '../lib/textdiff';
import { isLlmReady, modeLabel, useLlmSettings } from '../llm/settings';
import { summarizeChanges } from '../llm/diff';
import { explainError } from '../llm/client';
import {
  DATE_ROLE_LABEL,
  DATE_STATUS_LABEL,
  EVIDENCE_LABEL,
  FLAG_LABEL,
  NUMERIC_LABEL,
  NUMERIC_TONE,
  OP_LABEL,
  RELATION_LABEL,
  REVIEW_LABEL,
  REVIEW_TONE,
  SEMANTIC_LABEL,
  SEMANTIC_TONE,
} from './diffLabels';

type Filter = 'changed' | 'all' | 'added' | 'deleted' | 'numeric' | 'dates' | 'same' | 'evidence';
const FILTERS: [Filter, string][] = [
  ['changed', '바뀐 조항'],
  ['numeric', '수치 변경'],
  ['dates', '시행일·기한'],
  ['added', '신설 후보'],
  ['deleted', '삭제 후보'],
  ['evidence', '근거 확인 필요'],
  ['same', '동일·서식만'],
  ['all', '전체'],
];

const EXPORTS: [ExportFormat, string][] = [
  ['xlsx', 'XLSX (7시트)'],
  ['docx', 'DOCX 보고서'],
  ['md', 'Markdown'],
  ['html', '인쇄용 HTML'],
  ['json', 'JSON'],
];

function useIndex(view: AnalysisView) {
  return useMemo(() => {
    const clause = new Map<string, ClauseView>();
    for (const c of [...view.clauses.old, ...view.clauses.new]) clause.set(c.id, c);
    const aln = new Map<string, AlignmentView>(view.alignments.map((a) => [a.id, a]));
    return { clause, aln };
  }, [view]);
}

function nums(ids: string[], clause: Map<string, ClauseView>): string {
  return ids.map((id) => clause.get(id)?.clause_number || '번호 없음').join(', ') || '—';
}

function EvidenceQuote({ ev, view }: { ev: EvidenceView; view: AnalysisView }) {
  const seg = view.segments[ev.segment_id];
  const ok = ev.verification_status === 'valid';
  if (!seg || !ok) {
    return (
      <p className="small">
        <span className={`badge ${ok ? 'ok' : 'bad'}`}>{EVIDENCE_LABEL[ev.verification_status]}</span> {ev.reason || ev.quote}
      </p>
    );
  }
  const t = seg.raw_text;
  const s = Math.max(0, ev.raw_start - 80);
  const e = Math.min(t.length, ev.raw_end + 80);
  return (
    <p className="small" style={{ whiteSpace: 'pre-wrap' }}>
      <span className="badge ok">{EVIDENCE_LABEL.valid}</span> <span className="muted mono">{seg.locator}</span>
      <br />
      {s > 0 && '…'}
      {t.slice(s, ev.raw_start)}
      <mark className="ev">{t.slice(ev.raw_start, ev.raw_end)}</mark>
      {t.slice(ev.raw_end, e)}
      {e < t.length && '…'}
    </p>
  );
}

function ChangeDetail({ ch, view, onReview, busy }: { ch: ChangeView; view: AnalysisView; onReview: (d: ReviewDecision, note: string) => void; busy: boolean }) {
  const { clause, aln } = useIndex(view);
  const a = aln.get(ch.alignment_id);
  const oldText = (a?.old_clause_ids ?? []).map((id) => clause.get(id)?.text ?? '').join('\n');
  const newText = (a?.new_clause_ids ?? []).map((id) => clause.get(id)?.text ?? '').join('\n');
  const parts = useMemo(() => (oldText && newText ? wordDiff(oldText, newText) : []), [oldText, newText]);
  const [note, setNote] = useState(ch.reviewer_note || '');
  const oldLoc = (a?.old_clause_ids ?? []).map((id) => clause.get(id)?.locator).filter(Boolean).join(', ');
  const newLoc = (a?.new_clause_ids ?? []).map((id) => clause.get(id)?.locator).filter(Boolean).join(', ');
  return (
    <div className="stack" style={{ padding: '4px 2px 8px' }}>
      <div className="clause-pair">
        <div className="clause-box">
          <h4>
            구판 {nums(a?.old_clause_ids ?? [], clause)} <span className="mono">{oldLoc}</span>
          </h4>
          {oldText ? parts.length ? parts.filter((p) => p.type !== 'ins').map((p, i) => (p.type === 'del' ? <del className="d" key={i}>{p.text}</del> : <span key={i}>{p.text}</span>)) : oldText : <span className="muted">(대응 조항 없음)</span>}
        </div>
        <div className="clause-box">
          <h4>
            신판 {nums(a?.new_clause_ids ?? [], clause)} <span className="mono">{newLoc}</span>
          </h4>
          {newText ? parts.length ? parts.filter((p) => p.type !== 'del').map((p, i) => (p.type === 'ins' ? <ins className="d" key={i}>{p.text}</ins> : <span key={i}>{p.text}</span>)) : newText : <span className="muted">(대응 조항 없음)</span>}
        </div>
      </div>
      {a?.explanation && <p className="small muted">연결 근거: {a.explanation}</p>}
      {ch.numeric_deltas.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>항목</th>
                <th>구판</th>
                <th>신판</th>
                <th>판정</th>
              </tr>
            </thead>
            <tbody>
              {ch.numeric_deltas.map((d, i) => (
                <tr key={i}>
                  <td>{d.subject || d.quantity_kind}</td>
                  <td>{d.old_fact ? `${d.old_fact.raw_value} ${d.old_fact.raw_unit} ${OP_LABEL[d.old_fact.operator] ?? ''}` : '—'}</td>
                  <td>{d.new_fact ? `${d.new_fact.raw_value} ${d.new_fact.raw_unit} ${OP_LABEL[d.new_fact.operator] ?? ''}` : '—'}</td>
                  <td>
                    <span className={`badge ${NUMERIC_TONE[d.status] ?? 'outline'}`}>{NUMERIC_LABEL[d.status] ?? d.status}</span>
                    <div className="small muted">{d.summary_ko}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ch.date_deltas.length > 0 && (
        <ul className="small" style={{ margin: 0, paddingLeft: 20 }}>
          {ch.date_deltas.map((d, i) => (
            <li key={i}>
              <strong>{DATE_ROLE_LABEL[d.role] ?? d.role}</strong> {d.old_date_raw ?? '—'} → {d.new_date_raw ?? '—'}{' '}
              <span className={`badge ${d.status === 'confirmed' ? 'ok' : 'warn'}`}>{DATE_STATUS_LABEL[d.status] ?? d.status}</span> {d.resolved_date ? `(${d.resolved_date})` : ''} <span className="muted">{d.basis_note_ko}</span>
            </li>
          ))}
        </ul>
      )}
      {ch.changed_obligations.length > 0 && (
        <div>
          <strong className="small">의무사항 변화</strong>
          <ul className="small" style={{ margin: '4px 0 0', paddingLeft: 20 }}>
            {ch.changed_obligations.map((o, i) => (
              <li key={i}>{o}</li>
            ))}
          </ul>
        </div>
      )}
      {ch.uncertainties.length > 0 && <p className="small notice warn">검토 필요: {ch.uncertainties.join(' / ')}</p>}
      <div className="stack" style={{ gap: 4 }}>
        <strong className="small">원문 근거</strong>
        {[...ch.evidence_old_ids, ...ch.evidence_new_ids].map((id) => view.evidences[id]).filter(Boolean).map((ev) => (
          <EvidenceQuote key={ev.id} ev={ev} view={view} />
        ))}
      </div>
      <div className="review">
        <span className="small muted">담당자 검토</span>
        {(['confirmed', 'modified', 'rejected', 'unreviewed'] as ReviewDecision[]).map((d) => (
          <button key={d} type="button" className="chip" aria-pressed={ch.review_status === d} disabled={busy} onClick={() => onReview(d, note)}>
            {REVIEW_LABEL[d]}
          </button>
        ))}
        <input className="input" style={{ maxWidth: 360, minHeight: 36 }} placeholder="검토 메모 (내보내기에 포함)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="검토 메모" />
      </div>
    </div>
  );
}

export default function DiffResult({ view, onView }: { view: AnalysisView; onView: (v: AnalysisView) => void }) {
  const [settings] = useLlmSettings();
  const { clause, aln } = useIndex(view);
  const [filter, setFilter] = useState<Filter>('changed');
  const [tab, setTab] = useState<'changes' | 'numbers' | 'checklist' | 'alignments'>('changes');
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [llmProgress, setLlmProgress] = useState<[number, number] | null>(null);

  const ch = view.changes;
  const counts = useMemo(() => {
    const c = { changed: 0, added: 0, deleted: 0, numeric: 0, dates: 0, same: 0, evidence: 0 };
    for (const x of ch) {
      if (x.semantic_status === 'changed' || x.semantic_status === 'unresolved') c.changed++;
      if (x.semantic_status === 'addition_candidate') c.added++;
      if (x.semantic_status === 'deletion_candidate') c.deleted++;
      if (x.numeric_deltas.length) c.numeric++;
      if (x.date_deltas.length) c.dates++;
      if (x.semantic_status === 'unchanged' || x.semantic_status === 'format_only') c.same++;
      if (x.verification_status !== 'valid') c.evidence++;
    }
    return c;
  }, [ch]);

  const visible = useMemo(() => {
    const t = text.trim();
    return ch.filter((x) => {
      const ok =
        filter === 'all' ||
        (filter === 'changed' && ['changed', 'unresolved', 'addition_candidate', 'deletion_candidate'].includes(x.semantic_status)) ||
        (filter === 'added' && x.semantic_status === 'addition_candidate') ||
        (filter === 'deleted' && x.semantic_status === 'deletion_candidate') ||
        (filter === 'numeric' && x.numeric_deltas.length > 0) ||
        (filter === 'dates' && x.date_deltas.length > 0) ||
        (filter === 'same' && (x.semantic_status === 'unchanged' || x.semantic_status === 'format_only')) ||
        (filter === 'evidence' && x.verification_status !== 'valid');
      if (!ok) return false;
      if (!t) return true;
      const a = aln.get(x.alignment_id);
      const hay = [x.summary_ko, ...x.categories, ...(a?.old_clause_ids ?? []).map((id) => clause.get(id)?.text ?? ''), ...(a?.new_clause_ids ?? []).map((id) => clause.get(id)?.text ?? '')].join(' ');
      return hay.includes(t);
    });
  }, [ch, filter, text, aln, clause]);

  async function doExport(fmt: ExportFormat) {
    setBusy(true);
    setMsg(null);
    try {
      const f = await engine.exportFile(fmt);
      downloadBytes(f.bytes, f.mime, f.filename);
      setMsg(`${f.filename} 을(를) 내려받았습니다 (브라우저 안에서 생성).`);
    } catch (e) {
      setMsg(e instanceof EngineFailure ? `${e.detail.message} ${e.detail.remediation ?? ''}` : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function review(id: string, d: ReviewDecision, note: string) {
    setBusy(true);
    try {
      onView(await engine.review('change', id, d, note));
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function enrich() {
    setBusy(true);
    setMsg(null);
    try {
      const targets = await engine.targets();
      setLlmProgress([0, targets.length]);
      const run = await summarizeChanges(targets, settings, view.project.target_date, (d, t) => setLlmProgress([d, t]));
      const res = await engine.applyLlm(run.outputs, { provider: settings.providerId, model: settings.model, calls: run.calls, totalTokens: run.totalTokens, errors: run.errors });
      onView(res.view);
      const rej = Object.keys(res.result.rejected).length;
      setMsg(`AI 보강 완료: ${res.result.accepted.length}건 반영${rej ? `, 형식 오류로 ${rej}건 제외` : ''}${run.errors.length ? `, 호출 실패 ${run.errors.length}건` : ''}. 인용문은 원문에서 다시 찾아 검증했습니다.`);
    } catch (e) {
      setMsg(`AI 보강 실패: ${explainError(e)}`);
    } finally {
      setBusy(false);
      setLlmProgress(null);
    }
  }

  const cov = view.coverage;
  const usage = view.run.usage_if_available as { timings_ms?: Record<string, number> } | null;
  const ms = usage?.timings_ms?.total ?? view.timings_ms.total;
  const changedTargets = ch.filter((x) => x.semantic_status !== 'unchanged').length;

  return (
    <div className="stack-lg">
      <section className="card stack">
        <div className="spread">
          <div className="stack" style={{ gap: 2 }}>
            <h2>{view.project.title}</h2>
            <span className="small muted">
              구판 {view.documents.old.filename} ({view.documents.old.page_count}쪽·{view.documents.old.language}) → 신판 {view.documents.new.filename} ({view.documents.new.page_count}쪽·{view.documents.new.language})
            </span>
          </div>
          <span className={`badge ${view.run.mode === 'live' ? 'accent' : view.fixture_replay ? 'info' : 'outline'}`}>
            {view.run.mode === 'live' ? `AI 보강 · ${view.run.model_name}` : view.fixture_replay ? '기록된 AI 응답 재생 (실제 AI 호출 아님)' : '규칙 엔진 결과 (AI 미사용)'}
          </span>
        </div>
        <div className="stack" style={{ gap: 6 }}>
          {view.is_synthetic && <div className="notice warn small">{view.notices.synthetic}</div>}
          <div className={`notice small ${cov.is_complete && cov.unresolved_old + cov.unresolved_new === 0 ? 'ok' : 'warn'}`}>{view.notices.completeness}</div>
          {view.run.errors.length > 0 && <div className="notice small">{view.run.errors.slice(0, 4).join(' / ')}</div>}
        </div>
        <div className="stats">
          <div className="stat">
            <div className="n">
              {cov.total_old_clauses} → {cov.total_new_clauses}
            </div>
            <div className="l">조항 (구판 → 신판)</div>
          </div>
          <div className="stat">
            <div className="n">{counts.changed}</div>
            <div className="l">바뀐 조항</div>
          </div>
          <div className="stat">
            <div className="n">
              {counts.added} / {counts.deleted}
            </div>
            <div className="l">신설 / 삭제 후보</div>
          </div>
          <div className="stat">
            <div className="n">{counts.numeric}</div>
            <div className="l">수치 변경 조항</div>
          </div>
          <div className="stat">
            <div className="n">{counts.dates}</div>
            <div className="l">시행일·기한 조항</div>
          </div>
          <div className="stat">
            <div className="n">{view.checklist_items.length}</div>
            <div className="l">대응 체크리스트</div>
          </div>
        </div>
        <p className="small muted">
          브라우저 안에서 처리 {ms ? `${(ms / 1000).toFixed(1)}초` : ''} · 엔진 {view.engine_version} · 문서는 PC 밖으로 나가지 않았습니다{view.run.mode === 'live' ? ' (AI 보강 때 바뀐 조항만 설정한 LLM 으로 전송)' : ''}.
        </p>
        <div className="row" role="group" aria-label="내보내기">
          {EXPORTS.map(([f, label]) => (
            <button key={f} type="button" className="btn small" onClick={() => void doExport(f)} disabled={busy}>
              ⬇ {label}
            </button>
          ))}
        </div>
        {msg && (
          <p className="small notice" role="status">
            {msg}
          </p>
        )}
      </section>

      {isLlmReady(settings) && view.run.mode !== 'live' && changedTargets > 0 && (
        <section className="card stack">
          <h3>AI 로 바뀐 조항 요약·의무사항 보강</h3>
          <p className="small muted">
            바뀐 조항의 원문(구판·신판)만 <strong>{settings.baseUrl}</strong> ({modeLabel(settings)}) 로 보내 요약·의무사항·불확실성을 받습니다. 받은 인용문은 엔진이 원문에서 다시 찾아 검증하고, 근거가 깨진 결과는 체크리스트에서 뺍니다. 내부 문서는 기관 LLM 에만 보내세요.
          </p>
          <label className="row small">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} /> 바뀐 조항 원문을 위 LLM 주소로 보내는 데 동의합니다
          </label>
          <div className="row">
            <button type="button" className="btn primary" disabled={!consent || busy} onClick={() => void enrich()}>
              AI 보강 실행
            </button>
            {llmProgress && (
              <span className="small muted">
                {llmProgress[0]} / {llmProgress[1]}
              </span>
            )}
          </div>
          {llmProgress && (
            <div className="progress" aria-hidden="true">
              <span style={{ width: `${(llmProgress[0] / Math.max(1, llmProgress[1])) * 100}%` }} />
            </div>
          )}
        </section>
      )}

      <div className="tabs" role="tablist" aria-label="결과 보기">
        <button role="tab" aria-selected={tab === 'changes'} onClick={() => setTab('changes')}>
          변경대조표
        </button>
        <button role="tab" aria-selected={tab === 'numbers'} onClick={() => setTab('numbers')}>
          수치·기한
        </button>
        <button role="tab" aria-selected={tab === 'checklist'} onClick={() => setTab('checklist')}>
          대응 체크리스트 ({view.checklist_items.length})
        </button>
        <button role="tab" aria-selected={tab === 'alignments'} onClick={() => setTab('alignments')}>
          조항 연결 ({view.alignments.length})
        </button>
      </div>

      {tab === 'changes' && (
        <section className="stack" role="tabpanel">
          <div className="sticky-tools stack" style={{ gap: 8 }}>
            <div className="filters" role="group" aria-label="변경 종류">
              {FILTERS.map(([f, label]) => (
                <button key={f} type="button" className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {label}
                  {f !== 'all' ? ` ${counts[f as keyof typeof counts]}` : ` ${ch.length}`}
                </button>
              ))}
            </div>
            <input className="input" placeholder="조항 내용·요약에서 찾기" value={text} onChange={(e) => setText(e.target.value)} aria-label="조항 내용에서 찾기" />
          </div>
          {visible.length === 0 && <div className="card empty">해당하는 조항이 없습니다.</div>}
          <div className="list">
            {visible.map((x) => {
              const a = aln.get(x.alignment_id);
              const isOpen = open === x.id;
              return (
                <div key={x.id} className="stack" style={{ gap: 0 }}>
                  <button type="button" className="change-row" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : x.id)}>
                    <div className="row">
                      <span className="mono small">
                        {nums(a?.old_clause_ids ?? [], clause)} → {nums(a?.new_clause_ids ?? [], clause)}
                      </span>
                      <span className={`badge ${SEMANTIC_TONE[x.semantic_status]}`}>{SEMANTIC_LABEL[x.semantic_status]}</span>
                      {a && a.relationship !== 'one_to_one' && <span className="badge outline">{RELATION_LABEL[a.relationship]}</span>}
                      {a?.flags.filter((f) => FLAG_LABEL[f] && f !== 'split' && f !== 'merged' && f !== 'unmatched').map((f) => (
                        <span key={f} className="badge info">
                          {FLAG_LABEL[f]}
                        </span>
                      ))}
                      {x.numeric_deltas.map((d, i) => (
                        <span key={i} className={`badge ${NUMERIC_TONE[d.status] ?? 'outline'}`}>
                          {NUMERIC_LABEL[d.status] ?? d.status}
                        </span>
                      ))}
                      {x.date_deltas.length > 0 && <span className="badge warn">기한</span>}
                      {x.verification_status !== 'valid' && <span className="badge bad">{EVIDENCE_LABEL[x.verification_status]}</span>}
                      <span className={`badge ${REVIEW_TONE[x.review_status]}`}>{REVIEW_LABEL[x.review_status]}</span>
                    </div>
                    <span style={{ fontSize: 15 }}>{x.summary_ko}</span>
                    {x.categories.length > 0 && <span className="small muted">{x.categories.join(' · ')}</span>}
                  </button>
                  {isOpen && (
                    <div className="card" style={{ marginTop: -6, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
                      <ChangeDetail ch={x} view={view} busy={busy} onReview={(d, note) => void review(x.id, d, note)} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      {tab === 'numbers' && (
        <section className="stack" role="tabpanel">
          <h3>수치·단위 비교</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>조항</th>
                  <th>항목</th>
                  <th>구판</th>
                  <th>신판</th>
                  <th>판정</th>
                  <th>이유</th>
                </tr>
              </thead>
              <tbody>
                {ch.flatMap((x) =>
                  x.numeric_deltas.map((d, i) => {
                    const a = aln.get(x.alignment_id);
                    return (
                      <tr key={`${x.id}-${i}`}>
                        <td className="mono">{nums(a?.new_clause_ids.length ? a.new_clause_ids : a?.old_clause_ids ?? [], clause)}</td>
                        <td>{d.subject || d.quantity_kind}</td>
                        <td>{d.old_fact ? `${d.old_fact.raw_value} ${d.old_fact.raw_unit} ${OP_LABEL[d.old_fact.operator] ?? ''}` : '—'}</td>
                        <td>{d.new_fact ? `${d.new_fact.raw_value} ${d.new_fact.raw_unit} ${OP_LABEL[d.new_fact.operator] ?? ''}` : '—'}</td>
                        <td>
                          <span className={`badge ${NUMERIC_TONE[d.status] ?? 'outline'}`}>{NUMERIC_LABEL[d.status] ?? d.status}</span>
                        </td>
                        <td className="small">{d.reason_ko || d.summary_ko}</td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
          <h3>시행일·유예기간</h3>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>조항</th>
                  <th>구분</th>
                  <th>구판</th>
                  <th>신판</th>
                  <th>확정</th>
                  <th>계산 근거</th>
                </tr>
              </thead>
              <tbody>
                {ch.flatMap((x) =>
                  x.date_deltas.map((d, i) => {
                    const a = aln.get(x.alignment_id);
                    return (
                      <tr key={`${x.id}-d${i}`}>
                        <td className="mono">{nums(a?.new_clause_ids.length ? a.new_clause_ids : a?.old_clause_ids ?? [], clause)}</td>
                        <td>{DATE_ROLE_LABEL[d.role] ?? d.role}</td>
                        <td>{d.old_date_raw ?? '—'}</td>
                        <td>{d.new_date_raw ?? '—'}</td>
                        <td>
                          <span className={`badge ${d.status === 'confirmed' ? 'ok' : 'warn'}`}>{DATE_STATUS_LABEL[d.status] ?? d.status}</span> {d.resolved_date ?? ''}
                        </td>
                        <td className="small">{d.basis_note_ko}</td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {tab === 'checklist' && (
        <section className="stack" role="tabpanel">
          <p className="small muted">원문 근거가 확인된 변경만으로 만든 기업 대응 체크리스트 초안입니다. 미확정 기한은 확정하지 않으며, 담당자 칸은 비워 둡니다.</p>
          <div className="list">
            {view.checklist_items.map((it) => (
              <article key={it.id} className="card">
                <div className="spread">
                  <strong>{it.action_ko}</strong>
                  <span className={`badge ${it.due_date_status === 'confirmed' ? 'ok' : 'warn'}`}>
                    {it.due_date ? `기한 ${it.due_date}` : '기한 ' + (DATE_STATUS_LABEL[it.due_date_status] ?? it.due_date_status)}
                  </span>
                </div>
                <dl className="kv">
                  {it.applicable_condition && (
                    <>
                      <dt>적용 조건</dt>
                      <dd>{it.applicable_condition}</dd>
                    </>
                  )}
                  {it.verification_question && (
                    <>
                      <dt>확인 질문</dt>
                      <dd>{it.verification_question}</dd>
                    </>
                  )}
                  {it.suggested_evidence_to_prepare && (
                    <>
                      <dt>준비 자료</dt>
                      <dd>{it.suggested_evidence_to_prepare}</dd>
                    </>
                  )}
                  {it.priority_reason && (
                    <>
                      <dt>우선순위</dt>
                      <dd>{it.priority_reason}</dd>
                    </>
                  )}
                  <dt>담당자</dt>
                  <dd className="muted">{it.owner_placeholder}</dd>
                </dl>
              </article>
            ))}
            {view.checklist_items.length === 0 && <div className="card empty">체크리스트 항목이 없습니다.</div>}
          </div>
        </section>
      )}

      {tab === 'alignments' && (
        <section className="stack" role="tabpanel">
          <p className="small muted">
            모든 구판·신판 조항은 정확히 한 연결 또는 미해결 목록에 들어갑니다(누락·중복 {cov.duplicate_old + cov.duplicate_new}건). 번호만 같다고 같은 조항으로 확정하지 않으며, 대응 없는 조항은 신설·삭제 '후보'로 둡니다.
          </p>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>구판</th>
                  <th>신판</th>
                  <th>관계</th>
                  <th>방법·신뢰</th>
                  <th>설명</th>
                </tr>
              </thead>
              <tbody>
                {view.alignments.map((a) => (
                  <tr key={a.id}>
                    <td className="mono">{nums(a.old_clause_ids, clause)}</td>
                    <td className="mono">{nums(a.new_clause_ids, clause)}</td>
                    <td>
                      {RELATION_LABEL[a.relationship]}
                      {a.flags.filter((f) => FLAG_LABEL[f]).map((f) => (
                        <span key={f} className="badge info" style={{ marginLeft: 4 }}>
                          {FLAG_LABEL[f]}
                        </span>
                      ))}
                    </td>
                    <td className="small">
                      {a.method} · {a.confidence_band} ({a.similarity_score.toFixed(2)})
                    </td>
                    <td className="small">{a.explanation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
