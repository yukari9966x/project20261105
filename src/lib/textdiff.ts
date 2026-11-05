/** 조항 본문 비교용 낱말 단위 차이 (LCS). 화면 표시용이며 판정은 엔진 결과를 따른다. */
export type DiffPart = { type: 'same' | 'del' | 'ins'; text: string };

function tokens(s: string): string[] {
  return s.match(/[0-9A-Za-z가-힣.]+|\s+|[^\s0-9A-Za-z가-힣.]/g) ?? [];
}

export function wordDiff(a: string, b: string, maxTokens = 1800): DiffPart[] {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length > maxTokens || tb.length > maxTokens) return [{ type: 'del', text: a }, { type: 'ins', text: b }];
  const n = ta.length;
  const m = tb.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = ta[i] === tb[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffPart[] = [];
  const push = (type: DiffPart['type'], text: string) => {
    const last = out[out.length - 1];
    if (last && last.type === type) last.text += text;
    else out.push({ type, text });
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (ta[i] === tb[j]) {
      push('same', ta[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) push('del', ta[i++]);
    else push('ins', tb[j++]);
  }
  while (i < n) push('del', ta[i++]);
  while (j < m) push('ins', tb[j++]);
  return out;
}
