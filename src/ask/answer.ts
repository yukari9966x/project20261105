/**
 * 키 없음 모드의 답 만들기 — 의도에 맞는 미니앱(도구)을 부르고, 돌아온 원본값을 정해진 문장틀로만 요약한다.
 * 문장에는 데이터에 있는 숫자·이름만 넣고, 법적 판단(인증 대상 확정 등)은 단정하지 않는다.
 */
import type { KcData, KsData, RecallData } from '../data/load';
import { searchKc, shortDiv, type KcSearchResult } from '../tools/kc';
import { searchKs, type KsSearchResult } from '../tools/ks';
import { searchRecall, type RecallSearchResult } from '../tools/recall';
import { koDate } from '../lib/format';
import { INTENT_LABEL, parseQuestion, plan, type ParsedQuestion } from './intent';

export type Section =
  | { kind: 'kc'; title: string; lead: string; result: KcSearchResult; query: string }
  | { kind: 'recall'; title: string; lead: string; result: RecallSearchResult; query: string }
  | { kind: 'ks'; title: string; lead: string; result: KsSearchResult; query: string }
  | { kind: 'steps'; title: string; lead: string; steps: { text: string; href?: string }[] }
  | { kind: 'diff'; title: string; lead: string }
  | { kind: 'export'; title: string; lead: string }
  | { kind: 'contact'; title: string; lead: string }
  | { kind: 'empty'; title: string; lead: string };

export interface Answer {
  parsed: ParsedQuestion;
  headline: string;
  sections: Section[];
  ms: number;
}

export interface Loaders {
  ks: () => Promise<KsData>;
  kc: () => Promise<KcData>;
  recall: () => Promise<RecallData>;
}

const josa = (word: string, withBatchim: string, without: string) => {
  const c = word.charCodeAt(word.length - 1) - 0xac00;
  if (c < 0 || c > 11171) return withBatchim;
  return c % 28 ? withBatchim : without;
};

export function kcLead(r: KcSearchResult, query: string): string {
  const parts: string[] = [];
  if (r.certLookup) {
    const f = r.certLookup.found;
    parts.push(
      f
        ? `인증번호 ${f.certNum}: 공공데이터 기준 상태 '${f.certState}' (${f.productName} ${f.modelName}, 인증일 ${koDate(f.certDate)}). 상태는 바뀔 수 있으니 현재 상태를 제품안전정보센터에서 확인하세요.`
        : `인증번호 ${r.certLookup.certNum}${josa(r.certLookup.certNum, '은', '는')} 이 사이트의 KC 자료(최근 기록)에 없습니다. 제품안전정보센터 링크에서 현재 상태를 바로 확인할 수 있습니다.`,
    );
  }
  if (r.summary.length) {
    const top = r.summary.slice(0, 3).map((s) => `${s.row.productName} ${s.row.total.toLocaleString()}건`);
    const main = r.summary[0];
    parts.push(
      `'${query}' 관련 KC 인증 품목: ${top.join(' · ')}. ${main.row.productName}${josa(main.row.productName, '은', '는')} 등록된 인증의 ${Math.round(main.topDivShare * 100)}%가 '${shortDiv(main.topDiv)}'입니다. 대상 여부의 최종 판단은 제품안전정보센터의 안전관리대상 품목 안내로 확인하세요.`,
    );
  } else if (!r.certLookup && !r.records.length) {
    parts.push(`'${query}'${josa(query, '으로', '로')} 찾은 KC 인증 기록이 없습니다. 제품안전정보센터 인증정보 검색에서 직접 확인하세요.`);
  }
  if (r.expandedTerms.length) parts.push(`(생활 용어를 품목명 '${r.expandedTerms.join("', '")}'${josa(r.expandedTerms[r.expandedTerms.length - 1], '으로', '로')} 넓혀 찾았습니다)`);
  return parts.join(' ');
}

export function recallLead(r: RecallSearchResult, query: string): string {
  if (!r.total) return `'${query}'${josa(query, '으로', '로')} 찾은 리콜이 없습니다. 이 사이트의 리콜 자료 기간 밖일 수 있으니 최신 리콜은 제품안전정보센터에서 확인하세요.`;
  const latest = r.hits[0]?.record;
  const kinds = [r.byKind.domestic && `국내 ${r.byKind.domestic}`, r.byKind.foreign && `국외 ${r.byKind.foreign}`, r.byKind.overseas && `해외직구 ${r.byKind.overseas}`].filter(Boolean).join(' · ');
  return `관련 리콜 ${r.total.toLocaleString()}건 (${kinds}).${latest ? ` 가장 관련 높은 건: ${koDate(latest.publishDate)} ${latest.productName}${latest.modelName ? ` ${latest.modelName}` : ''}.` : ''}`;
}

export function ksLead(r: KsSearchResult, query: string): string {
  if (!r.total) return `'${query}'${josa(query, '으로', '로')} 찾은 KS 표준이 없습니다(폐지 제외). 표준명에 쓰이는 다른 말로 찾아 보세요.`;
  const h = r.hits[0].record;
  const exp = r.expandedTerms.length ? ` 생활 용어를 표준명 표현 '${r.expandedTerms.join("', '")}'${josa(r.expandedTerms[r.expandedTerms.length - 1], '으로', '로')} 넓혀 찾았습니다.` : '';
  return `관련 KS ${r.total.toLocaleString()}건(폐지 제외). 대표: ${h.label} 「${h.name}」 — 최종고시상태 '${h.status}', 국제표준 인용 ${h.intl ? '예' : '아니오'}.${exp}`;
}

