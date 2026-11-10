/**
 * 브라우저 종단 점검 (Playwright · Chromium) — 빌드 결과(dist/)를 정적 서버로 띄우고 실제 화면을 끝까지 눌러 본다.
 *
 *   npm run build && npm run test:e2e
 *   SITE_URL=https://<계정>.github.io/<저장소>/ npm run test:e2e   # 배포된 사이트 점검
 *   SCREENSHOTS=docs/screenshots npm run test:e2e                  # 화면 캡처 저장
 *   SITE_DIR=public SITE_PATH=/project20261105/ npm run test:e2e   # 다른 폴더를 하위 경로에 올린 것처럼 점검
 *
 * 확인: ① 질문창(키 없음 모드) ② KC·리콜 ③ KS ④ 변경체크(Pyodide 엔진 로딩 → 샘플 대조 → 근거 → XLSX/DOCX 내려받기)
 *       휴대폰 폭 레이아웃(가로 스크롤 없음) · 콘솔 오류 없음 · 외부 도메인 요청 없음(자체 호스팅)
 */
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

// Playwright 는 개발 의존성으로 넣지 않는다(브라우저 설치가 무거움). 전역 설치본 또는 npx playwright 를 쓴다.
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// SITE_DIR=다른 폴더 — 예: GitLab 처럼 site.tar.gz 를 풀어 만든 public/ 을 그대로 점검
const DIST = process.env.SITE_DIR ? resolve(ROOT, process.env.SITE_DIR) : join(ROOT, 'dist');
// SITE_PATH=/하위/경로/ — 사이트를 그 경로 아래에 올린 것처럼 띄운다 (GitHub Pages·GitLab Pages 의 /<프로젝트>/). 기본은 맨 위(/)
const PREFIX = `/${(process.env.SITE_PATH ?? '').replace(/^\/+|\/+$/g, '')}/`.replace('//', '/');
const SHOTS = process.env.SCREENSHOTS ? join(ROOT, process.env.SCREENSHOTS) : null;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.whl': 'application/zip',
  '.zip': 'application/zip',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

let server;
let base = process.env.SITE_URL;
if (!base) {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('dist/ 가 없습니다. npm run build 를 먼저 실행하세요.');
    process.exit(1);
  }
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (!url.pathname.startsWith(PREFIX)) {
      res.writeHead(404).end('not found');
      return;
    }
    let p = join(DIST, decodeURIComponent(url.pathname.slice(PREFIX.length - 1)));
    if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
    if (!p.startsWith(DIST) || !existsSync(p)) {
      res.writeHead(404).end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' }).end(readFileSync(p));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}${PREFIX}`;
}
const origin = new URL(base).origin;

const results = [];
async function step(name, fn) {
  const t0 = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - t0 });
    console.log(`  ✓ ${name} (${Date.now() - t0}ms)`);
  } catch (err) {
    results.push({ name, ok: false, ms: Date.now() - t0, err: String(err?.message ?? err).split('\n')[0] });
    console.log(`  ✗ ${name}: ${String(err?.message ?? err).split('\n')[0]}`);
  }
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true, deviceScaleFactor: SHOTS ? 2 : 1, locale: 'ko-KR' });
const page = await context.newPage();
const consoleErrors = [];
const foreign = new Set();
page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text()));
page.on('pageerror', (e) => consoleErrors.push(String(e)));
page.on('request', (r) => {
  const u = new URL(r.url());
  if (!['data:', 'blob:'].includes(u.protocol) && u.origin !== origin) foreign.add(u.origin);
});
// 결과로 부드럽게 스크롤하는 도중에 찍으면 화면이 어긋나 보이므로, 스크롤이 멈춘 뒤에 찍는다.
async function settle(p) {
  let last = -1;
  for (let i = 0; i < 20; i++) {
    const y = await p.evaluate(() => Math.round(window.scrollY));
    if (y === last) return;
    last = y;
    await p.waitForTimeout(150);
  }
}
const shot = async (name, full = false) => SHOTS && (mkdirSync(SHOTS, { recursive: true }), await settle(page), await page.screenshot({ path: join(SHOTS, name), fullPage: full }));

console.log(`E2E: ${base}`);

