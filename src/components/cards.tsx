/** 미니앱 결과 카드 — 값은 원본 그대로, 아래에 기준일·원문 링크. */
import type { KcRecordHit, KcSummaryHit } from '../tools/kc';
import { shortDiv } from '../tools/kc';
import type { KsHit } from '../tools/ks';
import type { RecallHit } from '../tools/recall';
import { RECALL_KIND_LABEL } from '../tools/recall';
import { KS_DIVISIONS, koDate } from '../lib/format';
import { CONTACTS, kcCertUrl } from '../tools/links';
import { SourceLine } from './meta';

const ksStatusTone: Record<string, string> = { 제정: 'ok', 개정: 'info', 확인: 'brand', 폐지: 'bad' };

export function KsCard({ hit }: { hit: KsHit }) {
  const r = hit.record;
  return (
    <article className="card" aria-label={`${r.label} ${r.name}`}>
      <div className="card-title">
        <div className="stack" style={{ gap: 4 }}>
          <span className="rec-code">{r.label}</span>
          <span className="rec-title">{r.name}</span>
        </div>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <span className={`badge ${ksStatusTone[r.status] ?? ''}`}>최종고시 {r.status}</span>
        <span className={`badge ${r.intl ? 'accent' : 'outline'}`}>국제표준 인용 {r.intl ? 'Y' : 'N'}</span>
        <span className="badge outline">
          {r.div} {KS_DIVISIONS[r.div] ?? ''}
        </span>
        <span className="why">{hit.reason}</span>
      </div>
      <SourceLine src="file:15131276" official="ks" recordUrl={hit.url} recordLabel="e-나라표준인증에서 보기" />
    </article>
  );
}

function stateTone(state: string): string {
  if (state === '적합') return 'ok';
  if (/취소|금지|상실|청문|개선/.test(state)) return 'bad';
  return 'warn';
}

export function KcRecordCard({ hit }: { hit: KcRecordHit }) {
  const r = hit.record;
  return (
    <article className="card" aria-label={`KC 인증 ${r.certNum}`}>
      <div className="card-title">
        <div className="stack" style={{ gap: 4 }}>
          <span className="rec-code">{r.certNum}</span>
          <span className="rec-title">
            {r.productName} <span className="muted">{r.modelName}</span>
          </span>
        </div>
        <span className={`badge ${stateTone(r.certState)}`} title="자료 기준일 당시 상태">
          {r.certState || '상태 미기재'}
        </span>
      </div>
      <dl className="kv">
        <dt>인증구분</dt>
        <dd>{shortDiv(r.certDiv)}</dd>
        <dt>인증일자</dt>
        <dd>
          {koDate(r.certDate)}
          {r.certChgDate ? ` (변경 ${koDate(r.certChgDate)}${r.certChgReason ? ` · ${r.certChgReason}` : ''})` : ''}
        </dd>
        <dt>제조·수입</dt>
        <dd>
          {r.importDiv} · {r.makerName}
          {r.makerCntryName ? ` (${r.makerCntryName})` : ''}
          {r.importerName ? ` / 수입 ${r.importerName}` : ''}
        </dd>
        {r.categoryName && (
          <>
            <dt>법정분류</dt>
            <dd>{r.categoryName}</dd>
          </>
        )}
      </dl>
      <div className="row" style={{ marginTop: 6 }}>
        <span className="why">{hit.reason}</span>
      </div>
      <SourceLine src={r.src} recordUrl={hit.url} recordLabel="현재 인증 상태 보기" />
    </article>
  );
}

export function KcSummaryCard({ hit, total }: { hit: KcSummaryHit; total?: number }) {
  const r = hit.row;
  const divs = Object.entries(r.divs).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const states = Object.entries(r.states).sort((a, b) => b[1] - a[1]);
  return (
    <article className="card soft" aria-label={`KC 품목 ${r.productName}`}>
      <div className="card-title">
        <div className="stack" style={{ gap: 2 }}>
          <span className="rec-title">{r.productName}</span>
          <span className="muted small">{r.categoryName}</span>
        </div>
        <span className="badge brand">인증 {r.total.toLocaleString()}건</span>
      </div>
      <div className="stack" style={{ gap: 6, marginTop: 10 }}>
        {divs.map(([div, n]) => (
          <div className="bar" key={div}>
            <span>{shortDiv(div)}</span>
            <span className="muted">{Math.round((n / r.total) * 100)}%</span>
            <span className="track">
              <span style={{ width: `${(n / r.total) * 100}%` }} />
            </span>
          </div>
        ))}
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        상태: {states.map(([s, n]) => `${s} ${n.toLocaleString()}`).join(' · ')} · 인증일 {koDate(r.first)} ~ {koDate(r.last)}
      </p>
      <div className="row" style={{ marginTop: 4 }}>
        <span className="why">{hit.reason}</span>
        {total ? <span className="muted small">(품목 집계는 전량 {total.toLocaleString()}건 기준)</span> : null}
      </div>
      <SourceLine src={r.src[0]} recordUrl="https://www.safetykorea.kr/policy/targetsSafetyCert" recordLabel="안전관리대상 품목 안내" />
    </article>
  );
}

