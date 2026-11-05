/**
 * 한글 2글자(bigram) 토크나이저 — 빌드 때 색인(scripts/build-index.ts)과 브라우저 검색이 같은 함수를 쓴다.
 *
 * - 한글: 붙어 있는 글자를 2글자씩 겹쳐 자른다. "전기난로" → 전기·기난·난로
 *   띄어쓰기만 다른 경우("전기 난로")도 찾도록 공백을 사이에 둔 두 글자도 한 토큰으로 넣는다(기난).
 *   한 글자 단어는 그대로 둔다(검색 때 접두어 검색으로 처리).
 * - 영문·숫자: 글자와 숫자 경계에서 나눈다. "KSC9335-2-30" → ksc·9335·2·30
 *   모델명처럼 기호로 이어진 낱말은 기호를 뺀 통째 형태도 넣는다. "SU-779" → su·779·su779
 */

const HANGUL = /[가-힣]/;
const RUN = /[가-힣]+|[a-z0-9]+(?:[-_./][a-z0-9]+)*/g;

const EN_STOP = new Set(['the', 'and', 'of', 'for', 'with', 'to', 'in', 'on', 'or', 'a', 'an', 'by', 'at', 'is']);

export function normalizeText(text: string): string {
  return text.normalize('NFKC').toLowerCase();
}

export function tokenize(text: string): string[] {
  if (!text) return [];
  const norm = normalizeText(text);
  const out: string[] = [];
  let prevHangulEnd = -1;
  let prevHangulChar = '';
  for (const m of norm.matchAll(RUN)) {
    const run = m[0];
    const start = m.index ?? 0;
    if (HANGUL.test(run[0])) {
      // 공백만 사이에 둔 앞 한글 낱말과 이어지는 두 글자 (전기 난로 → 기난)
      if (prevHangulChar && /^\s+$/.test(norm.slice(prevHangulEnd, start))) out.push(prevHangulChar + run[0]);
      if (run.length === 1) out.push(run);
      else for (let i = 0; i < run.length - 1; i++) out.push(run.slice(i, i + 2));
      prevHangulEnd = start + run.length;
      prevHangulChar = run[run.length - 1];
      continue;
    }
    prevHangulChar = '';
    const parts = run.split(/[-_./]|(?<=[a-z])(?=\d)|(?<=\d)(?=[a-z])/).filter(Boolean);
    for (const p of parts) if (!EN_STOP.has(p)) out.push(p);
    const compact = run.replace(/[-_./]/g, '');
    if (parts.length > 1 && compact.length >= 3) out.push(compact);
  }
  return out;
}

/** 검색어용: 같은 토큰을 한 번만. */
export function queryTokens(query: string): string[] {
  return [...new Set(tokenize(query))];
}

/** 표준번호·인증번호·모델명 비교용: 영문·숫자만 남긴 대문자 형태. "KS C IEC 60335-2-30" → KSCIEC60335230 */
export function compactCode(text: string): string {
  return normalizeText(text).replace(/[^a-z0-9가-힣]/g, '').toUpperCase();
}
