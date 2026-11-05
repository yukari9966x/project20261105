/** 시제품 안내·출처 — 무엇을, 어떤 데이터로, 어떻게 만들었는지. 다른 기관이 데이터 JSON 을 가져다 쓰는 법. */
import { siteUrl } from '../data/load';
import { formatBytes, koDateTime } from '../lib/format';
import { CONTACTS, OFFICIAL } from '../tools/links';
import { useMeta } from '../components/meta';

function Diagram() {
  const box = (x: number, y: number, w: number, h: number, title: string, sub: string, tone: 'plain' | 'brand' | 'soft' | 'dash' = 'plain') => (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={10}
        fill={tone === 'brand' ? 'var(--brand-soft)' : tone === 'soft' ? 'var(--surface-3)' : 'var(--surface)'}
        stroke={tone === 'brand' ? 'var(--brand)' : 'var(--line-2)'}
        strokeWidth={tone === 'brand' ? 2 : 1.2}
        strokeDasharray={tone === 'dash' ? '6 5' : undefined}
      />
      <text x={x + w / 2} y={y + h / 2 - 4} textAnchor="middle" fontSize="14" fontWeight="700" fill="var(--ink)">
        {title}
      </text>
      <text x={x + w / 2} y={y + h / 2 + 15} textAnchor="middle" fontSize="11.5" fill="var(--muted)">
        {sub}
      </text>
    </g>
  );
  const arrow = (x1: number, y1: number, x2: number, y2: number, dash = false) => <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--muted)" strokeWidth={1.4} strokeDasharray={dash ? '5 4' : undefined} markerEnd="url(#ah)" />;
  return (
    <svg className="diagram" viewBox="0 0 760 470" role="img" aria-labelledby="dg-title dg-desc">
      <title id="dg-title">전체 구조: 서버 없이 CI 가 미리 만들고 브라우저가 실행</title>
      <desc id="dg-desc">공공데이터를 CI 가 하루 한 번 받아 색인을 만들고 정적 사이트로 배포한다. 브라우저에서 검색과 변경체크를 실행하며, LLM 은 키를 넣었을 때만 부른다.</desc>
      <defs>
        <marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="var(--muted)" />
        </marker>
      </defs>
      {box(20, 20, 220, 64, '공공데이터포털 · 제품안전 API', 'KS 목록 · KC · 리콜', 'soft')}
      {box(300, 20, 440, 64, 'CI · 하루 1번 (06:00 KST)', '수집 → 색인 생성 → 빌드 → 배포 · 서비스키는 CI 비밀변수에만')}
      {arrow(240, 52, 298, 52)}
      <rect x={20} y={120} width={560} height={110} rx={12} fill="none" stroke="var(--line-2)" strokeWidth={1.2} />
      <text x={34} y={142} fontSize="12.5" fontWeight="700" fill="var(--ink-2)">
        정적 사이트 · GitHub Pages → 공공 GitLab Pages
      </text>
      {box(34, 152, 160, 64, '화면', 'HTML · JS · CSS')}
      {box(210, 152, 160, 64, 'Pyodide · 엔진', '자체 호스팅')}
      {box(386, 152, 180, 64, '데이터 JSON', '/data/v1 · 기준일 표시')}
      {box(600, 152, 140, 64, '타 기관·AI 플랫폼', 'JSON 그대로 사용', 'soft')}
      {arrow(566, 184, 598, 184)}
      {arrow(520, 84, 520, 118)}
      <rect x={20} y={262} width={720} height={100} rx={12} fill="var(--brand-soft)" stroke="var(--brand)" strokeWidth={2} />
      <text x={34} y={284} fontSize="12.5" fontWeight="700" fill="var(--brand)">
        브라우저 · 실행은 모두 여기서
      </text>
      {box(34, 292, 200, 58, '질문창·검색', 'MiniSearch · 규칙 분류')}
      {box(280, 292, 200, 58, '변경체크', 'Pyodide · Web Worker')}
      {box(526, 292, 200, 58, '내보내기', 'XLSX·DOCX 를 브라우저에서')}
      {arrow(480, 321, 524, 321)}
      {arrow(300, 230, 300, 260)}
      {box(34, 396, 200, 58, 'LLM (선택)', '사용자 키 · 기관 LLM', 'dash')}
      {arrow(134, 350, 134, 394, true)}
      <text x={142} y={378} fontSize="11" fill="var(--muted)">
        키가 있을 때만
      </text>
      {box(280, 396, 200, 58, '내 PC 의 규정 파일', 'PC 밖으로 나가지 않음', 'soft')}
      {arrow(380, 394, 380, 352)}
    </svg>
  );
}

