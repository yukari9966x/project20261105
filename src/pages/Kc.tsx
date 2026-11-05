/** ② KC 인증·리콜 조회 — 제품명·모델명·인증번호로 인증 상태와 국내외 리콜 여부를 한 화면에서. */
import { useEffect, useState, type FormEvent } from 'react';
import { loadKc, loadRecall } from '../data/load';
import type { RecallKind } from '../data/types';
import { searchKc, type KcSearchResult } from '../tools/kc';
import { RECALL_KIND_LABEL, searchRecall, type RecallSearchResult } from '../tools/recall';
import { OFFICIAL } from '../tools/links';
import { koDate } from '../lib/format';
import { navigate, type Route } from '../router';
import { CertLookupCard, KcRecordCard, KcSummaryCard, RecallCard } from '../components/cards';
import { useMeta } from '../components/meta';

const EXAMPLES = ['전기난로', '보조배터리', '유모차', 'LED 등기구', '전기매트', 'XU070339-19001B'];

export default function Kc({ route }: { route: Route }) {
  const { meta } = useMeta();
  const q = route.params.get('q') ?? '';
  const tab = route.params.get('tab') === 'recall' ? 'recall' : 'kc';
  const [input, setInput] = useState(q);
  const [kc, setKc] = useState<KcSearchResult | null>(null);
  const [recall, setRecall] = useState<RecallSearchResult | null>(null);
  const [kinds, setKinds] = useState<RecallKind[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nKc, setNKc] = useState(10);
  const [nRc, setNRc] = useState(10);

  useEffect(() => {
    setInput(q);
    if (!q) {
      setKc(null);
      setRecall(null);
      return;
    }
    let alive = true;
    setBusy(true);
    setError(null);
    Promise.all([loadKc(), loadRecall()])
      .then(([kd, rd]) => {
        if (!alive) return;
        setKc(searchKc(kd, q, { limit: 60, summaryLimit: 8 }));
        setRecall(searchRecall(rd, q, { limit: 200 }));
        setNKc(10);
        setNRc(10);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => alive && setBusy(false));
    return () => {
      alive = false;
    };
  }, [q]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (input.trim()) navigate('/kc', { q: input.trim(), tab });
  };

  const recallHits = recall ? recall.hits.filter((h) => !kinds.length || kinds.includes(h.record.kind)) : [];
  const kcSrc = meta?.sources['file:15040703'];

  return (
    <div className="stack-lg">
      <header className="page-head">
        <span className="eyebrow">② 미니앱</span>
        <h1>KC 인증·리콜 조회</h1>
        <p className="muted">제품명·모델명·인증번호로 KC 인증 기록과 국내외 리콜을 함께 찾습니다. 값은 공공데이터 원본 그대로이며, 현재 상태는 각 카드의 제품안전정보센터 링크로 확인하세요.</p>
      </header>

      <form className="searchbar" onSubmit={submit} role="search">
        <label htmlFor="kc-q" className="sr-only">
          제품명·모델명·인증번호
        </label>
        <input id="kc-q" className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="제품명·모델명·인증번호 (예: 전기난로, XU070339-19001B)" />
        <button className="btn primary" type="submit" disabled={!input.trim()}>
          찾기
        </button>
      </form>
      {!q && (
        <div className="examples">
          {EXAMPLES.map((ex) => (
            <button type="button" key={ex} className="chip" onClick={() => navigate('/kc', { q: ex })}>
              {ex}
            </button>
          ))}
        </div>
      )}

      <div className="notice small">
        <strong>자료 범위</strong> — KC 인증: 공공데이터 인증제품 정보 {meta ? meta.counts.kcAll.toLocaleString() : '…'}건(인증일 {kcSrc?.note?.match(/\d{4}-\d{2}-\d{2} ~ \d{4}-\d{2}-\d{2}/)?.[0] ?? '2019-10-01 ~ 2022-07-29'}) 중 개별 기록은 최근{' '}
        {meta ? meta.counts.kc.toLocaleString() : '…'}건, 품목별 집계는 전량. 리콜: 국내·국외 {meta ? meta.counts.recall.toLocaleString() : '…'}건.
        {meta?.api.fetchedAt ? ` 제품안전 API 수집분 포함(${koDate(meta.api.fetchedAt)}).` : ' 제품안전정보센터 Open API 는 서비스키를 받으면 CI 가 하루 1번 수집해 더합니다.'} 이 밖의 인증·최신 리콜은{' '}
        <a href={OFFICIAL.kcSearch} target="_blank" rel="noopener noreferrer">
          인증정보 검색
        </a>
        ·
        <a href={OFFICIAL.recallBoard} target="_blank" rel="noopener noreferrer">
          리콜정보 검색
        </a>
        에서 확인하세요.
      </div>

      {busy && (
        <div className="card row" role="status">
          <span className="spinner" /> KC·리콜 자료를 불러와 찾는 중 (처음 한 번은 약 3MB 를 내려받습니다)
        </div>
      )}
      {error && <div className="notice bad">{error}</div>}

      {kc && recall && !busy && (
        <>
          <div className="tabs" role="tablist" aria-label="결과 종류">
            <button role="tab" aria-selected={tab === 'kc'} onClick={() => navigate('/kc', { q, tab: 'kc' }, true)}>
              KC 인증 ({kc.summary.length ? `${kc.summary.length}품목 · ` : ''}
              {kc.totalRecords.toLocaleString()}건)
            </button>
            <button role="tab" aria-selected={tab === 'recall'} onClick={() => navigate('/kc', { q, tab: 'recall' }, true)}>
              리콜 ({recall.total.toLocaleString()}건)
            </button>
          </div>

          {tab === 'kc' && (
            <div className="stack-lg" role="tabpanel">
              {kc.certLookup && <CertLookupCard certNum={kc.certLookup.certNum} found={!!kc.certLookup.found} />}
              {kc.expandedTerms.length > 0 && <p className="small muted">생활 용어를 KC 품목명 '{kc.expandedTerms.join("', '")}'(으)로 넓혀 찾았습니다.</p>}
              {kc.summary.length > 0 && (
                <section className="stack">
                  <h2>품목별 인증 현황</h2>
                  <p className="small muted">같은 제품명으로 등록된 KC 인증의 인증구분·상태 분포입니다(공공데이터 전량 기준). 출시 전 필요한 인증 구분을 가늠하는 근거로 쓰고, 최종 판단은 안전관리대상 품목 안내로 확인하세요.</p>
                  <div className="grid-2">
                    {kc.summary.map((h) => (
                      <KcSummaryCard key={h.row.productName} hit={h} total={meta?.counts.kcAll} />
                    ))}
                  </div>
                </section>
              )}
              <section className="stack">
                <h2>인증 기록</h2>
                {kc.records.length === 0 ? (
                  <div className="card empty">
                    이 사이트 자료에서 찾은 개별 인증 기록이 없습니다.{' '}
                    <a href={OFFICIAL.kcSearch} target="_blank" rel="noopener noreferrer">
                      제품안전정보센터 인증정보 검색
                    </a>
                    에서 확인하세요.
                  </div>
                ) : (
                  <>
                    <div className="grid-2">
                      {kc.records.slice(0, nKc).map((h) => (
                        <KcRecordCard key={h.record.certNum} hit={h} />
                      ))}
                    </div>
                    {kc.records.length > nKc && (
                      <button type="button" className="btn more" onClick={() => setNKc((n) => n + 20)}>
                        더 보기 ({kc.records.length - nKc}건 남음{kc.totalRecords > kc.records.length ? `, 전체 ${kc.totalRecords.toLocaleString()}건 중 최근 ${kc.records.length}건 표시` : ''})
                      </button>
                    )}
                  </>
                )}
              </section>
            </div>
          )}

          {tab === 'recall' && (
            <div className="stack" role="tabpanel">
              <div className="filters" role="group" aria-label="리콜 종류">
                {(['domestic', 'foreign', 'overseas'] as RecallKind[]).map((k) => (
                  <button key={k} type="button" className="chip" aria-pressed={kinds.includes(k)} onClick={() => setKinds((prev) => (prev.includes(k) ? prev.filter((x) => x !== k) : [...prev, k]))}>
                    {RECALL_KIND_LABEL[k]} {recall.byKind[k]}
                  </button>
                ))}
              </div>
              {recall.expandedTerms.length > 0 && <p className="small muted">생활 용어를 리콜 제품명 '{recall.expandedTerms.join("', '")}'(으)로 넓혀 찾았습니다.</p>}
              {recallHits.length === 0 ? (
                <div className="card empty">
                  찾은 리콜이 없습니다. 최신 리콜은{' '}
                  <a href={OFFICIAL.recallBoard} target="_blank" rel="noopener noreferrer">
                    제품안전정보센터 리콜정보 검색
                  </a>
                  에서 확인하세요.
                </div>
              ) : (
                <>
                  <div className="grid-2">
                    {recallHits.slice(0, nRc).map((h) => (
                      <RecallCard key={h.record.id} hit={h} />
                    ))}
                  </div>
                  {recallHits.length > nRc && (
                    <button type="button" className="btn more" onClick={() => setNRc((n) => n + 20)}>
                      더 보기 ({recallHits.length - nRc}건 남음)
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
