/**
 * build-index.ts — KS·KC·리콜 공개 데이터와 검색 색인, meta.json(기준 시각·건수·출처)을 만든다.
 *
 *   입력: data/raw/ks_standards.csv · data/raw/safety/*.csv(.gz) · data/raw/SOURCES.json
 *         data/snapshot/safety-api.json (scripts/fetch-safety.ts 결과, 있으면)
 *   출력: public/data/v1/ (빌드 때 dist/data/v1/ 로 복사됨)  — DATA_OUT_DIR 로 바꿀 수 있음
 *
 * KC 인증은 전체 건수가 커서(파일데이터만 15만 건) 최근 KC_MAX_RECORDS 건만 개별 검색용으로 넣고,
 * 전량은 제품명별 집계(kc-summary.json)로 넣는다. 나머지는 화면에서 제품안전정보센터 검색으로 연결한다.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import MiniSearch from 'minisearch';
import { csvObjects } from './lib/csv';
import { SRC, kcFromFile, recallDedupKey, recallFromDomesticFile, recallFromForeignFile } from './lib/safety';
import type { KcRecord, KcSummaryRow, KsRecord, KsStatus, Meta, RecallRecord, SourceRef } from '../src/data/types';
import { SCHEMA_VERSION } from '../src/data/types';
import { KC_SUMMARY_INDEX, KS_INDEX, RECALL_INDEX, kcSummaryDoc, ksDoc, recallDoc } from '../src/search/indexes';
import { formatKsNo, koDate, koDateTime } from '../src/lib/format';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.DATA_OUT_DIR ? join(ROOT, process.env.DATA_OUT_DIR) : join(ROOT, 'public', 'data', 'v1');
const KC_MAX_RECORDS = Number(process.env.KC_MAX_RECORDS ?? 30000);
const SNAPSHOT = join(ROOT, 'data', 'snapshot', 'safety-api.json');

interface RawSource {
  path: string;
  dataset: string;
  data_go_kr_id: string;
  url: string;
  provider: string;
  license: string;
  basis_date: string;
  rows: number;
  record_date_range?: [string, string];
}

interface Snapshot {
  status: Meta['api']['status'];
  fetchedAt: string | null;
  message: string;
  kc: KcRecord[];
  recalls: RecallRecord[];
}

const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

function readText(path: string, encoding: 'utf-8' | 'euc-kr'): string {
  let buf = readFileSync(join(ROOT, path));
  if (path.endsWith('.gz')) buf = gunzipSync(buf);
  return new TextDecoder(encoding).decode(buf);
}

function writeJson(name: string, data: unknown, description: string, files: Meta['files']) {
  const text = JSON.stringify(data);
  writeFileSync(join(OUT, name), text);
  files[name] = { path: `data/v1/${name}`, bytes: Buffer.byteLength(text), sha256: sha(text), description };
}

function main() {
  const t0 = Date.now();
  const sources = JSON.parse(readFileSync(join(ROOT, 'data', 'raw', 'SOURCES.json'), 'utf8')) as { files: RawSource[] };
  const byId = (id: string) => sources.files.find((f) => f.data_go_kr_id === id)!;
  const generatedAt = new Date().toISOString();

  // ------------------------------------------------------------------ KS
  const ksSrc = byId('15131276');
  const ks: KsRecord[] = csvObjects(readText(ksSrc.path, 'utf-8')).map((r) => {
    const no = r['한국산업표준번호'];
    return {
      no,
      label: formatKsNo(no),
      name: r['한글표준명'],
      status: r['최종고시상태'] as KsStatus,
      intl: r['국제표준인용여부'] === 'Y',
      div: no.slice(2, 3),
    };
  });

  // ------------------------------------------------------------------ 제품안전 (파일데이터 + API 스냅샷)
  const kcSrc = byId('15040703');
  const domSrc = byId('15040696');
  const forSrc = byId('15040707');
  const kcFile = csvObjects(readText(kcSrc.path, 'euc-kr')).map(kcFromFile).filter((r) => r.certNum);
  const domFile = csvObjects(readText(domSrc.path, 'euc-kr')).map(recallFromDomesticFile);
  const forFile = csvObjects(readText(forSrc.path, 'euc-kr')).map(recallFromForeignFile);

  let snap: Snapshot = { status: 'no-key', fetchedAt: null, message: '수집 결과 없음 (scripts/fetch-safety.ts 를 실행하지 않음)', kc: [], recalls: [] };
  if (existsSync(SNAPSHOT)) snap = JSON.parse(readFileSync(SNAPSHOT, 'utf8')) as Snapshot;

  // KC: API 수집분이 같은 인증번호의 파일데이터를 대신한다
  const kcByNum = new Map<string, KcRecord>();
  for (const r of kcFile) kcByNum.set(r.certNum, r);
  for (const r of snap.kc ?? []) if (r.certNum) kcByNum.set(r.certNum, r);
  const kcAll = [...kcByNum.values()];
  const kcDate = (r: KcRecord) => r.signDate || r.certDate || '';
  kcAll.sort((a, b) => kcDate(b).localeCompare(kcDate(a)) || a.certNum.localeCompare(b.certNum));
  const kc = kcAll.slice(0, KC_MAX_RECORDS);

  // 제품명별 집계 (전량)
  const groups = new Map<string, KcSummaryRow & { cats: Map<string, number> }>();
  for (const r of kcAll) {
    const key = r.productName || '(제품명 없음)';
    let g = groups.get(key);
    if (!g) {
      g = { productName: key, categoryName: '', total: 0, divs: {}, states: {}, first: '9999', last: '', src: [], cats: new Map() };
      groups.set(key, g);
    }
    g.total++;
    const div = r.certDiv.replace(/\s+/g, '');
    g.divs[div] = (g.divs[div] ?? 0) + 1;
    const st = r.certState.replace(/\s+/g, '') || '(미기재)';
    g.states[st] = (g.states[st] ?? 0) + 1;
    if (r.categoryName) g.cats.set(r.categoryName, (g.cats.get(r.categoryName) ?? 0) + 1);
    const d = r.certDate || r.signDate || '';
    if (d && d < g.first) g.first = d;
    if (d > g.last) g.last = d;
    if (!g.src.includes(r.src)) g.src.push(r.src);
  }
  const kcSummary: KcSummaryRow[] = [...groups.values()]
    .map(({ cats, ...g }) => ({ ...g, first: g.first === '9999' ? '' : g.first, categoryName: [...cats.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '' }))
    .sort((a, b) => b.total - a.total);

  // 리콜: API 를 먼저 넣고 같은 건의 파일데이터는 뺀다
  const recallMap = new Map<string, RecallRecord>();
  for (const r of snap.recalls ?? []) recallMap.set(recallDedupKey(r), r);
  for (const r of [...domFile, ...forFile]) if (!recallMap.has(recallDedupKey(r))) recallMap.set(recallDedupKey(r), r);
  const recalls = [...recallMap.values()].sort((a, b) => b.publishDate.localeCompare(a.publishDate) || a.id.localeCompare(b.id));

  // ------------------------------------------------------------------ 색인
  const ksIndex = new MiniSearch(KS_INDEX);
  ksIndex.addAll(ks.map(ksDoc));
  const kcSummaryIndex = new MiniSearch(KC_SUMMARY_INDEX);
  kcSummaryIndex.addAll(kcSummary.map(kcSummaryDoc));
  const recallIndex = new MiniSearch(RECALL_INDEX);
  recallIndex.addAll(recalls.map(recallDoc));

  // ------------------------------------------------------------------ 출처·meta
  const fileSource = (id: string, s: RawSource, count: number, note?: string): SourceRef => ({
    id,
    kind: 'file',
    title: s.dataset,
    provider: s.provider,
    url: s.url,
    license: s.license,
    basis: s.basis_date,
    basisLabel: `${koDate(s.basis_date)} 기준 공공데이터`,
    count,
    note,
  });
  const apiCount = (snap.kc?.length ?? 0) + (snap.recalls?.length ?? 0);
  const srcs: Record<string, SourceRef> = {
    'file:15131276': fileSource('file:15131276', ksSrc, ks.length, '갱신주기 수시 — 바뀔 때만 교체'),
    [SRC.kcFile]: fileSource(SRC.kcFile, kcSrc, kcFile.length, `인증일자 ${kcSrc.record_date_range?.join(' ~ ')} 자료. 현재 상태는 제품안전정보센터에서 확인`),
    [SRC.recallDomesticFile]: fileSource(SRC.recallDomesticFile, domSrc, domFile.length, `등록일 ${domSrc.record_date_range?.join(' ~ ')} 자료`),
    [SRC.recallForeignFile]: fileSource(SRC.recallForeignFile, forSrc, forFile.length, `공표일 ${forSrc.record_date_range?.join(' ~ ')} 자료`),
  };
  if (apiCount > 0 || snap.fetchedAt) {
    srcs[SRC.api] = {
      id: SRC.api,
      kind: 'api',
      title: '제품안전정보센터 Open API (KC인증·국내리콜·국외리콜·해외직구 안전성조사)',
      provider: '산업통상부 국가기술표준원 제품안전정보센터',
      url: 'https://www.data.go.kr/data/15116894/openapi.do',
      license: '공공데이터포털 이용허락 조건에 따름',
      basis: snap.fetchedAt ?? '',
      basisLabel: snap.fetchedAt ? `${koDateTime(snap.fetchedAt)} 수집` : '수집 기록 없음',
      count: apiCount,
      note: snap.message,
    };
  }

  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const files: Meta['files'] = {};
  const wrap = <T>(src: string[], records: T[]) => ({ schema: SCHEMA_VERSION, generatedAt, sources: src, records });
  writeJson('ks.json', wrap(['file:15131276'], ks), 'KS 국가표준 목록 (표준번호·표준명·최종고시상태·국제표준인용여부)', files);
  writeJson('ks.index.json', ksIndex, 'KS 검색 색인 (MiniSearch 7, 한글 2글자 토큰. 문서 id = ks.json records 순번)', files);
  writeJson('kc.json', wrap([SRC.kcFile, ...(snap.kc?.length ? [SRC.api] : [])], kc), `KC 인증 최근 ${kc.length.toLocaleString()}건 (Open API certificationList 필드 이름)`, files);
  writeJson('kc-summary.json', wrap([SRC.kcFile, ...(snap.kc?.length ? [SRC.api] : [])], kcSummary), `제품명별 KC 인증 집계 (전량 ${kcAll.length.toLocaleString()}건 기준: 인증구분·인증상태 분포)`, files);
  writeJson('kc-summary.index.json', kcSummaryIndex, 'KC 제품명 집계 검색 색인 (문서 id = kc-summary.json records 순번)', files);
  writeJson('recall.json', wrap(Object.keys(srcs).filter((k) => k !== 'file:15131276' && k !== SRC.kcFile), recalls), '국내·국외·해외직구 리콜 (공표일 최신순)', files);
  writeJson('recall.index.json', recallIndex, '리콜 검색 색인 (문서 id = recall.json records 순번)', files);

  const meta: Meta = {
    schema: SCHEMA_VERSION,
    generatedAt,
    sources: srcs,
    counts: { ks: ks.length, kc: kc.length, kcAll: kcAll.length, recall: recalls.length, kcSummary: kcSummary.length },
    api: { status: snap.status, fetchedAt: snap.fetchedAt, message: snap.message },
    files,
    notices: [
      '경진대회 시제품 — 국가기술표준원 공식 서비스가 아닙니다.',
      '인증 상태·리콜 여부의 최종 확인은 제품안전정보센터(www.safetykorea.kr), KS 는 e-나라표준인증(standard.go.kr)에서 하세요.',
      '모든 값은 출처 원본 그대로이며, 각 레코드의 src 가 sources 의 키입니다.',
    ],
  };
  writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));

  const mb = (n: number) => (n / 1048576).toFixed(1) + 'MB';
  const total = Object.values(files).reduce((n, f) => n + f.bytes, 0);
  console.log(
    `[build-index] KS ${ks.length.toLocaleString()} · KC ${kc.length.toLocaleString()}/${kcAll.length.toLocaleString()} (집계 ${kcSummary.length.toLocaleString()}품목) · 리콜 ${recalls.length.toLocaleString()} · API ${snap.status}(${apiCount}) → ${mb(total)} (${Date.now() - t0}ms)`,
  );
  for (const [k, f] of Object.entries(files)) console.log(`  ${k.padEnd(20)} ${mb(f.bytes)}`);
}

main();
