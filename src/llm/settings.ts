/**
 * AI 연결 설정. 키는 기본적으로 sessionStorage 에 두어 탭을 닫으면 사라진다.
 * 사용자가 원할 때만 이 브라우저(localStorage)에 기억한다. 키는 설정한 LLM 주소 외에는 어디에도 보내지 않는다.
 * 사이트에는 시연용 키를 넣지 않는다 (정적 사이트에 넣은 키는 누구나 볼 수 있음).
 */
import { useEffect, useState } from 'react';

export type LlmMode = 'off' | 'user' | 'org';

export interface LlmSettings {
  mode: LlmMode;
  providerId: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  jsonMode: boolean;
  remember: boolean;
}

const KEY = 'kats-superapp.llm.v1';
const EVENT = 'kats-superapp:llm-settings';

export const DEFAULT_SETTINGS: LlmSettings = { mode: 'off', providerId: 'openai', baseUrl: 'https://api.openai.com/v1', model: '', apiKey: '', jsonMode: true, remember: false };

function read(store: Storage | undefined): LlmSettings | null {
  try {
    const raw = store?.getItem(KEY);
    return raw ? { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<LlmSettings>) } : null;
  } catch {
    return null;
  }
}

const safe = (fn: () => Storage) => {
  try {
    return fn();
  } catch {
    return undefined;
  }
};

export function loadSettings(): LlmSettings {
  return read(safe(() => sessionStorage)) ?? read(safe(() => localStorage)) ?? { ...DEFAULT_SETTINGS };
}

export function saveSettings(s: LlmSettings): void {
  const json = JSON.stringify(s);
  const session = safe(() => sessionStorage);
  const local = safe(() => localStorage);
  try {
    session?.setItem(KEY, json);
    if (s.remember) local?.setItem(KEY, json);
    else local?.removeItem(KEY);
  } catch {
    /* 저장소를 못 쓰는 환경(사생활 보호 모드 등)에서는 이번 화면에서만 유지 */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function clearSettings(): void {
  try {
    safe(() => sessionStorage)?.removeItem(KEY);
    safe(() => localStorage)?.removeItem(KEY);
  } catch {
    /* noop */
  }
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function isLlmReady(s: LlmSettings): boolean {
  if (s.mode === 'off' || !s.baseUrl || !s.model) return false;
  return s.mode === 'org' || !!s.apiKey;
}

export function useLlmSettings(): [LlmSettings, (s: LlmSettings) => void] {
  const [s, setS] = useState<LlmSettings>(loadSettings);
  useEffect(() => {
    const on = () => setS(loadSettings());
    window.addEventListener(EVENT, on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener(EVENT, on);
      window.removeEventListener('storage', on);
    };
  }, []);
  return [s, saveSettings];
}

export function modeLabel(s: LlmSettings): string {
  if (!isLlmReady(s)) return '키 없음 (규칙 모드)';
  return `${s.mode === 'org' ? '기관 LLM' : '사용자 키'} · ${s.model}`;
}
