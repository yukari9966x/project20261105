/**
 * 브라우저에서 직접 부를 수 있는(CORS 허용) OpenAI 호환 공급사만 목록에 넣는다.
 * 2026-11-05 에 각 /chat/completions 주소로 CORS 사전요청(OPTIONS, Origin: *.github.io)을 보내
 * Access-Control-Allow-Origin 응답을 확인했다. Anthropic 의 OpenAI 호환 주소는 허용하지 않아 뺐다.
 * 모델 이름은 공급사마다 자주 바뀌므로 미리 박지 않고, 설정 화면의 '모델 목록 불러오기'(GET /models)로 고른다.
 */
export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  keyRequired: boolean;
  jsonMode: boolean;
  note: string;
  keyUrl?: string;
}

export const CORS_CHECKED_AT = '2026-11-05';

export const PROVIDERS: ProviderPreset[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', keyRequired: true, jsonMode: true, note: '함수 호출 지원', keyUrl: 'https://platform.openai.com/api-keys' },
  { id: 'gemini', name: 'Google Gemini (OpenAI 호환)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', keyRequired: true, jsonMode: true, note: 'Gemini API 키 사용', keyUrl: 'https://aistudio.google.com/apikey' },
  { id: 'upstage', name: 'Upstage Solar', baseUrl: 'https://api.upstage.ai/v1', keyRequired: true, jsonMode: false, note: '국내 공급사', keyUrl: 'https://console.upstage.ai/' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', keyRequired: true, jsonMode: false, note: '여러 모델 중계 — 모델마다 함수 호출 지원 여부가 다름', keyUrl: 'https://openrouter.ai/keys' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', keyRequired: true, jsonMode: true, note: '빠른 응답', keyUrl: 'https://console.groq.com/keys' },
  { id: 'mistral', name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', keyRequired: true, jsonMode: true, note: '', keyUrl: 'https://console.mistral.ai/api-keys' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', keyRequired: true, jsonMode: true, note: '', keyUrl: 'https://platform.deepseek.com/api_keys' },
  { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', keyRequired: true, jsonMode: false, note: '오픈 모델', keyUrl: 'https://api.together.ai/settings/api-keys' },
  { id: 'custom', name: '직접 입력 (기관 내부 LLM · Ollama · vLLM 등)', baseUrl: '', keyRequired: false, jsonMode: false, note: '서버에 CORS 허용이 필요합니다. https 사이트에서는 https 주소(또는 http://localhost)만 부를 수 있습니다.' },
];

export function presetById(id: string): ProviderPreset | undefined {
  return PROVIDERS.find((p) => p.id === id);
}
