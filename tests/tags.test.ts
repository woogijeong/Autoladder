import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { generate } from '../src/core/generate'
import { parseDelimited, readTags } from '../src/core/tags'
import { verify } from '../src/core/verify'
import { readTableFile } from '../src/cli/table'
import { mps } from './fixtures/mps'

const pasted = ['주소\t이름\t의미\t접점', 'X0\t시작\t버튼\t', 'x1\t비상정지\t버튼\tB', 'Y20\tA전진\t솔밸브\t'].join('\r\n')
const expected = [
  { address: 'X0', name: '시작', meaning: '버튼', direction: 'input', contact: 'A' },
  { address: 'X1', name: '비상정지', meaning: '버튼', direction: 'input', contact: 'B' },
  { address: 'Y20', name: 'A전진', meaning: '솔밸브', direction: 'output', contact: 'A' }
]

test('붙여넣은 표: 전 행이 태그가 되고 접점 칸이 비면 A접점', () => {
  const { tags, issues } = readTags(parseDelimited(pasted))
  expect(issues).toEqual([])
  expect(tags).toEqual(expected)
})

test('CSV 파일: 쉼표 구분과 큰따옴표, CP949 한글도 읽는다', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'autoladder-'))
  const csv = '주소,이름,의미,접점\nX0,시작,버튼,\nX1,비상정지,버튼,B\nY20,A전진,"솔밸브"\n'
  writeFileSync(join(dir, 'utf8.csv'), csv)
  expect(readTags(await readTableFile(join(dir, 'utf8.csv'))).tags).toEqual(expected)

  // "주소,이름\r\nX0,시작\r\n"을 CP949로 저장한 바이트
  const cp949 = [0xc1, 0xd6, 0xbc, 0xd2, 0x2c, 0xc0, 0xcc, 0xb8, 0xa7, 0x0d, 0x0a, 0x58, 0x30, 0x2c, 0xbd, 0xc3, 0xc0, 0xdb, 0x0d, 0x0a]
  writeFileSync(join(dir, 'cp949.csv'), new Uint8Array(cp949))
  expect(readTags(await readTableFile(join(dir, 'cp949.csv'))).tags).toEqual([
    { address: 'X0', name: '시작', meaning: '', direction: 'input', contact: 'A' }
  ])
})

test('xlsx 파일: PlcTwin의 device_comments.xlsx를 열 제목만으로 읽는다', async () => {
  const rows = await readTableFile('tests/fixtures/device_comments.xlsx')
  const { tags, issues, columns } = readTags(rows)
  expect(issues).toEqual([])
  expect(columns).toEqual({ address: 0, name: 2, meaning: 3, direction: 4 })
  expect(tags).toHaveLength(rows.length - 1) // 제목 행을 뺀 전 행
  expect(tags[0]).toEqual({ address: 'D0.0', name: '공급전진', meaning: '위치', direction: 'input', contact: 'A' })
  expect(tags.find((t) => t.address === 'D144')).toEqual({ address: 'D144', name: '서보', meaning: '목표위치', direction: 'output', contact: 'A' })

  // 이 할당표(+ 시작 버튼 가정 X0)로 MPS 라인을 생성해도 할당표 밖 주소가 없다
  const all = [mps.tags[0], ...tags]
  expect(verify(generate(mps.table, mps.op, all), all, mps.op).filter((n) => n.level === 'error')).toEqual([])
})

test('주소 중복: 중복된 두 행을 모두 지목한다', () => {
  const { issues } = readTags(parseDelimited('주소\t이름\nX0\t시작\nY20\tA전진\nX0\t정지'))
  expect(issues).toEqual([
    { level: 'error', code: 'tag-duplicate', row: 2, message: '주소 중복: X0' },
    { level: 'error', code: 'tag-duplicate', row: 4, message: '주소 중복: X0' }
  ])
})

test('주소 열을 못 찾으면 열 지정을 요청하고, 지정하면 읽는다', () => {
  const rows = parseDelimited('X0\t시작\t버튼\nY20\tA전진\t솔밸브')
  const before = readTags(rows)
  expect(before.tags).toEqual([])
  expect(before.issues).toEqual([{ level: 'error', code: 'tag-field', row: undefined, message: '주소, 이름 열을 찾지 못했습니다. 열을 지정해 주세요' }])

  const after = readTags(rows, { address: 0, name: 1, meaning: 2 })
  expect(after.issues).toEqual([])
  expect(after.tags.map((t) => t.address)).toEqual(['X0', 'Y20'])
})

test('형식 오류 주소, 방향 없는 D 주소, 잘못된 접점은 그 행을 지목한다', () => {
  const { issues } = readTags(parseDelimited('주소\t이름\t접점\nX1G\t센서\t\nD10.0\t밸브\t\nX2\t버튼\tC'))
  expect(issues).toEqual([
    { level: 'error', code: 'tag-address', row: 2, message: '주소 형식 오류: X1G' },
    { level: 'error', code: 'tag-field', row: 3, message: 'D10.0의 방향(입력/출력)을 알 수 없습니다. D 주소는 방향 열이 필요합니다' },
    { level: 'error', code: 'tag-field', row: 4, message: '접점은 A 또는 B여야 합니다: C' }
  ])
})