await step('① 질문창 — 수입·판매 질문에 KC·리콜·KS 카드와 기준일', async () => {
  await page.goto(base + '#/');
  await page.getByRole('heading', { name: /질문 하나로/ }).waitFor();
  await shot('01_home.png');
  await page.locator('#ask-input').fill('전기난로를 수입해 팔려면 뭐가 필요해?');
  await page.getByRole('button', { name: '물어보기' }).click();
  await page.getByText('이렇게 이해했어요').waitFor({ timeout: 60000 });
  const body = await page.locator('main').innerText();
  for (const must of ['수입 준비', '전기난로', '② KC 인증', '② 리콜', '③ KS 표준', 'KS C IEC 60335-2-30', '전기스토브', '기준 공공데이터', '1670-4920']) {
    if (!body.includes(must)) throw new Error(`답변에 '${must}' 없음`);
  }
  if (!(await page.locator('a[href*="safetykorea.kr"]').count())) throw new Error('제품안전정보센터 원문 링크 없음');
  await page.getByText('이렇게 이해했어요').scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, -90));
  await shot('02_ask_answer.png');
});

await step('② KC·리콜 — 인증번호로 현재 상태 링크', async () => {
  await page.goto(base + '#/kc?q=XU070339-19001B');
  await page.getByText('지금 상태 확인').waitFor({ timeout: 60000 });
  const link = await page.locator('a', { hasText: '지금 상태 확인' }).first().getAttribute('href');
  if (!link?.includes('searchPop?certNum=XU070339-19001B')) throw new Error(`링크 이상: ${link}`);
});

await step('② KC·리콜 — 제품명 검색(품목 집계·리콜 탭)', async () => {
  await page.goto(base + '#/kc?q=' + encodeURIComponent('유모차'));
  await page.getByRole('heading', { name: '품목별 인증 현황' }).waitFor({ timeout: 60000 });
  await shot('03_kc.png');
  await page.getByRole('tab', { name: /리콜/ }).click();
  await page.locator('article[aria-label^="리콜"]').first().waitFor();
});

await step('③ KS — 표준번호·생활 용어 검색', async () => {
  await page.goto(base + '#/ks?q=60335-2-30');
  await page.getByText('실내용 난방기의 개별 요구사항').first().waitFor({ timeout: 60000 });
  await page.goto(base + '#/ks?q=' + encodeURIComponent('전기난로'));
  await page.getByText("생활 용어 → 표준명 '실내용 난방기'").first().waitFor({ timeout: 30000 });
  await shot('04_ks.png');
});

await step('④ 변경체크 — Pyodide 엔진 로딩', async () => {
  await page.goto(base + '#/diff');
  await page.getByRole('button', { name: /가정용 전기기기 안전 가상규정/ }).waitFor({ timeout: 30000 });
  // 엔진 준비 표시가 사라질 때까지 (최대 3분). 실패하면 오류 문구를 그대로 보고한다.
  const status = page.getByTestId('engine-status');
  const t0 = Date.now();
  while (Date.now() - t0 < 180000) {
    if (!(await status.count())) return;
    const text = await status.innerText().catch(() => '');
    if (text.includes('준비하지 못했습니다')) throw new Error(text.slice(0, 300));
    await page.waitForTimeout(500);
  }
  throw new Error('엔진 준비 시간 초과');
});

await step('④ 변경체크 — 샘플 대조·근거·검토', async () => {
  await page.getByRole('button', { name: /가정용 전기기기 안전 가상규정/ }).click();
  await page.getByRole('button', { name: '2. 대조 실행' }).click();
  await page.getByRole('tab', { name: '변경대조표' }).waitFor({ timeout: 120000 });
  const txt = await page.locator('main').innerText();
  for (const must of ['조항 (구판 → 신판)', '바뀐 조항', '가상 규정', '규칙 엔진 결과']) if (!txt.includes(must)) throw new Error(`결과에 '${must}' 없음`);
  await shot('05_diff_result.png');
  await page.locator('.change-row').first().click();
  await page.getByText('원문 근거').first().waitFor();
  if (!(await page.locator('mark.ev').count())) throw new Error('근거 하이라이트 없음');
  await page.getByRole('button', { name: '확인', exact: true }).first().click();
  await page.locator('.change-row .badge.ok', { hasText: '확인' }).first().waitFor({ timeout: 20000 });
  await shot('06_diff_detail.png');
  await page.getByRole('tab', { name: '수치·기한' }).click();
  await page.getByText('수치 동등').first().waitFor();
  await page.getByRole('tab', { name: /대응 체크리스트/ }).click();
  await page.getByRole('tab', { name: /조항 연결/ }).click();
  await page.getByText('분할 1→N').first().waitFor();
});

