/**
 * AI 연결 설정 — 키 없음(기본) / 사용자 키(OpenAI 호환) / 기관 LLM.
 * 키는 기본 sessionStorage(탭을 닫으면 삭제). 설정한 LLM 주소 외에는 어디에도 보내지 않는다.
 */
import { useState } from 'react';
import { listModels, ping, explainError } from '../llm/client';
import { CORS_CHECKED_AT, PROVIDERS, presetById } from '../llm/providers';
import { clearSettings, DEFAULT_SETTINGS, isLlmReady, useLlmSettings, type LlmMode, type LlmSettings } from '../llm/settings';

export default function Settings() {
  const [saved, save] = useLlmSettings();
  const [s, setS] = useState<LlmSettings>(saved);
  const [models, setModels] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const preset = presetById(s.providerId);
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);

  const setMode = (mode: LlmMode) => {
    if (mode === 'org' && s.mode !== 'org') setS({ ...s, mode, providerId: 'custom', baseUrl: '', jsonMode: false });
    else setS({ ...s, mode });
  };

  async function loadModels() {
    setBusy(true);
    setMsg(null);
    try {
      const list = await listModels(s);
      setModels(list);
      setMsg({ tone: 'ok', text: `모델 ${list.length}개를 불러왔습니다. 목록에서 고르세요.` });
    } catch (e) {
      setMsg({ tone: 'bad', text: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await ping(s);
      setMsg({ tone: 'ok', text: `연결 성공 (${r.ms}ms): "${r.reply}"` });
    } catch (e) {
      setMsg({ tone: 'bad', text: explainError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg" style={{ maxWidth: 820 }}>
      <header className="page-head">
        <span className="eyebrow">설정</span>
        <h1>AI 연결</h1>
        <p className="muted">
          핵심 기능(검색·규정 대조)은 키 없이 동작합니다. AI 요약을 쓰려면 OpenAI 호환 API 주소·모델·키를 넣으세요. 서버가 없는 사이트라 키를 숨길 곳이 없으므로, 시연용 키는 넣어 두지 않았습니다.
        </p>
      </header>

      <section className="card stack">
        <h2>모드</h2>
        <div className="stack" role="radiogroup" aria-label="AI 연결 모드">
          {(
            [
              ['off', '키 없음 (기본)', '질문을 규칙으로 나눠 공식 데이터 카드를 보여 주고, 변경체크는 규칙 엔진 결과(조항 정렬·수치·기한·원문 근거)를 보여 줍니다.'],
              ['user', '사용자 키', 'OpenAI 호환 주소·모델·키를 넣으면 LLM 이 검색 함수를 도구로 골라 부르고 카드를 근거로 요약합니다. 변경체크는 바뀐 조항 요약·의무사항을 보강합니다.'],
              ['org', '기관 LLM', '기관 내부망 LLM 주소(OpenAI 호환)를 넣습니다. 내부 문서도 내부망 안에서만 처리할 수 있습니다.'],
            ] as [LlmMode, string, string][]
          ).map(([m, title, desc]) => (
            <label key={m} className="card flat row" style={{ alignItems: 'flex-start', cursor: 'pointer', borderColor: s.mode === m ? 'var(--brand)' : undefined }}>
              <input type="radio" name="mode" checked={s.mode === m} onChange={() => setMode(m)} style={{ marginTop: 6 }} />
              <span className="stack" style={{ gap: 2 }}>
                <strong>{title}</strong>
                <span className="small muted">{desc}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      {s.mode !== 'off' && (
        <section className="card stack">
          <h2>연결 정보</h2>
          {s.mode === 'user' && (
            <label className="field">
              공급사
              <select
                className="select"
                value={s.providerId}
                onChange={(e) => {
                  const p = presetById(e.target.value);
                  setS({ ...s, providerId: e.target.value, baseUrl: p?.baseUrl || s.baseUrl, jsonMode: p?.jsonMode ?? s.jsonMode, model: '' });
                  setModels([]);
                }}
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <span className="hint">
                목록의 공급사는 {CORS_CHECKED_AT} 에 브라우저 직접 호출(CORS) 허용을 확인한 곳입니다. {preset?.note}
                {preset?.keyUrl && (
                  <>
                    {' '}
                    ·{' '}
                    <a href={preset.keyUrl} target="_blank" rel="noopener noreferrer">
                      키 발급 ↗
                    </a>
                  </>
                )}
              </span>
            </label>
          )}
          <label className="field">
            기본 주소 (Base URL)
            <input className="input mono" value={s.baseUrl} onChange={(e) => setS({ ...s, baseUrl: e.target.value.trim() })} placeholder={s.mode === 'org' ? 'https://llm.내부도메인/v1  또는  http://localhost:11434/v1' : 'https://api.openai.com/v1'} spellCheck={false} />
            <span className="hint">…/chat/completions 앞까지. 기관 LLM 은 서버에서 이 사이트 주소의 CORS 를 허용해야 하고, https 사이트에서는 https 주소(또는 http://localhost)만 부를 수 있습니다.</span>
          </label>
          <label className="field">
            API 키 {s.mode === 'org' && <span className="hint">(필요할 때만)</span>}
            <div className="searchbar">
              <input className="input mono" type={showKey ? 'text' : 'password'} value={s.apiKey} onChange={(e) => setS({ ...s, apiKey: e.target.value.trim() })} placeholder="sk-…" autoComplete="off" spellCheck={false} />
              <button type="button" className="btn" onClick={() => setShowKey(!showKey)}>
                {showKey ? '숨기기' : '보기'}
              </button>
            </div>
            <span className="hint">키는 이 브라우저에만 저장되고, 위 기본 주소로만 전송됩니다.</span>
          </label>
          <label className="field">
            모델
            <div className="searchbar">
              {models.length ? (
                <select className="select" value={s.model} onChange={(e) => setS({ ...s, model: e.target.value })}>
                  <option value="">모델 선택</option>
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input className="input mono" value={s.model} onChange={(e) => setS({ ...s, model: e.target.value.trim() })} placeholder="모델 이름 (목록 불러오기로 고를 수 있음)" spellCheck={false} />
              )}
              <button type="button" className="btn" disabled={busy || !s.baseUrl} onClick={() => void loadModels()}>
                목록 불러오기
              </button>
            </div>
            <span className="hint">질문창은 함수 호출(tool calling)을 지원하는 모델이 좋습니다. 지원하지 않으면 규칙 검색 결과를 넘겨 요약만 받습니다.</span>
          </label>
          <label className="row small">
            <input type="checkbox" checked={s.jsonMode} onChange={(e) => setS({ ...s, jsonMode: e.target.checked })} /> JSON 모드 사용 (response_format: json_object — 지원하지 않는 서버면 끄세요)
          </label>
          <label className="row small">
            <input type="checkbox" checked={s.remember} onChange={(e) => setS({ ...s, remember: e.target.checked })} /> 이 브라우저에 기억 (끄면 탭을 닫을 때 키가 지워집니다 — 공용 PC 에서는 끄세요)
          </label>
        </section>
      )}

      <div className="row">
        <button type="button" className="btn primary" disabled={!dirty} onClick={() => { save(s); setMsg({ tone: 'ok', text: isLlmReady(s) ? '저장했습니다. AI 가 켜졌습니다.' : s.mode === 'off' ? '저장했습니다. 키 없음 모드입니다.' : '저장했습니다. 주소·모델·키를 모두 넣어야 AI 가 켜집니다.' }); }}>
          저장
        </button>
        {s.mode !== 'off' && (
          <button type="button" className="btn" disabled={busy || !s.baseUrl || !s.model} onClick={() => void test()}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null} 연결 시험
          </button>
        )}
        <button type="button" className="btn ghost" onClick={() => { clearSettings(); setS({ ...DEFAULT_SETTINGS }); setModels([]); setMsg({ tone: 'info', text: '키와 설정을 지웠습니다.' }); }}>
          키·설정 지우기
        </button>
      </div>
      {msg && (
        <div className={`notice ${msg.tone === 'ok' ? 'ok' : msg.tone === 'bad' ? 'bad' : ''}`} role="status">
          {msg.text}
        </div>
      )}

      <section className="card soft stack small">
        <h3>보안 안내</h3>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>로그인이 없고 개인정보를 받지 않습니다. 이 사이트에는 서버가 없어 질문·문서·키가 사이트 운영자에게 가지 않습니다.</li>
          <li>AI 를 켜면 질문(질문창) 또는 바뀐 조항 원문(변경체크, 동의 후)이 설정한 LLM 주소로 전송됩니다. 내부 문서는 기관 LLM 에서만 처리하세요.</li>
          <li>인증 상태·리콜 여부·표준번호는 AI 가 아니라 공식 데이터 원본값을 보여 줍니다. AI 는 질문 해석과 요약만 맡습니다.</li>
        </ul>
      </section>
    </div>
  );
}