export function CertLookupCard({ certNum, found }: { certNum: string; found: boolean }) {
  return (
    <article className="card" style={{ borderColor: 'var(--brand)' }}>
      <div className="spread">
        <div className="stack" style={{ gap: 2 }}>
          <span className="muted small">인증번호</span>
          <span className="rec-code" style={{ fontSize: 18 }}>
            {certNum}
          </span>
        </div>
        <a className="btn primary" href={kcCertUrl(certNum)} target="_blank" rel="noopener noreferrer">
          지금 상태 확인 (제품안전정보센터) ↗
        </a>
      </div>
      <p className="small muted" style={{ marginTop: 8 }}>
        {found ? '이 사이트 자료에도 기록이 있습니다(아래). 인증 상태는 개선명령·취소 등으로 바뀔 수 있어 최신 상태는 링크에서 확인하세요.' : '이 사이트의 KC 자료(최근 기록)에는 없지만, 링크에서 제품안전정보센터의 현재 기록을 바로 볼 수 있습니다.'}
      </p>
    </article>
  );
}

const kindTone: Record<string, string> = { domestic: 'bad', foreign: 'warn', overseas: 'info' };

export function RecallCard({ hit }: { hit: RecallHit }) {
  const r = hit.record;
  return (
    <article className="card" aria-label={`리콜 ${r.productName} ${r.modelName}`}>
      <div className="card-title">
        <div className="stack" style={{ gap: 4 }}>
          <span className="rec-title">
            {r.productName} {r.modelName && <span className="muted">{r.modelName}</span>}
          </span>
          {(r.brandName || r.makerName || r.recallCmpnyName) && (
            <span className="small muted">{[r.brandName, r.makerName, r.recallCmpnyName].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ')}</span>
          )}
        </div>
        <span className={`badge ${kindTone[r.kind]}`}>{RECALL_KIND_LABEL[r.kind]}</span>
      </div>
      <dl className="kv">
        <dt>{r.src.startsWith('file:15040696') ? '등록일' : '공표일'}</dt>
        <dd>{koDate(r.publishDate)}</dd>
        {r.recallTypeName && (
          <>
            <dt>리콜 종류</dt>
            <dd>{r.recallTypeName}</dd>
          </>
        )}
        {(r.hazard || r.harmType) && (
          <>
            <dt>위해·결함</dt>
            <dd>{[r.harmType, r.hazard].filter(Boolean).join(' — ')}</dd>
          </>
        )}
        {(r.recallMeans || r.consumerAction) && (
          <>
            <dt>조치</dt>
            <dd>{[r.recallMeans, r.consumerAction].filter(Boolean).join(' — ')}</dd>
          </>
        )}
        {r.makingCntryName && (
          <>
            <dt>제조국</dt>
            <dd>{r.makingCntryName}</dd>
          </>
        )}
        {r.certNum && r.certNum !== '-' && (
          <>
            <dt>인증번호</dt>
            <dd className="mono">{r.certNum}</dd>
          </>
        )}
      </dl>
      <div className="row" style={{ marginTop: 6 }}>
        <span className="why">{hit.reason}</span>
      </div>
      <SourceLine src={r.src} recordUrl={hit.url} recordLabel={r.uid ? '리콜 원문 보기' : '리콜정보 검색'} />
    </article>
  );
}

export function ContactCard() {
  return (
    <div className="grid-2">
      {CONTACTS.map((c) => (
        <article className="card" key={c.tel}>
          <div className="spread">
            <div className="stack" style={{ gap: 2 }}>
              <span className="rec-title">{c.name}</span>
              <span className="small muted">{c.note}</span>
            </div>
            <a className="btn" href={`tel:${c.tel}`}>
              ☎ {c.tel}
            </a>
          </div>
        </article>
      ))}
    </div>
  );
}
