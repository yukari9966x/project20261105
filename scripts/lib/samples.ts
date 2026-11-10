/**
 * samples.ts — 변경체크 내장 샘플(가상 규정 4쌍) 목록과 '저장소 원본 그대로인지' 검사.
 *
 * 엔진은 내장 샘플을 (구판 SHA-256):(신판 SHA-256) 쌍으로 알아본다 (engine/kats_diff/samples/fixture_registry.json).
 * 파일이 한 바이트라도 바뀌면 '내장 샘플과 해시가 다른 문서'로 취급되어 기록된 결과를 쓰지 못한다.
 * 가장 흔한 원인은 윈도우용 Git 이 받을 때 줄바꿈을 CRLF 로 바꾸는 것(core.autocrlf=true, 설치 기본값)이다.
 * .gitattributes 로 변환을 꺼 두었고, 그래도 달라졌으면 빌드(copy-pyodide)가 여기서 멈춰 원인과 해결 방법을 알려 준다.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SamplePair {
  id: string;
  title: string;
  old: string;
  new: string;
  country: string;
  product: string;
}

export const SAMPLE_PAIRS: SamplePair[] = [
  {
    id: 'pair1_kr_appliance',
    title: '가정용 전기기기 안전 가상규정 (TXT, 한국어)',
    old: 'old_appliance_2023_v1.txt',
    new: 'new_appliance_2026_v2.txt',
    country: '대한민국(가상)',
    product: '가정용 전기기기',
  },
  {
    id: 'pair2_kr_lighting_hwpx',
    title: 'LED 조명기기 가상규정 (HWPX, 한국어)',
    old: 'old_lighting_2022_v1.hwpx',
    new: 'new_lighting_2026_v2.hwpx',
    country: '대한민국(가상)',
    product: 'LED 조명기기',
  },
  {
    id: 'pair3_en_battery',
    title: 'Battery safety synthetic regulation (PDF, 영어)',
    old: 'old_battery_2022_revA.pdf',
    new: 'new_battery_2026_revB.pdf',
    country: 'EU(가상)',
    product: '휴대용 배터리',
  },
  {
    id: 'pair4_en_machinery',
    title: 'Machinery safety synthetic regulation (DOCX, 영어)',
    old: 'old_machinery_2021_v1.docx',
    new: 'new_machinery_2026_v2.docx',
    country: '미국(가상)',
    product: '산업용 기계',
  },
];

export interface SampleProblem {
  id: string;
  reason: string;
  /** 줄바꿈이 CRLF 로 바뀐 흔적이 있는지 (윈도우 Git 의 자동 변환) */
  crlf: boolean;
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');

/** 줄바꿈(LF)이 있고 그 앞이 전부 CR 인 파일 — LF 로 저장된 글자 파일이 CRLF 로 변환된 모습 */
export function looksCrlfConverted(b: Buffer): boolean {
  let lf = 0;
  for (let i = 0; i < b.length; i++) {
    if (b[i] !== 0x0a) continue;
    if (i === 0 || b[i - 1] !== 0x0d) return false;
    lf++;
  }
  return lf > 0;
}

/** 내장 샘플 파일이 기록(fixture_registry.json)의 해시와 같은지 확인한다. 문제가 없으면 빈 배열. */
export function checkSamples(root: string, pairs: SamplePair[] = SAMPLE_PAIRS): SampleProblem[] {
  const registry = JSON.parse(readFileSync(join(root, 'engine', 'kats_diff', 'samples', 'fixture_registry.json'), 'utf8')) as {
    pairs: Record<string, { pair_id: string }>;
  };
  const keyOf = new Map(Object.entries(registry.pairs).map(([key, v]) => [v.pair_id, key]));
  const problems: SampleProblem[] = [];
  for (const s of pairs) {
    const paths = [s.old, s.new].map((f) => join(root, 'engine', 'samples', s.id, f));
    const missing = paths.find((p) => !existsSync(p));
    if (missing) {
      problems.push({ id: s.id, reason: `파일 없음 (${missing})`, crlf: false });
      continue;
    }
    const bufs = paths.map((p) => readFileSync(p));
    const expected = keyOf.get(s.id);
    if (!expected) problems.push({ id: s.id, reason: '기록(fixture_registry.json)에 없는 샘플', crlf: false });
    else if (expected !== bufs.map(sha256).join(':')) problems.push({ id: s.id, reason: 'SHA-256 이 기록과 다름', crlf: bufs.some(looksCrlfConverted) });
  }
  return problems;
}

/** 빌드를 멈출 때 보여 줄 안내문 */
export function sampleProblemMessage(problems: SampleProblem[]): string {
  const lines = [`내장 샘플 ${problems.length}쌍이 저장소 원본과 다릅니다 — ${problems.map((p) => `${p.id}: ${p.reason}`).join(' / ')}`];
  if (problems.some((p) => p.crlf)) {
    lines.push(
      '  원인: 윈도우용 Git 이 받을 때 줄바꿈을 CRLF 로 바꿨습니다(core.autocrlf). 이대로 빌드하면 변경체크 샘플이 기록된 결과와 맞지 않습니다.',
      '  해결: 저장소를 최신으로 받은 뒤(.gitattributes 포함) 폴더를 지우고 새로 받거나, 저장소 폴더에서 아래 두 줄을 실행하세요(커밋하지 않은 변경은 사라집니다).',
      '          git rm -r --cached -q .',
      '          git reset --hard',
      '        GitLab 러너라면 러너 폴더의 builds 를 지우고 파이프라인을 다시 실행하세요.',
    );
  } else {
    lines.push('  샘플 문서를 일부러 바꿨다면 engine/kats_diff/samples/fixture_registry.json 의 해시 쌍도 함께 고쳐야 합니다.');
  }
  return lines.join('\n');
}
