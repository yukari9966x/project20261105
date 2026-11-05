/** 공공 GitLab 이 받아 쓰는 site.tar.gz 는 어느 주소(하위 경로·고유 도메인)에서도 열려야 한다 — 절대 경로 빌드를 가려낸다. */
import { describe, expect, it } from 'vitest';
import { absoluteRefs } from './pack-site';

describe('사이트 묶음 경로 검사', () => {
  it('상대 경로 빌드(base ./)는 통과', () => {
    const html =
      '<link rel="icon" href="./favicon.svg" /><link rel="manifest" href="./manifest.webmanifest" />' +
      '<script type="module" crossorigin src="./assets/index-abc.js"></script><link rel="stylesheet" crossorigin href="./assets/index-abc.css">' +
      '<a href="https://www.safetykorea.kr/">출처</a><link href="//example.org/x.css" rel="preconnect">';
    expect(absoluteRefs(html)).toEqual([]);
  });

  it('BASE_PATH=/저장소/ 로 만든 절대 경로 빌드는 거부', () => {
    const html =
      '<script type="module" crossorigin src="/project20261105/assets/index-abc.js"></script>' +
      "<link rel='modulepreload' href='/project20261105/assets/react-abc.js'><link rel=\"icon\" href=\"/favicon.svg\">";
    expect(absoluteRefs(html)).toEqual(['/project20261105/assets/index-abc.js', '/project20261105/assets/react-abc.js', '/favicon.svg']);
  });
});