export default function About() {
  const { meta, error } = useMeta();
  const build = __BUILD_INFO__;
  return (
    <div className="stack-lg" style={{ maxWidth: 960 }}>
      <header className="page-head">
        <span className="eyebrow">시제품 안내·출처</span>
        <h1>「국가기술표준원 슈퍼앱」</h1>
        <p className="muted">흩어진 표준·인증·제품안전·해외규제 조회를 AI 한 창구로 — "이 제품 수입하려면 뭐가 필요해?"를 물으면 KC 인증·리콜·KS 표준·해외규제를 한 번에 찾아 공식 출처와 함께 답합니다.</p>
      </header>

      <div className="notice warn">
        <strong>2026년 산업부 AI 활용 경진대회 시제품</strong>입니다. 국가기술표준원의 공식 서비스가 아니며, 화면의 결과는 법적 판단 근거가 아닙니다. 인증·리콜의 최종 확인은{' '}
        <a href={OFFICIAL.safetyKorea} target="_blank" rel="noopener noreferrer">
          제품안전정보센터
        </a>
        , KS 는{' '}
        <a href={OFFICIAL.ksPortal} target="_blank" rel="noopener noreferrer">
          e-나라표준인증
        </a>
        에서 하세요. 기관 로고는 쓰지 않습니다.
      </div>

      <section className="card stack">
        <h2>핵심 원칙: 사실은 원본, 설명은 AI</h2>
        <p>인증 상태·리콜 여부·표준번호는 공공데이터 원본값을 그대로 보여 주고, AI 는 질문 해석과 요약만 맡습니다. 모든 결과 카드에 자료 기준일과 원문 링크를 붙여 "없는 인증을 있다고 답하는" 환각을 구조적으로 막습니다. 해외규제 변경체크의 '원문 근거 검증'과 같은 철학입니다.</p>
      </section>

      <section className="card stack">
        <h2>전체 구조</h2>
        <p className="small muted">서버 없이 CI 가 미리 만들고 브라우저가 실행합니다. 서비스키는 CI 에만 있고 사이트에는 결과 파일만 올라갑니다. 규정 파일과 대조 결과는 브라우저 안에만 머물고, LLM 은 키를 넣었을 때만 부릅니다.</p>
        <Diagram />
      </section>

      <section className="card stack">
        <h2>미니앱</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>미니앱</th>
                <th>하는 일</th>
                <th>연결 데이터</th>
                <th>상태</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>① AI 통합 질문창</td>
                <td>질문을 해석해 필요한 미니앱을 부르고, 답마다 공식 출처 링크를 붙임</td>
                <td>②~④</td>
                <td>
                  <span className="badge ok">제공</span>
                </td>
              </tr>
              <tr>
                <td>② KC 인증·리콜 조회</td>
                <td>제품명·모델명·인증번호로 인증 상태와 국내외 리콜</td>
                <td>제품안전 인증·리콜 공공데이터 (+ Open API 하루 1번 수집)</td>
                <td>
                  <span className="badge ok">제공</span>
                </td>
              </tr>
              <tr>
                <td>③ KS 표준 찾기</td>
                <td>표준번호·표준명 검색, 고시 상태, 국제표준 인용 여부</td>
                <td>이나라표준인증 국가표준 {meta ? meta.counts.ks.toLocaleString() : '33,266'}건</td>
                <td>
                  <span className="badge ok">제공</span>
                </td>
              </tr>
              <tr>
                <td>④ 해외규제 변경체크</td>
                <td>구판·신판 규정을 조항 단위로 대조하고 원문 근거 표시</td>
                <td>기존 kats-regulation-diff 엔진 (브라우저 이식)</td>
                <td>
                  <span className="badge ok">제공</span>
                </td>
              </tr>
              <tr>
                <td>⑤ 수출 준비 도우미</td>
                <td>국가·품목별 최근 TBT 통보문과 확인할 인증 목록</td>
                <td>WTO ePing API</td>
                <td>
                  <span className="badge outline">2단계</span>
                </td>
              </tr>
              <tr>
                <td>⑥ 직원 업무 도우미</td>
                <td>고시·업무 매뉴얼 질의, 반복 민원 답변 초안</td>
                <td>고시 원문, 내부 문서(내부망 LLM 전용)</td>
                <td>
                  <span className="badge outline">2단계</span>
                </td>
              </tr>
              <tr>
                <td>⑦ 관심 품목 알림</td>
                <td>등록 품목의 리콜, KS 개정, TBT 통보 알림</td>
                <td>②③⑤</td>
                <td>
                  <span className="badge outline">2단계</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card stack">
        <h2>데이터 출처와 기준일</h2>
        {error && <div className="notice bad">meta.json 을 읽지 못했습니다: {error}</div>}
        {meta && (
          <>
            <p className="small muted">
              데이터 생성 {koDateTime(meta.generatedAt)} · 제품안전 Open API: {meta.api.status === 'ok' || meta.api.status === 'partial' ? `${koDateTime(meta.api.fetchedAt)} 수집` : meta.api.message}
            </p>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>데이터</th>
                    <th>제공</th>
                    <th>기준</th>
                    <th>건수</th>
                    <th>이용허락</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.values(meta.sources).map((s) => (
                    <tr key={s.id}>
                      <td>
                        <a href={s.url} target="_blank" rel="noopener noreferrer">
                          {s.title}
                        </a>
                        {s.note && <div className="small muted">{s.note}</div>}
                      </td>
                      <td className="small">{s.provider}</td>
                      <td className="small">{s.basisLabel}</td>
                      <td>{s.count.toLocaleString()}</td>
                      <td className="small">{s.license}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="card stack">
        <h2>공개 데이터 JSON — 다른 기관·AI 플랫폼이 그대로 가져다 쓰기</h2>
        <p className="small">
          검색에 쓰는 데이터를 정적 JSON(<code>/data/v1</code>, 스키마 버전 표기)으로 공개합니다. 공개 Pages 는 CORS 를 허용하므로 온AI·AI국민비서 같은 범정부 플랫폼이 서버 없이 바로 읽을 수 있습니다. 필드 이름은 제품안전정보센터 Open API 명세(v2.1)를 따릅니다. MCP 서버는 2단계(로컬 실행 패키지)로 둡니다.
        </p>
        {meta && (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>파일</th>
                  <th>내용</th>
                  <th>크기</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <a className="mono" href={siteUrl('data/v1/meta.json')}>
                      meta.json
                    </a>
                  </td>
                  <td className="small">출처·기준 시각·건수·파일 목록(sha256)</td>
                  <td>—</td>
                </tr>
                {Object.entries(meta.files).map(([name, f]) => (
                  <tr key={name}>
                    <td>
                      <a className="mono" href={siteUrl(f.path)}>
                        {name}
                      </a>
                    </td>
                    <td className="small">{f.description}</td>
                    <td className="small">{formatBytes(f.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <pre className="card soft mono small" style={{ overflowX: 'auto', margin: 0 }}>{`// 예: 최근 리콜 5건 (브라우저·서버 어디서나)
const res = await fetch('${siteUrl('data/v1/recall.json')}');
const { records } = await res.json();
console.log(records.slice(0, 5));`}</pre>
      </section>

      <section className="card stack">
        <h2>AI 연결과 개인정보</h2>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li>
            <strong>키 없음(기본)</strong>: 규칙으로 질문 종류를 가려 검색 결과 카드를 보여 주고, 변경체크는 규칙 엔진 결과를 보여 줍니다. 심사·일반 이용은 이 모드로 충분히 동작합니다.
          </li>
          <li>
            <strong>사용자 키 / 기관 LLM</strong>: 설정에서 OpenAI 호환 주소·모델·키를 넣을 때만 AI 가 켜집니다. 키는 기본적으로 탭을 닫으면 지워지는 sessionStorage 에 두고, 설정한 LLM 주소 외에는 보내지 않습니다.
          </li>
          <li>로그인이 없고 개인정보를 받지 않습니다. 사이트에는 서버·분석 도구·외부 글꼴·CDN 이 없습니다.</li>
          <li>변경체크에 넣은 문서는 브라우저 안의 Python(Pyodide)이 처리하고 PC 밖으로 보내지 않습니다. 스캔본 PDF 는 OCR 이 없어 대조할 수 없습니다.</li>
        </ul>
      </section>

      <section className="card stack">
        <h2>상담 창구</h2>
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          {CONTACTS.map((c) => (
            <li key={c.tel}>
              {c.name} <a href={`tel:${c.tel}`}>{c.tel}</a> — {c.note}
            </li>
          ))}
        </ul>
      </section>

      <section className="card soft stack small">
        <h2>오픈소스·버전</h2>
        <p>
          React(MIT) · Vite(MIT) · MiniSearch(MIT) · Pyodide(MPL-2.0) · Python 패키지: lxml(BSD), pydantic(MIT), pypdf(BSD), python-docx(MIT), openpyxl(MIT), et-xmlfile(MIT), defusedxml(PSF) · 변경체크 엔진: kats-regulation-diff v0.2 (경진대회 출품용, 브라우저 이식판)
        </p>
        <p className="muted">
          빌드 {koDateTime(build.time)} · {build.ref || 'local'} {build.sha ? `@ ${build.sha.slice(0, 7)}` : ''}
        </p>
      </section>
    </div>
  );
}
