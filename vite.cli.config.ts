import { defineConfig } from 'vite'

// 명령줄 도구 빌드: npm run build:cli → skills/autoladder/cli.mjs
// 라이브러리(zod, read-excel-file)까지 한 파일로 묶는다. 스킬 폴더만 복사하면 Node가 있는 다른 PC에서도 돌아가게 하려는 것
export default defineConfig({
  ssr: { noExternal: true },
  build: {
    ssr: 'src/cli/cli.ts',
    outDir: 'skills/autoladder',
    emptyOutDir: false,
    target: 'node22',
    rollupOptions: { output: { entryFileNames: 'cli.mjs', inlineDynamicImports: true } }
  }
})
