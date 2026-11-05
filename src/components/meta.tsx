/**
 * meta.json(기준 시각·건수·출처)을 한 번 읽어 모든 화면에 나눠 준다.
 * 모든 결과 카드는 <SourceLine> 으로 "2022.8.1 기준 공공데이터 · 최신 정보는 제품안전정보센터 ↗" 를 붙인다.
 */
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { loadMeta } from '../data/load';
import type { Meta } from '../data/types';
import { OFFICIAL } from '../tools/links';

const MetaContext = createContext<{ meta: Meta | null; error: string | null }>({ meta: null, error: null });

export function MetaProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ meta: Meta | null; error: string | null }>({ meta: null, error: null });
  useEffect(() => {
    loadMeta()
      .then((meta) => setState({ meta, error: null }))
      .catch((e) => setState({ meta: null, error: e instanceof Error ? e.message : String(e) }));
  }, []);
  return <MetaContext.Provider value={state}>{children}</MetaContext.Provider>;
}

export function useMeta() {
  return useContext(MetaContext);
}

export function basisLabel(meta: Meta | null, src: string): string {
  const s = meta?.sources[src];
  return s ? s.basisLabel : '기준일 확인 중';
}

const OFFICIAL_FOR: Record<string, { name: string; url: string }> = {
  ks: { name: 'e-나라표준인증', url: OFFICIAL.ksPortal },
  safety: { name: '제품안전정보센터', url: OFFICIAL.safetyKorea },
};

/** 결과 카드 아래 한 줄: 기준일 · 출처 · 최신 정보 링크 · 원문 링크 */
export function SourceLine({ src, official = 'safety', recordUrl, recordLabel = '원문 보기' }: { src: string; official?: 'ks' | 'safety'; recordUrl?: string; recordLabel?: string }) {
  const { meta } = useMeta();
  const s = meta?.sources[src];
  const o = OFFICIAL_FOR[official];
  return (
    <div className="source">
      <span title={s ? `${s.title} · ${s.provider}` : undefined}>{s ? s.basisLabel : '기준일 확인 중'}</span>
      <span aria-hidden="true">·</span>
      <span>
        최신 정보는{' '}
        <a href={o.url} target="_blank" rel="noopener noreferrer">
          {o.name}
        </a>
      </span>
      {recordUrl && (
        <a href={recordUrl} target="_blank" rel="noopener noreferrer">
          {recordLabel} ↗
        </a>
      )}
    </div>
  );
}
