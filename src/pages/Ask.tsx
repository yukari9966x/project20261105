/** ① AI 통합 질문창 — 키 없음(규칙) 모드가 기본, 사용자 키·기관 LLM 을 넣으면 LLM 이 도구를 골라 부른다. */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { answerQuestion, type Answer, type Section } from '../ask/answer';
import { INTENT_LABEL } from '../ask/intent';
import { loadKc, loadKs, loadRecall } from '../data/load';
import { askWithLlm, type AgentEvent } from '../llm/agent';
import { explainError } from '../llm/client';
import { isLlmReady, modeLabel, useLlmSettings } from '../llm/settings';
import { koDate, koDateTime } from '../lib/format';
import { href, navigate, type Route } from '../router';
import { basisLabel, useMeta } from '../components/meta';
import { SectionView } from '../components/sections';

const loaders = { ks: loadKs, kc: loadKc, recall: loadRecall };

const EXAMPLES = [
  '전기난로를 수입해 팔려면 뭐가 필요해?',
  '보조배터리 리콜 있었어?',
  'KS C IEC 60335-2-30 표준 상태',
  '유모차 KC 인증 확인',
  'XU070339-19001B 인증 상태',
  '구판·신판 규정 바뀐 곳 비교하고 싶어',
];

interface LlmResult {
  text: string;
  sections: Section[];
  tools: string[];
  usedTools: boolean;
  calls: number;
  tokens: number | null;
}

