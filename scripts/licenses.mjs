// cli.mjs에 묶여 들어가는 라이브러리의 라이선스 문구를 스킬 폴더에 모아 쓴다 (build:cli가 실행).
// 묶인 파일을 배포하려면 각 라이브러리의 저작권·허가 문구를 함께 실어야 한다.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'

const roots = ['zod', 'read-excel-file']
const seen = new Map()
const visit = (name) => {
  const dir = `node_modules/${name}`
  if (seen.has(name) || !existsSync(dir)) return
  const pkg = JSON.parse(readFileSync(`${dir}/package.json`, 'utf8'))
  const file = readdirSync(dir).find((f) => /^(licen[sc]e|copying)/i.test(f))
  seen.set(name, { version: pkg.version, license: pkg.license, text: file ? readFileSync(`${dir}/${file}`, 'utf8').trim() : '' })
  Object.keys(pkg.dependencies ?? {}).forEach(visit)
}
roots.forEach(visit)

const missing = [...seen].filter(([, p]) => !p.text).map(([name]) => name)
if (missing.length > 0) throw new Error(`라이선스 파일이 없는 패키지: ${missing.join(', ')}`)

const body = [...seen]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, p]) => `${'='.repeat(70)}\n${name} ${p.version} (${p.license})\n${'='.repeat(70)}\n\n${p.text}\n`)
  .join('\n')
writeFileSync(
  'skills/autoladder/THIRD_PARTY_LICENSES.txt',
  `cli.mjs에는 아래 라이브러리가 묶여 있습니다. 각 라이브러리의 라이선스 전문입니다.\n\n${body}`
)
console.log(`THIRD_PARTY_LICENSES.txt: ${[...seen.keys()].sort().join(', ')}`)
