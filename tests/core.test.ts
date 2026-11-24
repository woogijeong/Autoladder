import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { exportComments, exportProgram, formatComment } from '../src/core/export'
import { generate } from '../src/core/generate'
import { validateStepTable } from '../src/core/steptable'
import type { Instr, Rung } from '../src/core/types'
import { verify } from '../src/core/verify'
import { mps } from './fixtures/mps'
import { conveyor, cylinder, parallel, trafficLight } from './fixtures/processes'
import { Sim } from './sim'

const fixture = (name: string): Uint8Array => new Uint8Array(readFileSync(`tests/fixtures/${name}`))
const i = (op: string, ...args: string[]): Instr => ({ op, args })

test('프로그램 CSV가 GX Works2 샘플과 바이트 단위로 일치', () => {
  const instrs = [
    i('LD', 'X10'), i('OUT', 'M10'),
    i('LD', 'X11'), i('OR', 'X12'), i('ANI', 'X12'), i('OUT', 'Y40'),
    i('LD', 'X14'), i('MOV', 'K1', 'D20'),
    i('LD', 'M10'), i('OUT', 'T1', 'K10'),
    i('LD', 'T10'), i('AND', 'M20'), i('OUT', 'M30'),
    i('LD', 'M30'), i('OUT', 'C1', 'K5'),
    i('LD', 'C1'), i('OUT', 'M40'),
    i('LD', 'M1'), i('AND', 'M2'), i('ANI', 'M3'), i('LD', 'M4'), i('AND', 'M5'), i('ANI', 'M6'), i('ORB'),
    i('OUT', 'Y10'), i('OUT', 'Y20'),
    i('LD', 'X20'), i('SET', 'M100'),
    i('LD', 'X30'), i('RST', 'M100'),
    i('LD=', 'D1000', 'K10'), i('OR<>', 'D1000', 'K20'), i('PLS', 'M200'),
    i('LD', 'M1'), i('OR', 'M2'), i('LD', 'M3'), i('OR', 'M4'), i('ANB'), i('OUT', 'Y5')
  ]
  expect(exportProgram([{ note: '', instrs }])).toEqual(fixture('MAIN.csv'))
})

test('코멘트 CSV가 GX Works2 샘플과 바이트 단위로 일치', () => {
  const bytes = exportComments([
    { device: 'X3', comment: '테스트 입니다 테스트 입니다' },
    { device: 'X4', comment: '테스트입니다 테스트입니다' }
  ])
  expect(bytes).toEqual(fixture('COMMENT.csv'))
})

test('D 비트 접점·코일과 SM400도 GX Works2 샘플과 바이트 단위로 일치', () => {
  const instrs = [
    i('LD', 'D0.0'), i('ANI', 'D0.1'), i('OUT', 'D100.0'),
    i('LD', 'X1'), i('SET', 'D100.1'),
    i('LD', 'X2'), i('RST', 'D100.1'),
    i('LD', 'SM400'), i('MOV', 'K9003', 'D142')
  ]
  expect(exportProgram([{ note: '', instrs }])).toEqual(fixture('MAIN_dbit.csv'))
})

test('RST C, BKRST, LDP, FMOV도 GX Works2 샘플과 바이트 단위로 일치', () => {
  const instrs = [
    i('LD', 'D0.0'), i('ANI', 'D0.1'), i('OUT', 'D100.0'),
    i('LD', 'X1'), i('SET', 'D100.1'),
    i('LD', 'X2'), i('RST', 'D100.1'),
    i('LD', 'SM400'), i('MOV', 'K9003', 'D142'),
    i('LD', 'X0'), i('RST', 'C0'),
    i('LD', 'X1'), i('OUT', 'Y0'), i('BKRST', 'M100', 'K20'),
    i('LDP', 'X3'), i('FMOV', 'K2', 'D100', 'K5')
  ]
  expect(exportProgram([{ note: '', instrs }])).toEqual(fixture('MAIN_rstc.csv'))
})

test('계산(+P -P *P /P MOVP DMOV BMOV)과 비교 접점도 GX Works2 샘플과 바이트 단위로 일치', () => {
  const instrs = [
    i('LD', 'X0'), i('MOVP', 'K1', 'D0'),
    i('LD', 'X1'), i('DMOV', 'K100000', 'D10'),
    i('LD', 'X2'), i('BMOV', 'D0', 'D20', 'K4'),
    i('LD', 'X3'), i('OUT', 'Y0'),
    i('LD', 'X0'), i('+P', 'D10', 'K1', 'D10'),
    i('LD', 'X1'), i('-P', 'D10', 'D11', 'D12'),
    i('LD', 'X2'), i('*P', 'D10', 'K2', 'D20'),
    i('LD', 'X3'), i('/P', 'D20', 'K3', 'D22'),
    i('LD', 'X4'), i('MOVP', 'K0', 'D10'),
    i('LD', 'X5'), i('MOVP', 'D10', 'D11'),
    i('LD>=', 'D10', 'K5'), i('AND<', 'D11', 'D12'), i('OR<=', 'D10', 'K0'), i('OUT', 'Y0'),
    i('LD>', 'D10', 'K1'), i('AND<>', 'D10', 'K2'), i('OR=', 'D10', 'K3'), i('OUT', 'Y1')
  ]
  expect(exportProgram([{ note: '', instrs }])).toEqual(fixture('MAIN_calc.csv'))
})

