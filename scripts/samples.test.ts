/** 변경체크 내장 샘플이 기록(fixture_registry.json)의 해시와 같은지, 줄바꿈이 바뀐 경우를 가려내는지 확인한다. */
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { SAMPLE_PAIRS, checkSamples, looksCrlfConverted, sampleProblemMessage } from './lib/samples';

const ROOT = join(__dirname, '..');
const tmp = mkdtempSync(join(tmpdir(), 'kats-samples-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** 저장소의 샘플·기록을 임시 폴더로 복사 (필요하면 파일을 바꿔치기) */
function copyRepo(name: string, mutate?: (file: string, buf: Buffer) => Buffer): string {
  const root = join(tmp, name);
  mkdirSync(join(root, 'engine', 'kats_diff', 'samples'), { recursive: true });
  cpSync(join(ROOT, 'engine', 'kats_diff', 'samples', 'fixture_registry.json'), join(root, 'engine', 'kats_diff', 'samples', 'fixture_registry.json'));
  for (const s of SAMPLE_PAIRS) {
    mkdirSync(join(root, 'engine', 'samples', s.id), { recursive: true });
    for (const f of [s.old, s.new]) {
      const buf = readFileSync(join(ROOT, 'engine', 'samples', s.id, f));
      writeFileSync(join(root, 'engine', 'samples', s.id, f), mutate ? mutate(f, buf) : buf);
    }
  }
  return root;
}
const toCrlf = (buf: Buffer) => Buffer.from(buf.toString('latin1').replace(/\r?\n/g, '\r\n'), 'latin1');

describe('변경체크 내장 샘플', () => {
  it('저장소의 4쌍이 모두 기록된 해시와 같다 (.gitattributes 가 줄바꿈 변환을 막음)', () => {
    expect(SAMPLE_PAIRS).toHaveLength(4);
    expect(checkSamples(ROOT)).toEqual([]);
    const attrs = readFileSync(join(ROOT, '.gitattributes'), 'utf8');
    expect(attrs).toMatch(/^\* -text$/m);
  });

  it('윈도우 Git 이 줄바꿈을 CRLF 로 바꾼 경우(글자로 된 TXT·PDF)를 가려내고 해결 방법을 안내', () => {
    const root = copyRepo('crlf', (file, buf) => (/\.(txt|pdf)$/.test(file) ? toCrlf(buf) : buf));
    const problems = checkSamples(root);
    expect(problems.map((p) => p.id)).toEqual(['pair1_kr_appliance', 'pair3_en_battery']);
    expect(problems.every((p) => p.crlf)).toBe(true);
    const msg = sampleProblemMessage(problems);
    expect(msg).toContain('core.autocrlf');
    expect(msg).toContain('git reset --hard');
  });

  it('내용이 바뀐 샘플은 줄바꿈 문제와 구분해 알린다', () => {
    const root = copyRepo('edited', (file, buf) => (file === 'old_machinery_2021_v1.docx' ? Buffer.concat([buf, Buffer.from([0])]) : buf));
    const problems = checkSamples(root);
    expect(problems).toEqual([{ id: 'pair4_en_machinery', reason: 'SHA-256 이 기록과 다름', crlf: false }]);
    expect(sampleProblemMessage(problems)).toContain('fixture_registry.json');
  });

  it('CRLF 변환 흔적 판별', () => {
    expect(looksCrlfConverted(Buffer.from('a\r\nb\r\n'))).toBe(true);
    expect(looksCrlfConverted(Buffer.from('a\nb\r\n'))).toBe(false);
    expect(looksCrlfConverted(Buffer.from('no newline'))).toBe(false);
  });
});
