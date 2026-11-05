import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 해시 라우팅(#/kc, #/diff …)이라 서버 설정 없이 어느 경로에 올려도 새로고침 404 가 나지 않는다.
// GitHub Pages: BASE_PATH=/<저장소>/ · 공공 GitLab Pages: 인스턴스 Pages 도메인 규칙에 맞춰 BASE_PATH 지정.
// 비워 두면 상대 경로('./')로 빌드되어 어떤 하위 경로에서도 동작한다.
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
