import { readFile } from 'node:fs/promises'
import { readSheet } from 'read-excel-file/node'
import { parseDelimited } from '../core/tags'

/** 글자 파일 디코딩: UTF-16 LE(BOM) → UTF-8 → 안 맞으면 한글 Excel이 저장하는 CP949 */
function decode(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return new TextDecoder('euc-kr').decode(bytes)
  }
}

/** 할당표 파일(.xlsx 첫 시트, 그 밖에는 CSV·탭 구분 글) → 행 배열. 빈칸은 빈 문자열 */
export async function readTableFile(path: string): Promise<string[][]> {
  if (/\.xlsx$/i.test(path)) {
    const rows = await readSheet(path)
    return rows.map((row) => row.map((value) => (value === null || value === undefined ? '' : String(value))))
  }
  return parseDelimited(decode(await readFile(path)))
}
