import type { Instr, Rung } from './types'

// 형식은 GX Works2(Q03UDV)에서 내보낸 샘플 CSV로 확인: tests/fixtures/MAIN.csv, COMMENT.csv

export interface ExportOptions {
  projectName: string
  plcInfo: string
}

export const defaultExportOptions: ExportOptions = {
  projectName: '(프로젝트 미설정)',
  plcInfo: 'QCPU (Q mode) Q03UDV'
}

/** 명령이 차지하는 스텝 수 (샘플에서 확인한 명령만) */
export function stepCount(instr: Instr): number {
  const { op, args } = instr
  // 샘플로 확인한 것은 RST C뿐이다. SET C, SET/RST T는 스텝 수를 추측하지 않고 내보내기를 막는다
  if (op === 'RST' && /^C\d/.test(args[0] ?? '')) return 4
  if ((op === 'SET' || op === 'RST') && /^[TC]\d/.test(args[0] ?? ''))
    throw new Error(`GX Works2 샘플로 확인하지 않은 명령: ${op} ${args[0]}`)
  if (op === 'OUT' && /^[TC]\d/.test(args[0] ?? '')) return 4
  if (op === 'FMOV' || op === 'BMOV') return 4
  if (op === 'BKRST' || op === 'MOVP' || op === 'DMOV') return 3
  // 덧셈·뺄셈은 첫 값과 대상이 같은 워드이면 5스텝, 아니면 4스텝. 곱셈·나눗셈은 같아도 4스텝 (샘플 2종으로 확인)
  if (op === '+P' || op === '-P') return args[0] === args[2] ? 5 : 4
  if (op === '*P' || op === '/P') return 4
  if (op === 'MOV' || op === 'PLS' || op === 'LDP') return 2
  if (/^(LD|AND|OR)[=<>]/.test(op)) return 3
  if (oneStep.has(op)) return 1
  throw new Error(`GX Works2 샘플로 확인하지 않은 명령: ${op}`)
}

const oneStep = new Set(['LD', 'LDI', 'AND', 'ANI', 'OR', 'ORI', 'ORB', 'ANB', 'OUT', 'SET', 'RST', 'END'])

function utf16le(text: string): Uint8Array {
  const bytes = new Uint8Array(2 + text.length * 2)
  bytes[0] = 0xff
  bytes[1] = 0xfe
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    bytes[2 + i * 2] = code & 0xff
    bytes[3 + i * 2] = code >> 8
  }
  return bytes
}

const line = (cells: string[]): string => cells.map((c) => `"${c}"`).join('\t')

/** 프로그램 CSV: UTF-16 LE + BOM, 탭 구분, CRLF. END는 자동으로 붙인다 */
export function exportProgram(rungs: Rung[], options = defaultExportOptions): Uint8Array {
  const lines = [
    line([options.projectName]),
    line(['PLC 정보:', options.plcInfo]),
    line(['스텝 번호', '행 간 스테이트먼트', '명령', 'I/O(디바이스)', '공백란', 'PI 스테이트먼트', '노트'])
  ]
  let step = 0
  const write = (instr: Instr): void => {
    lines.push(line([String(step), '', instr.op, instr.args[0] ?? '', '', '', '']))
    for (const arg of instr.args.slice(1)) lines.push(line(['', '', '', arg, '', '', '']))
    step += stepCount(instr)
  }
  for (const rung of rungs) {
    const statement = rung.statement ?? noteStatement(rung.note)
    if (statement) {
      lines.push(line([String(step), statement, '', '', '', '', '']))
      step += statementSteps(statement)
    }
    rung.instrs.forEach(write)
  }
  write({ op: 'END', args: [] })
  return utf16le(lines.map((l) => l + '\r\n').join(''))
}

/**
 * 렁 설명 → 행 간 스테이트먼트. 앞에 *를 붙인 주변 방식이라 PLC에 저장되지 않고 1스텝만 차지한다.
 * 가정: 길이 제한 64칸(한글 2칸)에서 자른다. 화살표는 샘플에 없는 글자라 ->로 바꾼다
 */
function noteStatement(note: string): string {
  return note ? fit(`*${note.replaceAll('→', '->')}`, 64).text : ''
}

/** 스테이트먼트가 차지하는 스텝 수 (샘플로 확인): 주변 방식(*로 시작) 1, 통합 방식 2 + 글자 칸 수의 절반(올림) */
function statementSteps(statement: string): number {
  if (statement.startsWith('*')) return 1
  const width = [...statement].reduce((sum, ch) => sum + cellWidth(ch), 0)
  return 2 + Math.ceil(width / 2)
}

/** 코멘트 CSV: UTF-16 LE + BOM, 탭 구분, LF (프로그램 CSV와 줄바꿈이 다름) */
export function exportComments(
  entries: { device: string; comment: string }[],
  projectName = defaultExportOptions.projectName
): Uint8Array {
  const lines = [line([projectName]), line(['디바이스명', '코멘트']), ...entries.map((e) => line([e.device, e.comment]))]
  return utf16le(lines.map((l) => l + '\n').join(''))
}

const cellWidth = (ch: string): number => (ch.charCodeAt(0) > 0x7f ? 2 : 1)

function fit(text: string, cells: number): { text: string; width: number; cut: boolean } {
  let out = ''
  let width = 0
  for (const ch of text) {
    if (width + cellWidth(ch) > cells) return { text: out, width, cut: true }
    out += ch
    width += cellWidth(ch)
  }
  return { text: out, width, cut: false }
}

/**
 * 디바이스 코멘트 최대 3행×8칸(한글 2칸, 영문·숫자·공백 1칸).
 * 코멘트는 한 문자열이므로 마지막 행을 뺀 각 행을 공백으로 8칸까지 채워 잇는다.
 */
export function formatComment(...lines: string[]): { comment: string; truncated: boolean } {
  const filled = lines.filter((l) => l)
  const rows = filled.slice(0, 3).map((l) => fit(l, 8))
  const comment = rows.map((r, i) => (i < rows.length - 1 ? r.text + ' '.repeat(8 - r.width) : r.text)).join('')
  return { comment, truncated: filled.length > 3 || rows.some((r) => r.cut) }
}
