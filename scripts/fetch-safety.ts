/**
 * fetch-safety.ts — (CI 전용) 제품안전정보센터 Open API 로 KC 인증·국내리콜·국외리콜·해외직구 안전성조사 결과를
 * 받아 data/snapshot/safety-api.json 에 쓴다. 이어서 build-index.ts 가 파일데이터와 합쳐 /data/v1 을 만든다.
 *
 * 환경변수
 *   SAFETYKOREA_AUTH_KEY     서비스 ID (HTTP 헤더 AuthKey). CI 비밀변수에만 둔다. 사이트에는 절대 들어가지 않는다.
 *   PUBLIC_SITE_URL          배포된 사이트 주소. 여기 /data/v1 의 API 수집분을 '직전 스냅샷'으로 이어받는다.
 *                            공백·쉼표로 여러 개를 적으면 앞에서부터 시도한다. http(s) 주소가 아닌 값은 건너뛴다
 *                            (Pages 가 꺼진 GitLab 은 $CI_PAGES_URL 이 비어 "/" 만 넘어온다 → 다음 주소인 GitHub Pages 사용).
 *   SAFETYKOREA_API_BASE     기본 https://www.safetykorea.kr/openapi/api/
 *   SAFETY_BACKFILL_DAYS     첫 수집 때 리콜을 거슬러 받을 날수 (기본 365)
 *   SAFETY_KC_BACKFILL_DAYS  첫 수집 때 KC 인증을 거슬러 받을 날수 (기본 30)
 *   SAFETY_OVERLAP_DAYS      직전 수집 이후 다시 확인할 겹침 날수 (기본 7, 늦게 등록된 건 보정)
 *   SAFETY_MAX_REQUESTS      한 번에 보낼 최대 요청 수 (기본 2500)
 *   SAFETY_REQUEST_DELAY_MS  요청 간격 (기본 200ms — 서비스 운영에 지장을 주지 않도록)
 *   SAFETY_SNAPSHOT_PATH     결과 파일 경로 (기본 data/snapshot/safety-api.json)
 *
 * 실패해도 빌드를 멈추지 않는다: 키가 없거나 호출이 실패하면 직전 스냅샷을 그대로 쓰고, 화면에 그 기준 시각을 표시한다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { KcRecord, Meta, RecallRecord } from '../src/data/types';
import { ApiFatalError, ENDPOINTS, MAX_ROWS, buildUrl, dayRange, mergeKc, mergeRecalls, normalizeRows, parseResponse, type Endpoint } from './lib/safety-api';
import { SRC } from './lib/safety';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.SAFETY_SNAPSHOT_PATH ? resolve(process.env.SAFETY_SNAPSHOT_PATH) : join(ROOT, 'data', 'snapshot', 'safety-api.json');

const env = (k: string, d = '') => (process.env[k] ?? '').trim() || d;
const KEY = env('SAFETYKOREA_AUTH_KEY') || env('SAFETY_API_KEY');
const BASE = env('SAFETYKOREA_API_BASE', 'https://www.safetykorea.kr/openapi/api/');
const SITES = siteUrls(env('PUBLIC_SITE_URL'));
const BACKFILL = Number(env('SAFETY_BACKFILL_DAYS', '365'));
const KC_BACKFILL = Number(env('SAFETY_KC_BACKFILL_DAYS', '30'));
const OVERLAP = Number(env('SAFETY_OVERLAP_DAYS', '7'));
const MAX_REQ = Number(env('SAFETY_MAX_REQUESTS', '2500'));
const DELAY = Number(env('SAFETY_REQUEST_DELAY_MS', '200'));

export interface Snapshot {
  schema: 'kats-superapp/safety-snapshot/v1';
  status: Meta['api']['status'];
  fetchedAt: string | null;
  message: string;
  kc: KcRecord[];
  recalls: RecallRecord[];
  log: string[];
}

/** PUBLIC_SITE_URL 값에서 쓸 수 있는 사이트 주소만 고른다 (끝에 '/' 를 붙여 돌려줌) */
export function siteUrls(value: string): string[] {
  return value
    .split(/[\s,]+/)
    .filter((u) => /^https?:\/\/[^/]+/i.test(u))
    .map((u) => (u.endsWith('/') ? u : u + '/'));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson(url: string, headers: Record<string, string> = {}, timeoutMs = 30000): Promise<unknown> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers: { accept: 'application/json', ...headers }, signal: ctl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/** 직전 스냅샷: 배포된 사이트의 /data/v1 에서 API 수집분만 골라 온다 (없으면 로컬 파일) */
async function loadPrevious(log: string[]): Promise<{ kc: KcRecord[]; recalls: RecallRecord[]; fetchedAt: string | null }> {
  for (const base of SITES) {
    try {
      const meta = (await getJson(base + 'data/v1/meta.json')) as Meta;
      const kc = ((await getJson(base + 'data/v1/kc.json')) as { records: KcRecord[] }).records.filter((r) => r.src === SRC.api);
      const recalls = ((await getJson(base + 'data/v1/recall.json')) as { records: RecallRecord[] }).records.filter((r) => r.src === SRC.api);
      log.push(`직전 스냅샷(배포 사이트 ${base}): API 수집분 KC ${kc.length}건, 리콜 ${recalls.length}건, 수집 ${meta.api?.fetchedAt ?? '없음'}`);
      return { kc, recalls, fetchedAt: meta.api?.fetchedAt ?? null };
    } catch (err) {
      log.push(`직전 스냅샷을 ${base} 에서 못 받음: ${String(err)}`);
    }
  }
  if (existsSync(OUT)) {
    const s = JSON.parse(readFileSync(OUT, 'utf8')) as Snapshot;
    log.push(`직전 스냅샷(로컬 파일): KC ${s.kc.length}건, 리콜 ${s.recalls.length}건`);
    return { kc: s.kc, recalls: s.recalls, fetchedAt: s.fetchedAt };
  }
  return { kc: [], recalls: [], fetchedAt: null };
}

export async function run(): Promise<Snapshot> {
  const log: string[] = [];
  const prev = await loadPrevious(log);
  const keep = (status: Snapshot['status'], message: string): Snapshot => ({
    schema: 'kats-superapp/safety-snapshot/v1',
    status: prev.kc.length + prev.recalls.length > 0 && status !== 'ok' ? 'stale' : status,
    fetchedAt: prev.fetchedAt,
    message,
    kc: prev.kc,
    recalls: prev.recalls,
    log,
  });

  if (!KEY) return keep('no-key', '서비스키(SAFETYKOREA_AUTH_KEY)가 없어 API 를 부르지 않음 — 공공데이터포털 파일데이터와 직전 스냅샷을 표시');

  const now = new Date();
  const since = (days: number) => new Date(now.getTime() - days * 86400_000);
  const start = prev.fetchedAt ? new Date(Date.parse(prev.fetchedAt) - OVERLAP * 86400_000) : null;
  let requests = 0;
  let errors = 0;
  const fresh: { kc: KcRecord[]; recalls: RecallRecord[] } = { kc: [], recalls: [] };

  async function call(ep: Endpoint, key: string, value: string): Promise<number> {
    if (requests >= MAX_REQ) throw new Error(`요청 상한(${MAX_REQ}) 도달`);
    requests++;
    if (requests > 1) await sleep(DELAY);
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = parseResponse(await getJson(buildUrl(BASE, ep, key, value), { AuthKey: KEY }));
        const norm = normalizeRows(ep, res.rows);
        fresh.kc.push(...norm.kc);
        fresh.recalls.push(...norm.recalls);
        if (res.rows.length >= MAX_ROWS) log.push(`경고: ${ENDPOINTS[ep].label} ${key}=${value} 결과가 ${MAX_ROWS}줄 상한에 닿음(일부 누락 가능)`);
        return res.rows.length;
      } catch (err) {
        if (err instanceof ApiFatalError) throw err;
        lastErr = err;
        await sleep(1000 * 2 ** attempt);
      }
    }
    errors++;
    log.push(`실패: ${ENDPOINTS[ep].label} ${key}=${value}: ${String(lastErr)}`);
    return -1;
  }

  try {
    for (const ep of ['recall', 'fRecall', 'overseas'] as Endpoint[]) {
      let days: string[];
      if (start) days = dayRange(start, now);
      else {
        // 첫 수집: 전체 조회가 1,000줄 미만이면 그것이 전량이다
        const n = await call(ep, 'all', 'all');
        if (n >= 0 && n < MAX_ROWS) {
          log.push(`${ENDPOINTS[ep].label}: 전체 ${n}건 (전량)`);
          continue;
        }
        days = dayRange(since(BACKFILL), now);
      }
      let got = 0;
      for (const d of days) got += Math.max(0, await call(ep, ENDPOINTS[ep].dateKey, d));
      log.push(`${ENDPOINTS[ep].label}: ${days[0]}~${days[days.length - 1]} ${days.length}일, ${got}건`);
    }
    const kcDays = dayRange(start ?? since(KC_BACKFILL), now);
    let got = 0;
    for (const d of kcDays) got += Math.max(0, await call('kc', ENDPOINTS.kc.dateKey, d));
    log.push(`${ENDPOINTS.kc.label}: ${kcDays[0]}~${kcDays[kcDays.length - 1]} ${kcDays.length}일, ${got}건`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.push(`중단: ${msg}`);
    if (err instanceof ApiFatalError || (fresh.kc.length === 0 && fresh.recalls.length === 0)) {
      return keep('failed', `API 수집 실패(${msg}) — 직전 스냅샷을 그대로 사용`);
    }
    errors++;
  }

  const kc = mergeKc(prev.kc, fresh.kc);
  const recalls = mergeRecalls(prev.recalls, fresh.recalls);
  return {
    schema: 'kats-superapp/safety-snapshot/v1',
    status: errors ? 'partial' : 'ok',
    fetchedAt: now.toISOString(),
    message: `요청 ${requests}회${errors ? `, 실패 ${errors}회` : ''} · 새로 받은 KC ${fresh.kc.length}건, 리콜 ${fresh.recalls.length}건 · 누적 KC ${kc.length}건, 리콜 ${recalls.length}건`,
    kc,
    recalls,
    log,
  };
}

export async function main(): Promise<Snapshot> {
  const snap = await run();
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(snap));
  console.log(`[fetch-safety] ${snap.status}: ${snap.message}`);
  for (const line of snap.log) console.log('  ' + line);
  return snap;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    // 수집 실패가 배포를 막지 않게 한다 (직전 스냅샷 유지가 원칙)
    console.error('[fetch-safety] 예기치 않은 오류:', err);
    process.exit(0);
  });
}
