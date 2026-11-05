import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 해시 라우팅(#/kc, #/diff …)이라 서버 설정 없이 어느 경로에 올려도 새로고침 404 가 나지 않는다.
// 기본은 상대 경로('./') — 한 번 만든 빌드가 GitHub Pages(/저장소/)·공공 GitLab Pages(하위 경로·고유 도메인 맨 위)
// 어디서나 그대로 동작한다(GitLab 은 GitHub Actions 가 만든 site.tar.gz 를 받아 씀). BASE_PATH 는 특별한 경우에만.
const basePath = process.env.BASE_PATH || './';

export default defineConfig({
  base: basePath,
  plugins: [react()],
  worker: { format: 'es' },
  define: {
    __BUILD_INFO__: JSON.stringify({
      time: new Date().toISOString(),
      sha: process.env.GITHUB_SHA || process.env.CI_COMMIT_SHA || '',
      ref: process.env.GITHUB_REF_NAME || process.env.CI_COMMIT_REF_NAME || '',
      basePath,
    }),
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
  server: { port: 5173 },
});