export default function Ask({ route }: { route: Route }) {
  const [settings] = useLlmSettings();
  const { meta } = useMeta();
  const initial = route.params.get('q') ?? '';
  const [q, setQ] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [rule, setRule] = useState<Answer | null>(null);
  const [llm, setLlm] = useState<LlmResult | null>(null);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lastRun = useRef<string>('');
  const abortRef = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const aiOn = isLlmReady(settings);

  async function run(question: string, forceRule = false) {
    const text = question.trim();
    if (!text) return;
    lastRun.current = text;
    abortRef.current?.abort();
    const ctl = new AbortController();
    abortRef.current = ctl;
    setBusy(true);
    setError(null);
    setRule(null);
    setLlm(null);
    setEvents([]);
    try {
      if (aiOn && !forceRule) {
        const r = await askWithLlm(text, settings, loaders, (src) => basisLabel(meta, src), (e) => setEvents((prev) => [...prev, e]), ctl.signal);
        if (!ctl.signal.aborted) setLlm({ text: r.text, sections: r.sections, tools: r.toolRuns.map((t) => `${t.name}(${String(t.args.query ?? '')})`), usedTools: r.usedTools, calls: r.usage.calls, tokens: r.usage.totalTokens });
      } else {
        const r = await answerQuestion(text, loaders);
        if (!ctl.signal.aborted) setRule(r);
      }
    } catch (e) {
      if (!ctl.signal.aborted) setError(aiOn && !forceRule ? `AI 호출에 실패했습니다: ${explainError(e)} — 아래 '키 없이 다시 찾기'로 규칙 모드 결과를 볼 수 있습니다.` : `검색 중 오류: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (!ctl.signal.aborted) {
        setBusy(false);
        setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
      }
    }
  }

  useEffect(() => {
    const qp = route.params.get('q') ?? '';
    if (qp && qp !== lastRun.current) {
      setQ(qp);
      void run(qp);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params.get('q')]);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = q.trim();
    if (!text) return;
    if (text === lastRun.current && route.params.get('q') === text) void run(text);
    else navigate('/', { q: text });
  }

  const sections = llm?.sections ?? rule?.sections ?? [];

  return (
    <div className="stack-lg">
      <section className="hero" aria-labelledby="ask-title">
        <p className="small" style={{ fontWeight: 700, color: 'var(--accent)' }}>
          ① AI 통합 질문창
        </p>
        <h1 id="ask-title">질문 하나로 표준·인증·제품안전·해외규제를</h1>
        <p className="muted">KC 인증·리콜·KS 표준을 공식 데이터에서 바로 찾아, 답마다 기준일과 원문 링크를 붙입니다. 사실은 원본, 설명은 AI.</p>
        <form className="askbox" onSubmit={submit} role="search">
          <label htmlFor="ask-input" className="sr-only">
            질문
          </label>
          <textarea
            id="ask-input"
            className="textarea"
            rows={2}
            value={q}
            placeholder="예) 전기난로를 수입해 팔려면 뭐가 필요해?"
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="askbox-actions">
            <span className={`badge ${aiOn ? 'accent' : 'outline'}`} title="설정에서 바꿀 수 있습니다">
              {aiOn ? `AI 켜짐 · ${modeLabel(settings)}` : '키 없음 모드 · 규칙으로 질문을 나눠 검색'}
            </span>
            <div className="row">
              {!aiOn && (
                <a className="btn ghost small" href={href('/settings')}>
                  AI 연결
                </a>
              )}
              <button className="btn primary" type="submit" disabled={busy || !q.trim()}>
                {busy ? <span className="spinner" aria-hidden="true" /> : null}
                {busy ? '찾는 중' : '물어보기'}
              </button>
            </div>
          </div>
          <div className="examples" aria-label="질문 예시">
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" className="chip" onClick={() => navigate('/', { q: ex })}>
                {ex}
              </button>
            ))}
          </div>
        </form>
      </section>

      <div ref={resultRef} className="stack-lg scroll-target" aria-live="polite">
        {busy && (
          <div className="card row" role="status">
            <span className="spinner" />
            <span>{events.length ? events[events.length - 1].text : aiOn ? 'AI 가 질문을 해석하는 중' : '공식 데이터에서 찾는 중 (처음 한 번은 색인을 내려받습니다)'}</span>
          </div>
        )}
        {error && (
          <div className="notice bad stack" role="alert">
            <span>{error}</span>
            {aiOn && (
              <button type="button" className="btn small" onClick={() => void run(lastRun.current, true)}>
                키 없이 다시 찾기
              </button>
            )}
          </div>
        )}
        {rule && (
          <div className="stack">
            <h2>{rule.headline}</h2>
            <div className="understood">
              <span className="muted">이렇게 이해했어요:</span>
              {rule.parsed.intents.map((i) => (
                <span key={i} className="badge brand">
                  {INTENT_LABEL[i]}
                </span>
              ))}
              {[...rule.parsed.keywords, ...rule.parsed.models, rule.parsed.certNum, rule.parsed.ksCode].filter(Boolean).map((k) => (
                <span key={k!} className="badge outline">
                  {k}
                </span>
              ))}
              <span className="muted small">· 규칙 모드 {rule.ms}ms</span>
            </div>
          </div>
        )}
        {llm && (
          <section className="card stack" aria-label="AI 요약">
            <div className="spread">
              <h2>AI 요약</h2>
              <span className="badge accent">{modeLabel(settings)}</span>
            </div>
            <p className="answer-text">{llm.text || '(빈 응답)'}</p>
            <p className="small muted">
              {llm.usedTools ? `AI 가 부른 도구: ${llm.tools.join(', ') || '없음'}` : '함수 호출 미지원 모델 — 규칙 검색 결과를 넘겨 요약'} · 호출 {llm.calls}회
              {llm.tokens ? ` · ${llm.tokens.toLocaleString()} 토큰` : ''} · 사실 확인은 아래 원본 카드와 기준일을 보세요.
            </p>
          </section>
        )}
        {sections.map((s, i) => (
          <SectionView key={`${s.kind}-${i}`} s={s} />
        ))}
      </div>

      {!rule && !llm && !busy && (
        <>
          <section className="stack" aria-labelledby="apps-title">
            <h2 id="apps-title">미니앱</h2>
            <div className="miniapps">
              <a className="miniapp" href={href('/kc')}>
                <span className="num">②</span>
                <strong>KC 인증·리콜 조회</strong>
                <span className="small muted">제품명·모델명·인증번호로 인증 상태와 국내외 리콜</span>
              </a>
              <a className="miniapp" href={href('/ks')}>
                <span className="num">③</span>
                <strong>KS 표준 찾기</strong>
                <span className="small muted">표준번호·표준명으로 KS {meta ? meta.counts.ks.toLocaleString() : '33,266'}건, 고시 상태·국제표준 인용</span>
              </a>
              <a className="miniapp" href={href('/diff')}>
                <span className="num">④</span>
                <strong>해외규제 변경체크</strong>
                <span className="small muted">구판·신판 규정을 조항 단위로 대조 — 문서는 PC 밖으로 안 나감</span>
              </a>
              <div className="miniapp disabled" aria-disabled="true">
                <span className="num">⑤ ⑥ ⑦ · 2단계</span>
                <strong>수출 준비 · 직원 업무 · 관심 품목 알림</strong>
                <span className="small muted">WTO ePing TBT 통보문, 고시·매뉴얼 질의(내부망), 리콜·KS 개정 알림</span>
              </div>
            </div>
          </section>
          {meta && (
            <p className="small muted">
              데이터 기준: KS {koDate(meta.sources['file:15131276']?.basis)} · KC 인증 {koDate(meta.sources['file:15040703']?.basis)} · 리콜 {koDate(meta.sources['file:15040696']?.basis)} 공공데이터
              {meta.api.fetchedAt ? ` · 제품안전 API ${koDateTime(meta.api.fetchedAt)} 수집` : ' · 제품안전 API 수집 전(서비스키 등록 필요)'} —{' '}
              <a href={href('/about')}>출처 자세히</a>
            </p>
          )}
        </>
      )}
    </div>
  );
}
