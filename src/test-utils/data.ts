/** 테스트용: 빌드가 만든 public/data/v1 을 파일에서 바로 읽는다 (npm run prepare-data 이후 실행). */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import MiniSearch from 'minisearch';
import type { KcData, KsData, RecallData } from '../data/load';
import type { Meta } from '../data/types';
import { KC_SUMMARY_INDEX, KS_INDEX, RECALL_INDEX } from '../search/indexes';

const DIR = join(__dirname, '..', '..', 'public', 'data', 'v1');
const read = (n: string) => {
  const p = join(DIR, n);
  if (!existsSync(p)) throw new Error(`${p} 가 없습니다. 먼저 npm run prepare-data 를 실행하세요.`);
  return readFileSync(p, 'utf8');
};

let ks: KsData | null = null;
let kc: KcData | null = null;
let rc: RecallData | null = null;

export const meta = (): Meta => JSON.parse(read('meta.json'));
export const ksData = (): KsData => (ks ??= { records: JSON.parse(read('ks.json')).records, index: MiniSearch.loadJSON(read('ks.index.json'), KS_INDEX) });
export const kcData = (): KcData =>
  (kc ??= { records: JSON.parse(read('kc.json')).records, summary: JSON.parse(read('kc-summary.json')).records, summaryIndex: MiniSearch.loadJSON(read('kc-summary.index.json'), KC_SUMMARY_INDEX) });
export const recallData = (): RecallData => (rc ??= { records: JSON.parse(read('recall.json')).records, index: MiniSearch.loadJSON(read('recall.index.json'), RECALL_INDEX) });

export const loaders = { ks: async () => ksData(), kc: async () => kcData(), recall: async () => recallData() };
