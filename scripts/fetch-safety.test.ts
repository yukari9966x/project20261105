/** fetch-safety.ts 를 모의 제품안전정보센터 API(명세서 v2.1 형식)로 끝까지 돌려 본다. */
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

let server: Server;
let base = '';
const seen: { path: string; key: string; auth: string | undefined }[] = [];
let mode: 'ok' | 'badkey' = 'ok';

beforeAll(async () => {
  server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://x');
    seen.push({ path: u.pathname, key: u.searchParams.get('conditionKey') ?? '', auth: req.headers.authkey as string | undefined });
    const send = (body: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
    if (mode === 'badkey') return send({ resultCode: '4000', resultMsg: 'Invalid Auth Key' });
    if (u.pathname.endsWith('/recall/recallList.json')) return send({ resultCode: '2000', resultMsg: 'Success', resultData: [{ recallUid: '10023056', recallProductName: '보조배터리', recallModelName: 'NAT 10000', publishDate: '20261101', harmDscr: '발열' }] });
    if (u.pathname.endsWith('/recall/fRecallList.json')) return send({ resultCode: '2000', resultData: [{ fRecallUid: 9, recallProductName: '완구', publishDate: '20261030' }] });
    if (u.pathname.endsWith('/recall/overseasList.json')) return send({ resultCode: '2004', resultMsg: 'No Data' });
    if (u.pathname.endsWith('/cert/certificationList.json')) {
      const d = u.searchParams.get('conditionValue') ?? '';
      return send({ resultCode: '2000', resultData: [{ certNum: `ZZ${d}-0001`, certState: '적합', certDate: d, signDate: d, productName: '전기스토브', modelName: 'X-1' }] });
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/openapi/api/`;
});
afterAll(() => server.close());

const dir = mkdtempSync(join(tmpdir(), 'kats-fetch-'));
beforeEach(() => {
  vi.resetModules();
  seen.length = 0;
  mode = 'ok';
  for (const k of ['SAFETYKOREA_AUTH_KEY', 'SAFETY_API_KEY', 'PUBLIC_SITE_URL']) delete process.env[k];
  Object.assign(process.env, { SAFETYKOREA_API_BASE: base, SAFETY_KC_BACKFILL_DAYS: '1', SAFETY_REQUEST_DELAY_MS: '0', SAFETY_SNAPSHOT_PATH: join(dir, `snap-${Math.random()}.json`) });
});

describe('fetch-safety (CI 수집)', () => {
  it('키가 없으면 부르지 않고 no-key', async () => {
    const { run } = await import('./fetch-safety');
    const s = await run();
    expect(s.status).toBe('no-key');
    expect(seen).toHaveLength(0);
  });

  it('키가 있으면 AuthKey 헤더로 받고, 1,000줄 미만인 전체 조회는 전량으로 본다', async () => {
    process.env.SAFETYKOREA_AUTH_KEY = 'test-service-id';
    const { main } = await import('./fetch-safety');
    const s = await main();
    expect(s.status).toBe('ok');
    expect(seen.every((r) => r.auth === 'test-service-id')).toBe(true);
    expect(seen.filter((r) => r.key === 'all').map((r) => r.path.split('/').pop())).toEqual(['recallList.json', 'fRecallList.json', 'overseasList.json']);
    expect(s.recalls.map((r) => r.id).sort()).toEqual(['dom-a-10023056', 'for-a-9']);
    expect(s.kc.length).toBeGreaterThanOrEqual(2); // 오늘·어제 등록일
    const saved = JSON.parse(readFileSync(process.env.SAFETY_SNAPSHOT_PATH!, 'utf8'));
    expect(saved.fetchedAt).toBeTruthy();
  });

  it('인증키 오류(4000)면 직전 스냅샷을 그대로 쓴다', async () => {
    const prev = { schema: 'kats-superapp/safety-snapshot/v1', status: 'ok', fetchedAt: '2026-11-01T21:00:00.000Z', message: '', kc: [{ certNum: 'OLD-1', src: 'api:safetykorea' }], recalls: [], log: [] };
    writeFileSync(process.env.SAFETY_SNAPSHOT_PATH!, JSON.stringify(prev));
    process.env.SAFETYKOREA_AUTH_KEY = 'wrong';
    mode = 'badkey';
    const { run } = await import('./fetch-safety');
    const s = await run();
    expect(s.status).toBe('stale');
    expect(s.fetchedAt).toBe(prev.fetchedAt);
    expect(s.kc.map((r) => r.certNum)).toEqual(['OLD-1']);
    expect(seen).toHaveLength(1); // 인증 오류 뒤에는 더 부르지 않음
    expect(s.message).toContain('4000');
  });
});
