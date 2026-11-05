/**
 * check-size.ts — 빌드 결과(dist/) 총용량이 공공 GitLab Pages 기본 한도(100MB)를 넘으면 빌드를 실패시킨다.
 * 이관할 때 용량 때문에 다시 짜는 일이 없도록 처음부터 100MB 안에 맞춘다. (GitHub Pages 한도는 1GB)
 *
 *   MAX_SITE_MB=100 (기본) · SITE_DIR=dist (기본)
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, process.env.SITE_DIR ?? 'dist');
const LIMIT_MB = Number(process.env.MAX_SITE_MB ?? 100);

function walk(dir: string): { path: string; size: number }[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    const st = statSync(p);
    return st.isDirectory() ? walk(p) : [{ path: relative(DIR, p), size: st.size }];
  });
}

if (!existsSync(DIR)) {
  console.error(`[check-size] ${DIR} 가 없습니다. 먼저 빌드하세요.`);
  process.exit(1);
}
const files = walk(DIR);
const total = files.reduce((n, f) => n + f.size, 0);
const mb = (n: number) => (n / 1048576).toFixed(1) + 'MB';
const groups = new Map<string, number>();
for (const f of files) {
  const top = f.path.split(/[\\/]/).slice(0, f.path.startsWith('data') ? 2 : 1).join('/');
  groups.set(top, (groups.get(top) ?? 0) + f.size);
}
console.log(`[check-size] ${files.length}개 파일, 총 ${mb(total)} / 한도 ${LIMIT_MB}MB`);
for (const [g, n] of [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) console.log(`  ${g.padEnd(28)} ${mb(n)}`);
for (const f of files.sort((a, b) => b.size - a.size).slice(0, 5)) console.log(`  · ${f.path} ${mb(f.size)}`);
if (total > LIMIT_MB * 1048576) {
  console.error(`[check-size] 실패: 총용량 ${mb(total)} 이(가) 한도 ${LIMIT_MB}MB 를 넘었습니다. KC_MAX_RECORDS 를 줄이거나 Pyodide 패키지를 점검하세요.`);
  process.exit(1);
}
