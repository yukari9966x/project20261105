/**
 * pack-site.ts — 빌드된 사이트(dist/)를 압축 파일 하나(dist/site.tar.gz, 안의 경로는 dist/…)로 묶는다.
 *
 * GitHub Actions 가 GitHub Pages 에 함께 올리면, 공공 GitLab 의 pages 잡은 Node.js 없이
 * curl·tar 만으로(Windows PowerShell·Linux 실행기 공통) 받아서 Pages 에 올릴 수 있다 (.gitlab-ci.yml 의 site:download).
 * GitLab 에 올라가는 사이트에는 이 압축 파일 자체가 들어가지 않는다(자기 자신은 묶지 않음).
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT = join(DIST, 'site.tar.gz');

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('[pack-site] dist/ 가 없습니다. 먼저 npm run build 를 실행하세요.');
  process.exit(1);
}
rmSync(OUT, { force: true });
// 묶는 폴더 안에 바로 쓰면 GNU tar 가 '읽는 중에 바뀜'으로 실패하므로 임시 위치에 만든 뒤 옮긴다.
// GNU tar(리눅스)·bsdtar(Windows·macOS) 모두 같은 옵션.
const tmp = join(mkdtempSync(join(tmpdir(), 'kats-site-')), 'site.tar.gz');
execFileSync('tar', ['-czf', tmp, '-C', ROOT, 'dist'], { stdio: 'inherit' });
copyFileSync(tmp, OUT);
rmSync(dirname(tmp), { recursive: true, force: true });
const list = execFileSync('tar', ['-tzf', OUT], { encoding: 'utf8' }).split('\n').filter((l) => l && !l.endsWith('/'));
if (list.some((l) => l.endsWith('site.tar.gz'))) {
  console.error('[pack-site] 압축 파일이 자기 자신을 포함했습니다.');
  process.exit(1);
}
if (!list.includes('dist/index.html') && !list.includes('./dist/index.html')) {
  console.error('[pack-site] 압축 파일에 dist/index.html 이 없습니다.');
  process.exit(1);
}
console.log(`[pack-site] dist/site.tar.gz — 파일 ${list.length}개, ${(statSync(OUT).size / 1048576).toFixed(1)}MB`);
