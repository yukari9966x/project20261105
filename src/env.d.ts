/// <reference types="vite/client" />

/** vite.config.ts 의 define 으로 빌드 때 넣는 정보 */
declare const __BUILD_INFO__: { time: string; sha: string; ref: string; basePath: string };