for (const [fmt, label, magic] of [
  ['xlsx', 'XLSX (7시트)', 'PK'],
  ['docx', 'DOCX 보고서', 'PK'],
]) {
  await step(`④ 변경체크 — ${fmt.toUpperCase()} 내려받기(브라우저 생성)`, async () => {
    const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 60000 }), page.getByRole('button', { name: `⬇ ${label}` }).click()]);
    const path = await dl.path();
    const buf = readFileSync(path);
    if (buf.length < 2000 || buf.subarray(0, 2).toString() !== magic) throw new Error(`${dl.suggestedFilename()} 파일 이상 (${buf.length}B)`);
  });
}

await step('④ 변경체크 — 다른 형식(PDF·DOCX·HWPX) 샘플', async () => {
  for (const name of [/Battery safety/, /Machinery safety/, /LED 조명기기/]) {
    await page.getByRole('button', { name }).click();
    await page.getByRole('button', { name: '2. 대조 실행' }).click();
    await page.getByRole('button', { name: '2. 대조 실행' }).waitFor({ timeout: 120000 });
    await page.locator('.stat').first().waitFor({ timeout: 120000 });
    const err = await page.locator('.notice.bad').count();
    if (err) throw new Error(`${name}: 오류 표시`);
  }
});

await step('설정 — 키 없음 기본, 키는 저장 전 전송 없음', async () => {
  await page.goto(base + '#/settings');
  await page.getByRole('heading', { name: 'AI 연결' }).waitFor();
  const checked = await page.locator('input[name="mode"]').first().isChecked();
  if (!checked) throw new Error('기본 모드가 키 없음이 아님');
});

await step('안내 — 출처·기준일·공개 JSON 목록', async () => {
  await page.goto(base + '#/about');
  await page.getByRole('heading', { name: '데이터 출처와 기준일' }).waitFor();
  await page.getByText('ks.json').first().waitFor({ timeout: 20000 });
  const meta = await (await page.request.get(base + 'data/v1/meta.json')).json();
  if (meta.schema !== 'kats-superapp/data/v1' || meta.counts.ks !== 33266) throw new Error('meta.json 이상');
});

// 휴대폰 폭 — 가로 스크롤 없음
await step('휴대폰 폭(390px) — 하단 탭·가로 스크롤 없음', async () => {
  const m = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: SHOTS ? 3 : 1, isMobile: true, hasTouch: true, locale: 'ko-KR' });
  const p = await m.newPage();
  for (const route of ['#/', '#/kc?q=' + encodeURIComponent('보조배터리'), '#/ks?q=' + encodeURIComponent('완구'), '#/about']) {
    await p.goto(base + route);
    await p.waitForTimeout(route === '#/' ? 300 : 2500);
    const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 1) throw new Error(`${route}: 가로 넘침 ${over}px`);
  }
  await p.goto(base + '#/');
  if (!(await p.locator('.tabbar').isVisible())) throw new Error('하단 탭 없음');
  if (SHOTS) (await settle(p), await p.screenshot({ path: join(SHOTS, '07_mobile_home.png') }));
  await p.locator('#ask-input').fill('보조배터리 리콜 있었어?');
  await p.getByRole('button', { name: '물어보기' }).click();
  await p.getByText('이렇게 이해했어요').waitFor({ timeout: 60000 });
  if (SHOTS) (await settle(p), await p.screenshot({ path: join(SHOTS, '08_mobile_answer.png') }));
  // 휴대폰에서 변경체크 결과 화면도 가로로 넘치지 않아야 한다
  await p.goto(base + '#/diff');
  await p.getByRole('button', { name: /가정용 전기기기 안전 가상규정/ }).click();
  await p.getByRole('button', { name: '2. 대조 실행' }).click();
  await p.getByRole('tab', { name: '변경대조표' }).waitFor({ timeout: 180000 });
  await p.locator('.change-row').first().click();
  await p.waitForTimeout(500);
  const over = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (over > 1) throw new Error(`#/diff 결과: 가로 넘침 ${over}px`);
  if (SHOTS) (await settle(p), await p.screenshot({ path: join(SHOTS, '09_mobile_diff.png') }));
  await m.close();
});

await step('콘솔 오류 없음 · 외부 도메인 요청 없음', async () => {
  const errs = consoleErrors.filter((e) => !/favicon/.test(e));
  if (errs.length) throw new Error(`콘솔 오류 ${errs.length}건: ${errs.slice(0, 3).join(' | ')}`);
  if (foreign.size) throw new Error(`외부 요청: ${[...foreign].join(', ')}`);
});

await browser.close();
server?.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
