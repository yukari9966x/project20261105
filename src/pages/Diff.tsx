/**
 * ④ 해외규제 변경체크 — 기존 kats-regulation-diff 엔진을 브라우저(Pyodide)에서 실행.
 * 이 화면에 들어올 때만 엔진(약 18MB)을 내려받고, Web Worker 에서 돌려 화면이 멈추지 않는다.
 * 규정 파일과 대조 결과는 브라우저 안에만 머문다.
 */
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { engine, EngineFailure } from '../engine/client';
import type { AnalysisView, EngineError } from '../engine/types';
import { siteUrl } from '../data/load';
import DiffResult from './DiffResult';

interface Picked {
  name: string;
  bytes: ArrayBuffer;
  size: number;
}

interface SamplePair {
  id: string;
  title: string;
  old: string;
  new: string;
  country: string;
  product: string;
}

const ACCEPT = '.txt,.md,.pdf,.docx,.hwpx';
const MAX = 25 * 1024 * 1024;

function DropZone({ label, picked, onPick }: { label: string; picked: Picked | null; onPick: (p: Picked) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function take(file: File | undefined) {
    if (!file) return;
    if (file.size > MAX) {
      setErr('25MB 이하 파일만 넣을 수 있습니다.');
      return;
    }
    setErr(null);
    onPick({ name: file.name, bytes: await file.arrayBuffer(), size: file.size });
  }
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    void take(e.dataTransfer.files?.[0]);
  };
  return (
    <div
      className={`drop ${over ? 'over' : ''} ${picked ? 'has' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={`${label} 파일 고르기`}
      onClick={() => input.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <strong>{label}</strong>
      {picked ? (
        <span>
          ✓ {picked.name} <span className="muted small">({Math.max(1, Math.round(picked.size / 1024))}KB)</span>
        </span>
      ) : (
        <span className="muted small">파일을 끌어다 놓거나 눌러서 고르세요 · TXT·MD·PDF(텍스트형)·DOCX·HWPX</span>
      )}
      {err && <span className="small" style={{ color: 'var(--bad)' }}>{err}</span>}
      <input ref={input} type="file" accept={ACCEPT} hidden onChange={(e) => void take(e.target.files?.[0])} />
    </div>
  );
}

export default function Diff() {
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(engine.ready ? 'ready' : 'idle');
  const [progress, setProgress] = useState<[number, string]>([0, '']);
  const [oldF, setOldF] = useState<Picked | null>(null);
  const [newF, setNewF] = useState<Picked | null>(null);
  const [meta, setMeta] = useState({ title: '', country: '', product: '', targetDate: new Date().toISOString().slice(0, 10) });
  const [samples, setSamples] = useState<SamplePair[]>([]);
  const [sample, setSample] = useState<SamplePair | null>(null);
  const [replay, setReplay] = useState(false);
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<AnalysisView | null>(null);
  const [error, setError] = useState<EngineError | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 화면에 들어오면 엔진을 미리 준비 (아키텍처: 변경체크 화면에 들어갈 때만 로딩)
    if (engine.ready) return;
    setStatus('loading');
    engine
      .init((pct, msg) => setProgress([pct, msg]))
      .then(() => setStatus('ready'))
      .catch((e) => {
        setStatus('error');
        setError(e instanceof EngineFailure ? e.detail : { code: 'INIT', message: String(e) });
      });
  }, []);

  useEffect(() => {
    fetch(siteUrl('samples/index.json'))
      .then((r) => r.json())
      .then((d: { pairs: SamplePair[] }) => setSamples(d.pairs))
      .catch(() => setSamples([]));
  }, []);

  async function loadSample(s: SamplePair) {
    const get = async (f: string): Promise<Picked> => {
      const res = await fetch(siteUrl(`samples/${s.id}/${f}`));
      const bytes = await res.arrayBuffer();
      return { name: f, bytes, size: bytes.byteLength };
    };
    const [o, n] = await Promise.all([get(s.old), get(s.new)]);
    setOldF(o);
    setNewF(n);
    setSample(s);
    setMeta((m) => ({ ...m, title: s.title, country: s.country, product: s.product }));
  }

  async function run() {
    if (!oldF || !newF) return;
    setRunning(true);
    setError(null);
    setView(null);
    try {
      // Worker 로 옮기면(transfer) 원본 버퍼가 비므로 복사본을 보낸다 (다시 실행 가능하게)
      const v = await engine.analyze(
        { name: oldF.name, bytes: oldF.bytes.slice(0) },
        { name: newF.name, bytes: newF.bytes.slice(0) },
        { ...meta, oldVersion: oldF.name, newVersion: newF.name, isSynthetic: !!sample, useRecordedAi: !!sample && replay },
        (pct, msg) => setProgress([pct, msg]),
      );
      setView(v);
      setStatus('ready');
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
    } catch (e) {
      setError(e instanceof EngineFailure ? e.detail : { code: 'ERROR', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setRunning(false);
    }
  }

  const pickOld = (p: Picked) => {
    setOldF(p);
    setSample(null);
  };
  const pickNew = (p: Picked) => {
    setNewF(p);
    setSample(null);
  };

  return (
    <div className="stack-lg">
      <header className="page-head">
        <span className="eyebrow">④ 미니앱 · 기존 '해외규제 변경체크 AI' 엔진 이식</span>
        <h1>해외규제 변경체크</h1>
        <p className="muted">구판·신판 기술규정을 조항 단위로 대조해 바뀐 조항·수치(단위 환산)·시행일과 원문 근거를 보여 주고, 기업 대응 체크리스트 초안과 XLSX·DOCX 보고서를 만듭니다. 분석은 이 브라우저 안의 Python(Pyodide)에서 실행되며 문서는 PC 밖으로 나가지 않습니다.</p>
      </header>

      {status !== 'ready' && (
        <div className="card stack" role="status" aria-live="polite" data-testid="engine-status">
          {status === 'error' ? (
            <div className="notice bad">
              엔진을 준비하지 못했습니다: {error?.message} {error?.remediation}
            </div>
          ) : (
            <>
              <div className="row">
                <span className="spinner" />
                <strong>변경체크 엔진 준비 중</strong>
                <span className="muted small">{progress[1]}</span>
              </div>
              <div className="progress" aria-hidden="true">
                <span style={{ width: `${progress[0]}%` }} />
              </div>
              <p className="small muted">처음 한 번만 약 18MB(Python 실행기·문서 해석 패키지)를 이 사이트에서 내려받습니다. 외부 CDN 을 쓰지 않아 내부망에서도 동작합니다.</p>
            </>
          )}
        </div>
      )}

      <section className="card stack">
        <div className="spread">
          <h2>1. 구판·신판 넣기</h2>
          <span className="small muted">같은 언어의 구판·신판 한 쌍 · 25MB 이하</span>
        </div>
        <div className="dropzones">
          <DropZone label="구판 (Old)" picked={oldF} onPick={pickOld} />
          <DropZone label="신판 (New)" picked={newF} onPick={pickNew} />
        </div>
        {samples.length > 0 && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="small muted">또는 가상 규정 샘플로 해보기 (실제 법령 아님)</span>
            <div className="examples">
              {samples.map((s) => (
                <button key={s.id} type="button" className="chip" aria-pressed={sample?.id === s.id} onClick={() => void loadSample(s)}>
                  {s.title}
                </button>
              ))}
            </div>
            {sample && (
              <label className="row small">
                <input type="checkbox" checked={replay} onChange={(e) => setReplay(e.target.checked)} />
                기록된 AI 응답 재생 (샘플 전용 · 실제 AI 호출 아님 · 원본 엔진 데모 모드와 같음)
              </label>
            )}
          </div>
        )}
        <details>
          <summary className="small" style={{ cursor: 'pointer' }}>
            비교 정보 (선택)
          </summary>
          <div className="grid-2" style={{ marginTop: 10 }}>
            <label className="field">
              제목
              <input className="input" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} placeholder="예: EU 배터리 규정 개정 대조" />
            </label>
            <label className="field">
              국가
              <input className="input" value={meta.country} onChange={(e) => setMeta({ ...meta, country: e.target.value })} placeholder="예: EU" />
            </label>
            <label className="field">
              제품군
              <input className="input" value={meta.product} onChange={(e) => setMeta({ ...meta, product: e.target.value })} placeholder="예: 휴대용 배터리" />
            </label>
            <label className="field">
              기준일 <span className="hint">기한 계산·보고서에 쓰입니다</span>
              <input className="input" type="date" value={meta.targetDate} onChange={(e) => setMeta({ ...meta, targetDate: e.target.value })} />
            </label>
          </div>
        </details>
        <div className="row">
          <button type="button" className="btn primary" disabled={!oldF || !newF || running || status === 'error'} onClick={() => void run()}>
            {running ? <span className="spinner" aria-hidden="true" /> : null}
            {running ? progress[1] || '분석 중' : '2. 대조 실행'}
          </button>
          <span className="small muted">지원: TXT·MD(UTF-8), 텍스트형 PDF(150쪽 이하), DOCX, HWPX · 구형 HWP 는 HWPX·DOCX 로 저장 후 · 스캔본 PDF 는 OCR 이 없어 대조할 수 없습니다.</span>
        </div>
        {running && (
          <div className="progress" aria-hidden="true">
            <span style={{ width: `${progress[0]}%` }} />
          </div>
        )}
        {error && status !== 'error' && (
          <div className="notice bad" role="alert">
            <strong>{error.message}</strong> {error.remediation}
          </div>
        )}
      </section>

      <div ref={resultRef}>{view && <DiffResult view={view} onView={setView} />}</div>
    </div>
  );
}
