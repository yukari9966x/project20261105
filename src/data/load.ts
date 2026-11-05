/**
 * /data/v1 정적 JSON 을 필요할 때 한 번만 내려받는다 (KS·리콜 색인은 해당 화면·질문에서 처음 쓸 때 로딩).
 * 모든 결과 카드는 meta.json 의 출처·기준일을 붙여 보여 준다.
 */
import MiniSearch from 'minisearch';
import type { Dataset, KcRecord, KcSummaryRow, KsRecord, Meta, RecallRecord } from './types';
import { KC_SUMMARY_INDEX, KS_INDEX, RECALL_INDEX } from '../search/indexes';

export function siteUrl(path: string): string {
  return new URL(import.meta.env.BASE_URL + path, location.href).href;
}

export const dataUrl = (name: string) => siteUrl(`data/v1/${name}`);

const cache = new Map<string, Promise<unknown>>();

function once<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = fn().catch((err) => {
      cache.delete(key);
      throw err;
    });
    cache.set(key, p);
  }
  return p;
}

async function fetchText(name: string): Promise<string> {
  const res = await fetch(dataUrl(name));
  if (!res.ok) throw new Error(`${name} 를 불러오지 못했습니다 (HTTP ${res.status})`);
  return res.text();
}

export interface KsData {
  records: KsRecord[];
  index: MiniSearch;
}
export interface KcData {
  records: KcRecord[];
  summary: KcSummaryRow[];
  summaryIndex: MiniSearch;
}
export interface RecallData {
  records: RecallRecord[];
  index: MiniSearch;
}

export const loadMeta = () => once('meta', async () => JSON.parse(await fetchText('meta.json')) as Meta);

export const loadKs = () =>
  once<KsData>('ks', async () => {
    const [ds, idx] = await Promise.all([fetchText('ks.json'), fetchText('ks.index.json')]);
    return { records: (JSON.parse(ds) as Dataset<KsRecord>).records, index: await MiniSearch.loadJSONAsync(idx, KS_INDEX) };
  });

export const loadKc = () =>
  once<KcData>('kc', async () => {
    const [ds, sum, idx] = await Promise.all([fetchText('kc.json'), fetchText('kc-summary.json'), fetchText('kc-summary.index.json')]);
    return {
      records: (JSON.parse(ds) as Dataset<KcRecord>).records,
      summary: (JSON.parse(sum) as Dataset<KcSummaryRow>).records,
      summaryIndex: await MiniSearch.loadJSONAsync(idx, KC_SUMMARY_INDEX),
    };
  });

export const loadRecall = () =>
  once<RecallData>('recall', async () => {
    const [ds, idx] = await Promise.all([fetchText('recall.json'), fetchText('recall.index.json')]);
    return { records: (JSON.parse(ds) as Dataset<RecallRecord>).records, index: await MiniSearch.loadJSONAsync(idx, RECALL_INDEX) };
  });
