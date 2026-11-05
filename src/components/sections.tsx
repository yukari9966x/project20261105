/** 질문창 답변의 각 미니앱 결과 블록 */
import { useState } from 'react';
import type { Section } from '../ask/answer';
import { href } from '../router';
import { OFFICIAL } from '../tools/links';
import { CertLookupCard, ContactCard, KcRecordCard, KcSummaryCard, KsCard, RecallCard } from './cards';
import { useMeta } from './meta';

function More({ count, shown, onMore }: { count: number; shown: number; onMore: () => void }) {
  if (count <= shown) return null;
  return (
    <button type="button" className="btn small more" onClick={onMore}>
      {count - shown}건 더 보기
    </button>
  );
}

export function SectionView({ s }: { s: Section }) {
  const { meta } = useMeta();
  const [n, setN] = useState(3);
  switch (s.kind) {
    case 'kc':
      return (
        <section className="section-block" aria-label={s.title}>
          <header>
            <div className="spread">
              <h3>{s.title}</h3>
              <a className="small" href={href('/kc', { q: s.query })}>
                KC·리콜 조회에서 자세히 →
              </a>
            </div>
            <p className="muted">{s.lead}</p>
          </header>
          {s.result.certLookup && <CertLookupCard certNum={s.result.certLookup.certNum} found={!!s.result.certLookup.found} />}
          {s.result.summary.length > 0 && (
            <div className="grid-2">
              {s.result.summary.slice(0, 2).map((h) => (
                <KcSummaryCard key={h.row.productName} hit={h} total={meta?.counts.kcAll} />
              ))}
            </div>
          )}
          {s.result.records.length > 0 && (
            <>
              <div className="grid-2">
                {s.result.records.slice(0, n).map((h) => (
                  <KcRecordCard key={h.record.certNum} hit={h} />
                ))}
              </div>
              <More count={Math.min(s.result.records.length, 6)} shown={n} onMore={() => setN(6)} />
            </>
          )}
        </section>
      );
    case 'recall':
      return (
        <section className="section-block" aria-label={s.title}>
          <header>
            <div className="spread">
              <h3>{s.title}</h3>
              <a className="small" href={href('/kc', { q: s.query, tab: 'recall' })}>
                리콜 전체 보기 →
              </a>
            </div>
            <p className="muted">{s.lead}</p>
          </header>
          {s.result.hits.length > 0 && (
            <>
              <div className="grid-2">
                {s.result.hits.slice(0, n).map((h) => (
                  <RecallCard key={h.record.id} hit={h} />
                ))}
              </div>
              <More count={Math.min(s.result.hits.length, 6)} shown={n} onMore={() => setN(6)} />
            </>
          )}
        </section>
      );
    case 'ks':
      return (
        <section className="section-block" aria-label={s.title}>
          <header>
            <div className="spread">
              <h3>{s.title}</h3>
              <a className="small" href={href('/ks', { q: s.query })}>
                KS 표준 찾기에서 자세히 →
              </a>
            </div>
            <p className="muted">{s.lead}</p>
          </header>
          {s.result.hits.length > 0 && (
            <>
              <div className="grid-2">
                {s.result.hits.slice(0, n).map((h) => (
                  <KsCard key={h.record.no} hit={h} />
                ))}
              </div>
              <More count={Math.min(s.result.hits.length, 6)} shown={n} onMore={() => setN(6)} />
            </>
          )}
        </section>
      );
    case 'steps':
      return (
        <section className="card section-block" aria-label={s.title}>
          <h3>{s.title}</h3>
          <p className="muted small">{s.lead}</p>
          <ol className="steps">
            {s.steps.map((st) => (
              <li key={st.text}>
                {st.href ? (
                  <a href={st.href} target="_blank" rel="noopener noreferrer">
                    {st.text} ↗
                  </a>
                ) : (
                  st.text
                )}
              </li>
            ))}
          </ol>
        </section>
      );
    case 'diff':
      return (
        <section className="card section-block" aria-label={s.title}>
          <h3>{s.title}</h3>
          <p className="muted">{s.lead}</p>
          <div className="row">
            <a className="btn primary" href={href('/diff')}>
              변경체크 열기
            </a>
          </div>
        </section>
      );
    case 'export':
      return (
        <section className="card section-block" aria-label={s.title}>
          <h3>{s.title}</h3>
          <p className="muted">{s.lead}</p>
          <div className="row">
            <a className="btn" href={OFFICIAL.knowTbt} target="_blank" rel="noopener noreferrer">
              KnowTBT ↗
            </a>
            <a className="btn primary" href={href('/diff')}>
              ④ 해외규제 변경체크
            </a>
          </div>
        </section>
      );
    case 'contact':
      return (
        <section className="section-block" aria-label={s.title}>
          <h3>{s.title}</h3>
          <ContactCard />
        </section>
      );
    case 'empty':
      return (
        <section className="card section-block">
          <h3>{s.title}</h3>
          <p className="muted">{s.lead}</p>
        </section>
      );
  }
}
