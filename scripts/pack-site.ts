/**
 * pack-site.ts — 빌드된 사이트(dist/)를 압축 파일 하나(dist/site.tar.gz, 안의 경로는 dist/…)로 묶는다.
 *
 * GitHub Actions 가 GitHub Pages 에 함께 올리면, 공공 GitLab 의 pages 잡은 Node.js 없이
 * curl·tar 만으로(Windows PowerShell·Linux 실행기 공통) 받아서 Pages 에 올릴 수 있다 (.gitlab-ci.yml 의 site:download).
 * GitLab 에 올라가는 사이트에는 이 압축 파일 자체가 들어가지 않는다(자기 자신은 묶지 않음).
 *
 * GitLab Pages 주소는 인스턴스 설정에 따라 하위 경로(/<프로젝트>/)이거나 고유 도메인의 맨 위(/)이므로,
 * 어느 주소에서도 열리는 상대 경로('./') 빌드만 묶는다. BASE_PATH 로 절대 경로 빌드를 하면 여기서 멈춘다.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const OUT = join(DIST, 'site.tar.gz');

/** index.html 이 사이트 안 파일을 '/' 로 시작하는 절대 경로로 부르는 곳 (외부 주소 `//…`·`https:` 는 제외). */
export function absoluteRefs(html: string): string[] {
  return [...html.matchAll(/\b(?:src|href)\s*=\s*["'](\/(?!\/)[^"']*)["']/gi)].map((m) => m[1]);
}

function main() {
  if (!existsSync(join(DIST, 'index.html'))) {
    console.error('[pack-site] dist/ 가 없습니다. 먼저 npm run build 를 실행하세요.');
    process.exit(1);
  }
  const abs = absoluteRefs(readFileSync(join(DIST, 'index.html'), 'utf8'));
  if (abs.length) {
    console.error(
      `[pack-site] dist/index.html 이 절대 경로(${abs[0]} 등 ${abs.length}곳)를 씁니다. ` +
        "이대로면 다른 주소(공공 GitLab Pages 등)에서 404 가 납니다. BASE_PATH 없이(상대 경로 './') 다시 빌드하세요.",
    );
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
  console.log(`[pack-site] dist/site.tar.gz — 파일 ${list.length}개, ${(statSync(OUT).size / 1048576).toFixed(1)}MB (상대 경로 빌드)`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