export async function answerQuestion(question: string, loaders: Loaders): Promise<Answer> {
  const t0 = performance.now();
  const parsed = parseQuestion(question);
  const p = plan(parsed);
  const sections: Section[] = [];
  const topic = [parsed.certNum, ...parsed.models, ...parsed.keywords].filter(Boolean).join(' ');

  const tasks: Promise<void>[] = [];
  const order: Section[][] = [[], [], [], []];
  if (p.kc) {
    tasks.push(
      loaders.kc().then((d) => {
        const r = searchKc(d, topic, { limit: 6, summaryLimit: 5 });
        order[0].push({ kind: 'kc', title: '② KC 인증', lead: kcLead(r, parsed.keywords.join(' ') || topic), result: r, query: topic });
      }),
    );
  }
  if (p.recall) {
    tasks.push(
      loaders.recall().then((d) => {
        const r = searchRecall(d, topic, { limit: 6 });
        order[1].push({ kind: 'recall', title: '② 리콜', lead: recallLead(r, parsed.keywords.join(' ') || topic), result: r, query: topic });
      }),
    );
  }
  if (p.ks) {
    const q = parsed.ksCode ?? parsed.keywords.join(' ');
    tasks.push(
      loaders.ks().then((d) => {
        const r = searchKs(d, q, { limit: 6 });
        order[2].push({ kind: 'ks', title: '③ KS 표준', lead: ksLead(r, q), result: r, query: q });
      }),
    );
  }
  await Promise.all(tasks);

  const has = (i: string) => parsed.intents.includes(i as never);
  if (has('import') || has('sell')) {
    sections.push({
      kind: 'steps',
      title: has('import') ? '수입·판매 전에 확인할 것' : '판매·유통 전에 확인할 것',
      lead: '아래 공식 데이터와 함께 다음 순서로 확인하세요. (일반 안내이며, 제품별 최종 판단은 인증기관·제품안전정보센터에 문의)',
      steps: [
        { text: 'KC 안전관리대상 품목인지, 인증 구분(안전인증·안전확인·공급자적합성확인)이 무엇인지 확인', href: 'https://www.safetykorea.kr/policy/targetsSafetyCert' },
        { text: '해당 구분에 맞게 지정 인증기관에 시험·인증 신청 (같은 품목의 기존 인증 구분은 아래 KC 결과 참고)' },
        { text: '같은 품목·모델의 국내외 리콜 이력 확인 (아래 리콜 결과)' },
        { text: '관련 KS 표준 확인 — 시험방법·안전 요구사항 (아래 KS 결과)' },
        { text: '궁금한 점: 제품안전 민원 콜센터 1670-4920 · 인증표준정보센터 1381' },
      ],
    });
  }
  sections.push(...order[0], ...order[1], ...order[2]);
  if (p.exportGuide) {
    sections.push({
      kind: 'export',
      title: '수출·해외규제',
      lead: '수출 준비 도우미(⑤, 국가·품목별 TBT 통보문)는 2단계 기능입니다. 지금은 KnowTBT 에서 대상국 기술규제를 확인하고, 구판·신판 규정 파일을 ④ 해외규제 변경체크에 넣어 바뀐 조항·수치·시행일을 대조할 수 있습니다.',
    });
  }
  if (p.diff && !p.exportGuide) {
    sections.push({ kind: 'diff', title: '④ 해외규제 변경체크', lead: '구판·신판 규정 파일(TXT·PDF·DOCX·HWPX)을 조항 단위로 대조해 바뀐 조항·수치·기한과 원문 근거를 보여 줍니다. 파일은 PC 밖으로 나가지 않습니다.' });
  }
  if (p.contact) sections.push({ kind: 'contact', title: '상담 창구', lead: '전화로 묻고 싶을 때' });

  if (!sections.length) {
    sections.push({
      kind: 'empty',
      title: '질문을 조금 더 구체적으로',
      lead: '질문에서 제품명·모델명·인증번호·표준번호를 찾지 못했어요. 예) "전기난로 수입하려면?", "보조배터리 리콜", "KS C IEC 60335-2-30", "XU070339-19001B 인증 상태"',
    });
  }

  const kw = parsed.keywords.join(' ') || parsed.ksCode || parsed.certNum || parsed.models.join(' ');
  const labels = parsed.intents.filter((i) => i !== 'contact').map((i) => INTENT_LABEL[i]);
  const headline = !parsed.hasTopic
    ? parsed.intents.length
      ? `${labels.join('·') || '문의'}에 대해 안내할게요.`
      : '무엇을 찾을지 알려 주세요.'
    : `'${kw}'${labels.length ? ` ${labels.join('·')}` : ''} — 공식 데이터에서 찾은 결과예요.`;
  return { parsed, headline, sections, ms: Math.round(performance.now() - t0) };
}