test('사칙연산의 값과 대상이 같은 워드인 모양도 GX Works2 샘플과 바이트 단위로 일치', () => {
  const instrs = [
    i('LD', 'X0'), i('+P', 'D10', 'K1', 'D12'),
    i('LD', 'X1'), i('-P', 'D10', 'K1', 'D10'),
    i('LD', 'X2'), i('*P', 'D10', 'K2', 'D10'),
    i('LD', 'X3'), i('/P', 'D10', 'K2', 'D10'),
    i('LD', 'X4'), i('+P', 'K1', 'D10', 'D10'),
    i('LD', 'X5'), i('+P', 'D10', 'D10', 'D12'),
    i('LD', 'X6'), i('OUT', 'Y0')
  ]
  expect(exportProgram([{ note: '', instrs }])).toEqual(fixture('MAIN_calc2.csv'))
})

test('행 간 스테이트먼트(통합·주변 방식)도 GX Works2 샘플과 바이트 단위로 일치', () => {
  const rungs: Rung[] = [
    { note: '', statement: '테스트 설명 1', instrs: [i('LD', 'X0'), i('OUT', 'Y0')] },
    { note: '주변 방식 설명 2', instrs: [i('LD', 'X1'), i('OUT', 'Y1')] }, // note는 앞에 *가 붙는다
    { note: '', statement: '한글과 abc 123을 섞은 조금 긴 설명입니다 -> 화살표도 포함', instrs: [i('LD', 'X2'), i('OUT', 'Y2')] }
  ]
  expect(exportProgram(rungs)).toEqual(fixture('MAIN_statement.csv'))
})

test('코멘트 3행×8칸: 마지막 행을 뺀 행을 8칸까지 채우고 넘치면 잘라낸다', () => {
  expect(formatComment('A전진', '다음은', 'B전진')).toEqual({ comment: 'A전진   다음은  B전진', truncated: false })
  expect(formatComment('가', '나', '다', '라').truncated).toBe(true)
  expect(formatComment('시작', '버튼')).toEqual({ comment: '시작    버튼', truncated: false })
  expect(formatComment('A전진단', '센서')).toEqual({ comment: 'A전진단 센서', truncated: false })
  expect(formatComment('ABCDEFGHI', '')).toEqual({ comment: 'ABCDEFGH', truncated: true })
  // 7칸에서 2칸짜리 글자는 들어가지 않는다
  expect(formatComment('ABCDEFG가', '컨베이어모터')).toEqual({ comment: 'ABCDEFG 컨베이어', truncated: true })
})

const outputs = (sim: Sim): string => sim.on('Y').join(',')

test('실린더 순차 왕복: A+ B+ B- A- 순서로 출력이 바뀐다', () => {
  expect(validateStepTable(cylinder.table)).toEqual([])
  const { rungs } = generate(cylinder.table, cylinder.op)
  expect(verify({ rungs, comments: [] }, cylinder.tags)).toEqual([])

  const sim = new Sim(rungs)
  sim.set('X1', true) // A 후진단
  sim.set('X3', true) // B 후진단
  sim.scan(3)
  expect(outputs(sim)).toBe('') // 시작 버튼 전에는 움직이지 않는다

  sim.set('X0', true)
  sim.scan()
  sim.set('X0', false)
  expect(outputs(sim)).toBe('Y20') // A+

  sim.set('X1', false)
  sim.set('X2', true)
  sim.scan(2)
  expect(outputs(sim)).toBe('Y20,Y21') // B+

  sim.set('X3', false)
  sim.set('X4', true)
  sim.scan(2)
  expect(outputs(sim)).toBe('Y20') // B-

  sim.set('X4', false)
  sim.set('X3', true)
  sim.scan(2)
  expect(outputs(sim)).toBe('') // A-

  sim.set('X2', false)
  sim.set('X1', true)
  sim.scan(2)
  expect(sim.on('M')).toEqual([]) // 종료 후 모든 단계 해제
})

test('전이 조건이 연속으로 이미 참이어도 한 스캔에 한 단계만 진행', () => {
  const { rungs } = generate(cylinder.table, cylinder.op)
  const sim = new Sim(rungs)
  for (const x of ['X0', 'X1', 'X2', 'X3', 'X4']) sim.set(x, true)
  const active = (): string[] => sim.on('M').filter((m) => Number(m.slice(1)) < cylinder.table.steps.length)
  const seen: string[][] = []
  for (let n = 0; n < 5; n++) {
    sim.scan()
    seen.push(active())
  }
  expect(seen).toEqual([['M0'], ['M1'], ['M2'], ['M3'], []])
})

