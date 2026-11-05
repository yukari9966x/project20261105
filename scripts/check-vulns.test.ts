/** 보안 검사기가 읽는 engine/requirements.txt 가 사이트에 실제로 넣는 패키지 버전과 같은지 확인한다. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { collectDeps, parseNpmLock, parseRequirements } from './check-vulns';
import { PURE_WHEELS, canon } from './lib/pyodide-packages';

const ROOT = join(__dirname, '..');
const req = parseRequirements(readFileSync(join(ROOT, 'engine', 'requirements.txt'), 'utf8'));
const pin = (name: string) => req.find((r) => r.name === canon(name))?.version;

describe('의존성 목록', () => {
  it('requirements.txt 읽기', () => {
    expect(parseRequirements('# c\npypdf==6.21.4\nlxml == 6.1.3  # x\nfoo>=1\nBar_Baz[extra]==2.0; python_version>"3"\n')).toEqual([
      { name: 'pypdf', version: '6.21.4' },
      { name: 'lxml', version: '6.1.3' },
      { name: 'bar-baz', version: '2.0' },
    ]);
  });
  it('package-lock 읽기', () => {
    expect(parseNpmLock({ packages: { '': { version: '1.0.0' }, 'node_modules/a': { version: '1.2.3' }, 'node_modules/@s/b': { version: '0.1.0' }, 'node_modules/c': { link: true } } })).toEqual([
      { name: 'a', version: '1.2.3' },
      { name: '@s/b', version: '0.1.0' },
    ]);
  });
  it('사이트에 넣는 순수 휠과 requirements.txt 버전이 같다', () => {
    for (const w of PURE_WHEELS) {
      expect(pin(w.name), w.name).toBe(w.version);
      expect(w.file).toContain(w.version);
    }
  });
  it('Pyodide 내장 lxml·pydantic 버전과 requirements.txt 가 같다', () => {
    const lock = JSON.parse(readFileSync(join(ROOT, 'node_modules', 'pyodide', 'pyodide-lock.json'), 'utf8'));
    expect(pin('lxml')).toBe(lock.packages.lxml.version);
    expect(pin('pydantic')).toBe(lock.packages.pydantic.version);
  });
  it('pypdf 는 알려진 취약점 32건이 해결된 6.21.4 이상', () => {
    const [maj, min, pat] = pin('pypdf')!.split('.').map(Number);
    expect(maj * 10000 + min * 100 + pat).toBeGreaterThanOrEqual(62104);
  });
  it('검사 대상에 Python·npm 이 모두 들어간다', () => {
    const deps = collectDeps(ROOT);
    expect(deps.some((d) => d.ecosystem === 'PyPI' && d.name === 'pypdf')).toBe(true);
    expect(deps.some((d) => d.ecosystem === 'npm' && d.name === 'react')).toBe(true);
  });
});
