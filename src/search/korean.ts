/**
 * 검색어 다듬기 — 조사(을/를/이/가…)를 문법에 맞을 때만 뗀다.
 * 받침 규칙을 보므로 '전기난로'의 '로'는 떼지 않고 '전기난로로'의 마지막 '로'만 뗀다.
 */
const HANGUL_BASE = 0xac00;

function jong(ch: string): number {
  const code = ch.charCodeAt(0) - HANGUL_BASE;
  if (code < 0 || code > 11171) return -1;
  return code % 28; // 0 = 받침 없음, 8 = ㄹ
}

const AFTER_BATCHIM = ['을', '은', '이', '과', '으로'];
const AFTER_VOWEL = ['를', '는', '가', '와'];
const ANY = ['에서', '에게', '까지', '부터', '하고', '의', '에', '께', '처럼', '보다', '마다'];

/** 끝 글자가 조사처럼 보여도 떼면 안 되는 낱말 */
const KEEP = new Set(['어린이', '아이', '놀이', '종이', '길이', '높이', '넓이', '깊이', '고양이', '오이', '거북이', '디스플레이', '플레이', '라이', '타이', '바이', '하이', '요가', '스파', '피아노', '소파', '카메라', '드라이', '가스레인지', '히어로', '에어로', '레트로', '마이크로', '매크로', '스테레오', '비디오', '오디오', '라디오']);

export function stripParticle(word: string): string {
  if (KEEP.has(word)) return word;
  // 영문·숫자 뒤 조사: LED를, USB에서, KC인증을 → LED, USB
  const latin = /^(.*[A-Za-z0-9])(에서|으로|을|를|이|가|은|는|의|에|로|와|과)$/.exec(word);
  if (latin && latin[1].length >= 2) return latin[1];
  for (const p of [...ANY].sort((a, b) => b.length - a.length)) {
    if (word.length - p.length >= 2 && word.endsWith(p)) return word.slice(0, -p.length);
  }
  for (const p of [...AFTER_BATCHIM, ...AFTER_VOWEL, '로'].sort((a, b) => b.length - a.length)) {
    if (word.length - p.length < 2 || !word.endsWith(p)) continue;
    const prev = word[word.length - p.length - 1];
    const j = jong(prev);
    if (j < 0) continue;
    if (p === '로' && (j === 0 || j === 8)) return word.slice(0, -1);
    if (AFTER_BATCHIM.includes(p) && j > 0) return word.slice(0, -p.length);
    if (AFTER_VOWEL.includes(p) && j === 0) return word.slice(0, -p.length);
  }
  return word;
}

export function cleanQuery(q: string): string {
  return q
    .replace(/[?!.,;:"'“”‘’()[\]{}<>]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(stripParticle)
    .join(' ')
    .trim();
}