test('신호등: 타이머만으로 3사이클 반복', () => {
  expect(validateStepTable(trafficLight.table)).toEqual([])
  const { rungs } = generate(trafficLight.table, trafficLight.op)
  expect(verify({ rungs, comments: [] }, trafficLight.tags)).toEqual([])

  const sim = new Sim(rungs)
  sim.set('X0', true)
  sim.scan()
  sim.set('X0', false)
  const seq: string[] = []
  for (let n = 0; n < 300 && seq.length < 10; n++) {
    const now = outputs(sim)
    if (now !== seq[seq.length - 1]) seq.push(now)
    sim.scan()
  }
  expect(seq).toEqual(['Y30', 'Y31', 'Y32', 'Y30', 'Y31', 'Y32', 'Y30', 'Y31', 'Y32', 'Y30'])
})

test('선택 분기: 조건이 동시에 참이면 표의 위쪽 전이만 성립', () => {
  const x = (address: string) => ({ kind: 'input' as const, address })
  const { rungs } = generate(
    {
      initial: 's',
      steps: ['s', 'a', 'b'].map((id) => ({ id, name: id, outputs: [], timer: null })),
      transitions: [
        { from: ['s'], to: ['a'], cond: x('X1') },
        { from: ['s'], to: ['b'], cond: x('X2') }
      ]
    },
    { start: 'X0' }
  )
  const sim = new Sim(rungs)
  for (const d of ['X0', 'X1', 'X2']) sim.set(d, true)
  sim.scan(2)
  expect(sim.on('M').filter((m) => Number(m.slice(1)) < 3)).toEqual(['M1'])
})

test('조건식: NOT은 드모르간으로 풀고 묶음은 ANB/ORB로 잇는다', () => {
  const x = (address: string) => ({ kind: 'input' as const, address })
  const { rungs } = generate(
    {
      initial: 's',
      steps: [{ id: 's', name: 's', outputs: [], timer: null }],
      transitions: [
        {
          from: ['s'],
          to: [],
          cond: {
            kind: 'and',
            conds: [
              { kind: 'or', conds: [x('X1'), x('X2')] },
              { kind: 'not', cond: { kind: 'and', conds: [x('X3'), x('X4')] } }
            ]
          }
        }
      ]
    },
    { start: 'X0' }
  )
  // rungs[0]은 운전 상태 렁
  expect(rungs[1].instrs.map((n) => [n.op, ...n.args].join(' '))).toEqual([
    'LD M0', 'LD X1', 'OR X2', 'ANB', 'LDI X3', 'ORI X4', 'ANB', 'OUT M1'
  ])
})

test('같은 단계 표로 두 번 생성하면 파일이 바이트 단위로 같다', () => {
  const run = (): Uint8Array => exportProgram(generate(cylinder.table, cylinder.op).rungs)
  expect(run()).toEqual(run())
})

test('검증: 할당표 밖 주소, 이중 코일, 미사용 출력을 잡는다', () => {
  const rungs: Rung[] = [
    { note: '', instrs: [i('LD', 'X0'), i('OUT', 'Y20')] },
    { note: '', instrs: [i('LD', 'X9'), i('OUT', 'Y20')] }
  ]
  expect(verify({ rungs, comments: [] }, cylinder.tags)).toEqual([
    { level: 'error', code: 'io-known', rung: 1, message: 'I/O 할당표에 없는 주소: X9' },
    { level: 'error', code: 'double-coil', rung: 0, message: '이중 코일: Y20' },
    { level: 'error', code: 'double-coil', rung: 1, message: '이중 코일: Y20' },
    { level: 'warning', code: 'unused-output', message: '래더에서 쓰지 않는 출력: Y21 B전진' }
  ])
})

test('단계 표 구조 검사: 없는 단계와 타이머 없는 단계 참조를 잡는다', () => {
  const issues = validateStepTable({
    initial: 'nope',
    steps: [{ id: 's', name: 's', outputs: [], timer: null }],
    transitions: [{ from: ['s'], to: ['ghost'], cond: { kind: 'timer', step: 's' } }]
  })
  expect(issues.map((n) => n.message)).toEqual([
    '첫 단계가 단계 목록에 없습니다: nope',
    '단계 이동 1: 없는 단계 ghost',
    '단계 이동 1: 타이머가 없는 단계를 조건으로 씁니다 (s)'
  ])
})

// GX Works2 불러오기 확인용 파일. 사용자가 직접 불러와 변환·시뮬레이션한다.
test('기준 공정 CSV를 samples/에 쓴다', () => {
  for (const [name, p] of Object.entries({ cylinder, trafficLight, parallel, conveyor, mps })) {
    const program = generate(p.table, p.op, p.tags)
    const comments = [
      ...p.tags.map((t) => ({ device: t.address, lines: [t.name, t.meaning] })),
      ...program.comments
    ].map((c) => ({ device: c.device, comment: formatComment(...c.lines).comment }))
    mkdirSync(`samples/${name}`, { recursive: true })
    writeFileSync(`samples/${name}/MAIN.csv`, exportProgram(program.rungs))
    writeFileSync(`samples/${name}/COMMENT.csv`, exportComments(comments))
  }
})
