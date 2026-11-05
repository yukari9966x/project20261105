/** ③ KS 표준 찾기 — 표준번호·표준명 검색, 최종고시상태·국제표준 인용 여부 필터. */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { loadKs, type KsData } from '../data/load';
import type { KsStatus } from '../data/types';
import { searchKs } from '../tools/ks';
import { KS_DIVISIONS } from '../lib/format';
import { ksUrl } from '../tools/links';
import { navigate, type Route } from '../router';
import { KsCard } from '../components/cards';
import { useMeta } from '../components/meta';

const STATUSES: KsStatus[] = ['제정', '개정', '확인', '폐지'];
const EXAMPLES = ['KS C IEC 60335-2-30', '전기난로', '완구의 안전성', '60598', '자전거', '이차전지'];

export default function Ks({ route }: { route: Route }) {
  const { meta } = useMeta();
  const q = route.params.get('q') ?? '';
  const [input, setInput] = useState(q);
  const [data, setData] = useState<KsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<KsStatus[]>([]);
  const [intl, setIntl] = useState<'all' | 'Y' | 'N'>('all');
  const [div, setDiv] = useState('');
  const [n, setN] = useState(20);

  useEffect(() => {
    setInput(q);
    setN(20);
  }, [q]);

  useEffect(() => {
    if (!q && !div) return;
    loadKs()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [q, div]);

  const result = useMemo(() => {
    if (!data) return null;
    if (!q && div) {
      // 검색어 없이 부문만 고르면 그 부문 목록 (폐지 제외 기본)
      let recs = data.records.filter((r) => r.div === div);
      if (statuses.length) recs = recs.filter((r) => statuses.includes(r.status));
      else recs = recs.filter((r) => r.status !== '폐지');
      if (intl !== 'all') recs = recs.filter((r) => r.intl === (intl === 'Y'));
      return { query: '', hits: recs.slice(0, 500).map((r) => ({ record: r, score: 0, reason: `${div} ${KS_DIVISIONS[div]} 부문`, url: ksUrl(r.no) })), total: recs.length, expandedTerms: [], codeQuery: false };
    }
    if (!q) return null;
    return searchKs(data, q, { limit: 500, status: statuses.length ? statuses : undefined, includeWithdrawn: statuses.includes('폐지'), intl: intl === 'all' ? undefined : intl === 'Y', div: div || undefined });
  }, [data, q, statuses, intl, div]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    navigate('/ks', { q: input.trim() || undefined });
  };

  const counts = useMemo(() => {
    if (!data) return null;
    const c: Record<string, number> = {};
    for (const r of data.records) if (r.status !== '폐지') c[r.div] = (c[r.div] ?? 0) + 1;
    return c;
  }, [data]);

  return (
    <div className="stack-lg">
      <header className="page-head">
        <span className="eyebrow">③ 미니앱</span>
        <h1>KS 표준 찾기</h1>
        <p className="muted">
          국가표준(KS) {meta ? meta.counts.ks.toLocaleString() : '33,266'}건을 표준번호·표준명으로 바로 찾습니다. 생활 용어(예: 전기난로)는 표준명에 쓰이는 말(실내용 난방기)로 넓혀 찾습니다. 한글은 2글자 단위로 색인했습니다.
        </p>
      </header>

      <form className="searchbar" onSubmit={submit} role="search">
        <label htmlFor="ks-q" className="sr-only">
          표준번호 또는 표준명
        </label>
        <input id="ks-q" className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="표준번호·표준명 (예: KS C IEC 60335-2-30, 완구의 안전성)" />
        <button className="btn primary" type="submit">
          찾기
        </button>
      </form>
      {!q && (
        <div className="examples">
          {EXAMPLES.map((ex) => (
            <button type="button" key={ex} className="chip" onClick={() => navigate('/ks', { q: ex })}>
              {ex}
            </button>
          ))}
        </div>
      )}

      <div className="card flat stack" style={{ gap: 10 }}>
        <div className="filters" role="group" aria-label="최종고시상태">
          <span className="small muted" style={{ alignSelf: 'center' }}>
            최종고시상태
          </span>
          {STATUSES.map((s) => (
            <button key={s} type="button" className="chip" aria-pressed={statuses.includes(s)} onClick={() => setStatuses((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))}>
              {s}
            </button>
          ))}
          <span className="small muted" style={{ alignSelf: 'center' }}>
            (아무것도 안 고르면 폐지 제외)
          </span>
        </div>
        <div className="row">
          <label className="row small">
            국제표준 인용
            <select className="select" style={{ width: 'auto', minHeight: 36 }} value={intl} onChange={(e) => setIntl(e.target.value as 'all' | 'Y' | 'N')}>
              <option value="all">전체</option>
              <option value="Y">Y (인용)</option>
              <option value="N">N</option>
            </select>
          </label>
          <label className="row small">
            부문
            <select className="select" style={{ width: 'auto', minHeight: 36 }} value={div} onChange={(e) => setDiv(e.target.value)}>
              <option value="">전체</option>
              {Object.entries(KS_DIVISIONS).map(([k, v]) => (
                <option key={k} value={k}>
                  {k} {v}
                  {counts?.[k] ? ` (${counts[k].toLocaleString()})` : ''}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      {error && <div className="notice bad">{error}</div>}
      {(q || div) && !data && !error && (
        <div className="card row" role="status">
          <span className="spinner" /> KS 색인을 불러오는 중 (처음 한 번)
        </div>
      )}
      {result && (
        <section className="stack" aria-live="polite">
          <div className="spread">
            <h2>{result.total.toLocaleString()}건</h2>
            {result.expandedTerms.length > 0 && <span className="small muted">생활 용어 → 표준명 '{result.expandedTerms.join("', '")}' 포함</span>}
          </div>
          {result.total === 0 ? (
            <div className="card empty">찾은 표준이 없습니다. 표준명에 쓰이는 다른 말이나 표준번호로 찾아 보세요. 폐지 표준은 상태 필터에서 '폐지'를 고르면 나옵니다.</div>
          ) : (
            <>
              <div className="grid-2">
                {result.hits.slice(0, n).map((h) => (
                  <KsCard key={h.record.no} hit={h} />
                ))}
              </div>
              {result.hits.length > n && (
                <button type="button" className="btn more" onClick={() => setN((x) => x + 30)}>
                  더 보기 ({Math.min(result.hits.length, 500) - n}건 남음)
                </button>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
