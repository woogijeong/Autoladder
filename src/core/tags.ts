import type { CheckCode, Issue, Tag } from './types'

export type Column = 'address' | 'name' | 'meaning' | 'contact' | 'direction'
/** 열 종류 → 표의 열 번호(0부터) */
export type ColumnMap = Partial<Record<Column, number>>

/** 열 제목으로 쓰이는 말. 앞에 있는 것이 우선 (PlcTwin의 device_comments.xlsx는 디바이스 / 1행 / 2행 / 방향) */
const headerWords: Record<Column, RegExp[]> = {
  address: [/주소|address/i, /디바이스|device/i],
  name: [/이름|명칭|name/i, /1행/],
  meaning: [/의미|설명|meaning/i, /2행/],
  contact: [/접점|contact/i],
  direction: [/방향|입출력|direction/i]
}

/** 붙여넣은 표나 CSV 글 → 행 배열. 탭이 있으면 탭 구분, 없으면 쉼표 구분(큰따옴표 지원) */
export function parseDelimited(text: string): string[][] {
  const delimiter = text.includes('\t') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  const body = text.replace(/^﻿/, '')
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quoted) {
      if (ch === '"' && body[i + 1] === '"') cell += body[++i]
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && body[i + 1] === '\n') i++
      rows.push([...row, cell])
      row = []
      cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length > 0) rows.push([...row, cell])
  return rows
}

/** 첫 행의 열 제목에서 열 종류를 추정한다. 못 찾은 열은 비워 둔다 */
export function guessColumns(header: string[]): ColumnMap {
  const map: ColumnMap = {}
  for (const column of Object.keys(headerWords) as Column[]) {
    for (const word of headerWords[column]) {
      const index = header.findIndex((cell) => word.test(cell))
      if (index >= 0) {
        map[column] = index
        break
      }
    }
  }
  return map
}

const addressFormat = /^([XY][0-9A-F]+|D\d+(\.[0-9A-F])?)$/

/** D 주소의 방향 글자 → 입력·출력. PlcTwin 표의 "앱→PLC" / "PLC→앱"도 읽는다 */
function parseDirection(text: string): Tag['direction'] | undefined {
  if (/입력|input|→\s*PLC/i.test(text)) return 'input'
  if (/출력|output|PLC\s*→/i.test(text)) return 'output'
  return undefined
}

/**
 * 표 → 태그 목록. columns를 주지 않으면 첫 행의 열 제목에서 추정한다.
 * 오류가 하나라도 있으면 다음 단계로 가지 않는다. 행 번호는 표의 1부터 센 행이다.
 */
export function readTags(
  rows: string[][],
  columns?: ColumnMap,
  /** 첫 행이 열 제목인지. 주지 않으면 첫 행에 열 제목 같은 말이 있는지로 판단한다 */
  header?: boolean
): { tags: Tag[]; issues: Issue[]; columns: ColumnMap } {
  const guessed = guessColumns(rows[0] ?? [])
  const hasHeader = header ?? Object.keys(guessed).length > 0
  const map = columns ?? guessed
  const issues: Issue[] = []
  const error = (message: string, row?: number, code: CheckCode = 'tag-field'): void => void issues.push({ level: 'error', code, row, message })

  const missing = [map.address === undefined ? '주소' : '', map.name === undefined ? '이름' : ''].filter((m) => m)
  if (missing.length > 0) {
    error(`${missing.join(', ')} 열을 찾지 못했습니다. 열을 지정해 주세요`)
    return { tags: [], issues, columns: map }
  }

  const cell = (row: string[], column: Column): string => (map[column] === undefined ? '' : (row[map[column]!] ?? '')).trim()
  const tags: Tag[] = []
  const firstRow = new Map<string, number>()
  rows.forEach((row, index) => {
    const rowNo = index + 1
    if ((index === 0 && hasHeader) || row.every((c) => c.trim() === '')) return
    const address = cell(row, 'address').toUpperCase()
    if (!addressFormat.test(address)) return error(`주소 형식 오류: ${cell(row, 'address') || '(빈칸)'}`, rowNo, 'tag-address')
    const first = firstRow.get(address)
    if (first !== undefined) {
      // 처음 나온 행도 한 번은 지목한다
      if (first > 0) error(`주소 중복: ${address}`, first, 'tag-duplicate')
      firstRow.set(address, -1)
      return error(`주소 중복: ${address}`, rowNo, 'tag-duplicate')
    }
    firstRow.set(address, rowNo)

    const name = cell(row, 'name')
    if (!name) return error(`이름이 비어 있습니다: ${address}`, rowNo)
    const contactText = cell(row, 'contact')
    if (contactText && !/^[ab]/i.test(contactText)) return error(`접점은 A 또는 B여야 합니다: ${contactText}`, rowNo)
    const direction = address[0] === 'X' ? 'input' : address[0] === 'Y' ? 'output' : parseDirection(cell(row, 'direction'))
    if (!direction) return error(`${address}의 방향(입력/출력)을 알 수 없습니다. D 주소는 방향 열이 필요합니다`, rowNo)
    tags.push({ address, name, meaning: cell(row, 'meaning'), direction, contact: /^b/i.test(contactText) ? 'B' : 'A' })
  })
  issues.sort((a, b) => (a.row ?? 0) - (b.row ?? 0))
  return { tags, issues, columns: map }
}
