import { expect, test } from 'vitest'
import { exportProgram } from '../src/core/export'
import { generate } from '../src/core/generate'
import { validateStepTable } from '../src/core/steptable'
import type { Rung, StepTable } from '../src/core/types'
import { verify } from '../src/core/verify'
import { conveyor, parallel } from './fixtures/processes'
import { Sim } from './sim'

const outputs = (sim: Sim): string => sim.on('Y').join(',')
/** 켜져 있는 단계의 id (단계 릴레이는 M0부터 단계 순서대로) */
const active = (sim: Sim, table: StepTable): string[] => table.steps.filter((_, i) => sim.get(`M${i}`)).map((s) => s.id)
const pulse = (sim: Sim, device: string): void => {
  sim.set(device, true)
  sim.scan()
  sim.set(device, false)
}
const x = (address: string) => ({ kind: 'input' as const, address })

/** 컨베이어: 원위치에서 시작 버튼까지 누른 상태 */
function startConveyor(): Sim {
  const sim = new Sim(generate(conveyor.table, conveyor.op, conveyor.tags).rungs)
  sim.set('X2', true) // 비상정지는 B접점이라 평소 ON
  sim.set('X9', true) // 푸셔 뒷단 = 원위치
  pulse(sim, 'X0')
  return sim
}

/** 두 실린더: 자동 모드, 원위치, 시작 전 */
function idleParallel(): Sim {
  const sim = new Sim(generate(parallel.table, parallel.op, parallel.tags).rungs)
  for (const d of ['X1', 'X9', 'X3', 'X5']) sim.set(d, true) // 자동, 비상정지 정상(B접점), A·B 후진단
  return sim
}

test('컨베이어 분류: 판정에 따라 다른 단계로 가고 양품 3개면 상자 교체', () => {
  expect(validateStepTable(conveyor.table)).toEqual([])
  expect(verify(generate(conveyor.table, conveyor.op, conveyor.tags), conveyor.tags, conveyor.op)).toEqual([])

  const sim = startConveyor()
  const steps = (): string[] => active(sim, conveyor.table)
  const good = (): void => {
    pulse(sim, 'X4')
    expect(steps()).toEqual(['move'])
    pulse(sim, 'X5')
    expect(steps()).toEqual(['pass'])
    expect(outputs(sim)).toBe('Y20')
    pulse(sim, 'X7')
    expect(steps()).toEqual(['wait'])
  }
  expect(steps()).toEqual(['wait'])
  good()

  // 불량: 판정위치와 불량감지가 함께 참이면 위쪽 전이(불량밀기)만 성립
  pulse(sim, 'X4')
  sim.set('X5', true)
  sim.set('X6', true)
  sim.scan()
  sim.set('X5', false)
  sim.set('X6', false)
  expect(steps()).toEqual(['push'])
  expect(outputs(sim)).toBe('Y21')
  sim.set('X9', false)
  pulse(sim, 'X8')
  expect(steps()).toEqual(['back'])
  expect(outputs(sim)).toBe('')
  sim.set('X9', true)
  sim.scan()
  expect(steps()).toEqual(['wait'])
  expect(sim.get('C0')).toBe(false) // 불량은 세지 않는다

  good()
  good()
  expect(sim.get('C0')).toBe(true)
  sim.scan()
  expect(steps()).toEqual(['full'])
  expect(outputs(sim)).toBe('Y22')
  pulse(sim, 'XA')
  expect(steps()).toEqual(['wait'])
  expect(sim.get('C0')).toBe(false)
  sim.scan(3)
  expect(steps()).toEqual(['wait'])
})

test('정지 버튼: 사이클을 끝까지 돌고 대기, 다시 시작하면 첫 단계부터', () => {
  const sim = startConveyor()
  pulse(sim, 'X4')
  pulse(sim, 'X1')
  pulse(sim, 'X5')
  expect(active(sim, conveyor.table)).toEqual(['pass']) // 사이클 도중에는 멈추지 않는다
  expect(outputs(sim)).toBe('Y20')
  pulse(sim, 'X7')
  sim.scan(3)
  expect(sim.on('M')).toEqual([])
  pulse(sim, 'X0')
  expect(active(sim, conveyor.table)).toEqual(['wait'])
})

test('비상정지(B접점): 입력이 꺼지면 출력·단계 해제, 풀어도 다시 시작하지 않는다', () => {
  const sim = startConveyor()
  pulse(sim, 'X4')
  expect(outputs(sim)).toBe('Y20')
  sim.set('X2', false)
  sim.scan()
  expect(outputs(sim)).toBe('')
  expect(active(sim, conveyor.table)).toEqual([])
  sim.set('X2', true)
  sim.scan(3)
  expect(outputs(sim)).toBe('')
  expect(active(sim, conveyor.table)).toEqual([])
  pulse(sim, 'X0')
  expect(active(sim, conveyor.table)).toEqual(['wait'])
})

test('제한 시간 초과: 이상 정지 + 램프 + 이상 번호 = 단계 순번, 뒤에 난 이상은 덮어쓰지 않고 리셋으로 해제', () => {
  const sim = startConveyor()
  pulse(sim, 'X4')
  sim.scan(60) // 이송 제한 시간 5초 = 50스캔
  expect(active(sim, conveyor.table)).toEqual([])
  expect(outputs(sim)).toBe('Y23')
  expect(sim.word('D0')).toBe(2) // 이송은 두 번째 단계

  sim.set('X8', true) // 푸셔 앞단·뒷단 동시 감지
  sim.scan()
  sim.set('X8', false)
  expect(sim.word('D0')).toBe(2)

  pulse(sim, 'X3')
  expect(sim.word('D0')).toBe(0)
  expect(outputs(sim)).toBe('')
  expect(active(sim, conveyor.table)).toEqual([])
  pulse(sim, 'X0')
  expect(active(sim, conveyor.table)).toEqual(['wait'])
})

test('센서 쌍 동시 감지: 이상 번호 = 100 + 쌍 순번, 원인이 남아 있으면 리셋해도 다시 이상', () => {
  const sim = new Sim(generate(conveyor.table, conveyor.op, conveyor.tags).rungs)
  for (const d of ['X2', 'X8', 'X9']) sim.set(d, true)
  sim.scan()
  expect(sim.word('D0')).toBe(101)
  expect(outputs(sim)).toBe('Y23')
  pulse(sim, 'X3')
  expect(sim.word('D0')).toBe(101)
  sim.set('X8', false)
  pulse(sim, 'X3')
  expect(sim.word('D0')).toBe(0)
  expect(outputs(sim)).toBe('')
})

test('원위치가 아니면 시작 버튼을 눌러도 시작하지 않는다', () => {
  const sim = new Sim(generate(conveyor.table, conveyor.op, conveyor.tags).rungs)
  sim.set('X2', true)
  pulse(sim, 'X0')
  expect(sim.on('M')).toEqual([])
})

test('두 실린더 동시 동작: 두 흐름이 모두 끝난 뒤에만 다음 단계', () => {
  expect(validateStepTable(parallel.table)).toEqual([])
  expect(verify(generate(parallel.table, parallel.op, parallel.tags), parallel.tags, parallel.op)).toEqual([])

  const sim = idleParallel()
  pulse(sim, 'X0')
  expect(active(sim, parallel.table)).toEqual(['ready'])
  sim.scan(12) // 준비 1초 = 10스캔
  expect(active(sim, parallel.table)).toEqual(['a_fwd', 'b_fwd'])
  expect(outputs(sim)).toBe('Y20,Y22')

  sim.set('X3', false)
  sim.set('X5', false)
  sim.set('X4', true) // A만 도착
  sim.scan(3)
  expect(active(sim, parallel.table)).toEqual(['a_fwd', 'b_fwd'])
  sim.set('X6', true)
  sim.scan()
  expect(active(sim, parallel.table)).toEqual(['back'])
  expect(outputs(sim)).toBe('Y21,Y23')

  sim.set('X4', false)
  sim.set('X6', false)
  sim.set('X3', true)
  sim.set('X5', true)
  sim.scan(2)
  expect(sim.on('M')).toEqual([])
  expect(outputs(sim)).toBe('')
})

test('수동: 버튼을 누르는 동안만 출력, 인터록 쌍은 동시에 켜지지 않는다', () => {
  const sim = idleParallel()
  sim.set('X1', false)
  sim.set('X7', true)
  sim.scan()
  expect(outputs(sim)).toBe('Y20')
  sim.set('X7', false)
  sim.scan()
  expect(outputs(sim)).toBe('')

  sim.set('X7', true)
  sim.set('X8', true)
  sim.scan(3)
  expect(outputs(sim)).toBe('Y20') // 먼저 켜진 쪽만 남는다
})

test('자동 운전 중 수동 전환: 모든 단계 해제, 수동 버튼으로만 출력', () => {
  const sim = idleParallel()
  pulse(sim, 'X0')
  sim.scan(12)
  expect(outputs(sim)).toBe('Y20,Y22')
  sim.set('X1', false)
  sim.scan()
  expect(active(sim, parallel.table)).toEqual([])
  expect(outputs(sim)).toBe('')
  sim.set('X8', true)
  sim.scan()
  expect(outputs(sim)).toBe('Y21')
})

test('원점복귀: 원위치가 될 때까지 복귀 출력, 자동 운전 중에는 무시', () => {
  const sim = idleParallel()
  sim.set('X3', false)
  sim.set('X5', false)
  pulse(sim, 'X2')
  sim.scan(3)
  expect(outputs(sim)).toBe('Y21,Y23')
  sim.set('X3', true) // A만 원위치
  sim.scan()
  expect(outputs(sim)).toBe('Y21,Y23')
  sim.set('X5', true)
  sim.scan()
  expect(outputs(sim)).toBe('')

  pulse(sim, 'X0')
  sim.scan(12)
  sim.set('X3', false)
  sim.set('X5', false)
  pulse(sim, 'X2')
  sim.scan(3)
  expect(active(sim, parallel.table)).toEqual(['a_fwd', 'b_fwd'])
  expect(outputs(sim)).toBe('Y20,Y22')
})

test('검증: 인터록 쌍에 상대 접점이 없으면 오류', () => {
  const i = (op: string, ...args: string[]) => ({ op, args })
  const rungs: Rung[] = [
    { note: '', instrs: [i('LD', 'X7'), i('OUT', 'Y20')] },
    { note: '', instrs: [i('LD', 'X8'), i('ANI', 'Y20'), i('OUT', 'Y21')] }
  ]
  const errors = verify({ rungs, comments: [] }, parallel.tags, { start: 'X0', interlocks: [['Y20', 'Y21']] }).filter((n) => n.level === 'error')
  expect(errors).toEqual([{ level: 'error', code: 'interlock', rung: 0, message: '인터록 누락: Y20 렁에 Y21의 B접점이 없습니다' }])
})

test('단계 표 구조 검사: 갈 수 없는 단계와 합류 없는 병렬 분기를 잡는다', () => {
  const step = (id: string) => ({ id, name: id, outputs: [], timer: null })
  const noJoin = validateStepTable({
    initial: 's',
    steps: ['s', 'a', 'b', 'lost'].map(step),
    transitions: [
      { from: ['s'], to: ['a', 'b'], cond: x('X1') },
      { from: ['a'], to: [], cond: x('X2') },
      { from: ['b'], to: [], cond: x('X3') }
    ]
  })
  expect(noJoin.map((n) => n.message)).toEqual(['어떤 단계 이동으로도 갈 수 없는 단계: lost', '단계 이동 1: 병렬 분기 뒤에 합류가 없습니다'])

  const meet = validateStepTable({
    initial: 's',
    steps: ['s', 'a', 'b', 'c'].map(step),
    transitions: [
      { from: ['s'], to: ['a', 'b'], cond: x('X1') },
      { from: ['a'], to: ['c'], cond: x('X2') },
      { from: ['b'], to: ['c'], cond: x('X3') }
    ]
  })
  expect(meet.map((n) => n.message)).toContain('단계 이동 3: 이미 진행 중인 단계 c를 다시 켭니다 (병렬 흐름이 합류 없이 만남)')
})

/** 계산·비교 확인용 공정: 작업할 때마다 D10을 1 올리고, 3이 되면 끝 단계에서 곱셈·나눗셈 후 0으로 */
const counting: StepTable = {
  initial: 'work',
  data: [
    { address: 'D10', name: '개수' },
    { address: 'D11', name: '두배' },
    { address: 'D13', name: '몫' }
  ],
  steps: [
    { id: 'work', name: '작업', outputs: [], timer: null, calcs: [{ target: 'D10', left: 'D10', op: '+', right: 1 }] },
    { id: 'rest', name: '쉬기', outputs: [], timer: null },
    {
      id: 'done',
      name: '끝',
      outputs: [],
      timer: null,
      calcs: [
        { target: 'D11', left: 'D10', op: '*', right: 2 },
        { target: 'D13', left: 'D11', op: '/', right: 4 },
        { target: 'D10', left: 0 }
      ]
    }
  ],
  transitions: [
    { from: ['work'], to: ['done'], cond: { kind: 'compare', left: 'D10', op: '>=', right: 3 } },
    { from: ['work'], to: ['rest'], cond: x('X1') },
    { from: ['rest'], to: ['work'], cond: { kind: 'not', cond: { kind: 'compare', left: 'D10', op: '>', right: 100 } } },
    { from: ['done'], to: [], cond: x('X2') }
  ]
}

test('계산과 비교: 단계에 들어올 때 한 번만 계산하고, 비교 조건으로 분기한다', () => {
  expect(validateStepTable(counting)).toEqual([])
  const { rungs } = generate(counting, { start: 'X0' })
  // NOT(D10 > 100)은 반대 연산자로 바뀐다
  expect(rungs[3].instrs.map((n) => [n.op, ...n.args].join(' '))).toEqual(['LD M1', 'AND<= D10 K100', 'OUT M5'])

  const sim = new Sim(rungs)
  pulse(sim, 'X0')
  expect(sim.word('D10')).toBe(1)
  sim.scan(3) // 작업에 머무는 동안 다시 더하지 않는다
  expect(sim.word('D10')).toBe(1)

  sim.set('X1', true)
  sim.scan(4) // 쉬기 → 작업(2) → 쉬기 → 작업(3)
  expect(sim.word('D10')).toBe(3)
  sim.scan()
  expect(active(sim, counting)).toEqual(['done'])
  expect(sim.word('D11')).toBe(6) // 3 × 2
  expect(sim.word('D13')).toBe(1) // 6 ÷ 4
  expect(sim.word('D14')).toBe(2) // 나머지는 다음 워드
  expect(sim.word('D10')).toBe(0)
})

test('계산 검사: 목록에 없는 워드, 0으로 나누기, 덮어쓰이는 다음 워드, 이상 번호 워드를 잡는다', () => {
  const issues = validateStepTable({
    initial: 's',
    data: [
      { address: 'D0', name: '이상번호와 겹침' },
      { address: 'D10', name: '값' },
      { address: 'D11', name: '곱셈 윗자리 자리' }
    ],
    steps: [
      {
        id: 's',
        name: 's',
        outputs: [],
        timer: null,
        calcs: [
          { target: 'D10', left: 'D99', op: '/', right: 0 },
          { target: 'D10', left: 40000 }
        ]
      }
    ],
    transitions: [{ from: ['s'], to: [], cond: { kind: 'compare', left: 'D10', op: '=', right: 'D50' } }]
  })
  expect(issues.map((n) => n.message)).toEqual([
    'D0은 이상 번호에 씁니다. 다른 워드를 쓰거나 설정에서 이상 번호 워드를 바꾸세요',
    '단계 "s"의 계산: 워드 목록에 없는 주소 D99',
    '단계 "s"의 계산: 0으로 나눌 수 없습니다',
    '단계 "s"의 계산: 나머지가 D11에 쓰여 값이 덮어쓰입니다. D11을 비워 두세요',
    '단계 "s"의 계산: 상수는 -32768~32767의 정수여야 합니다 (40000)',
    '단계 이동 1: 워드 목록에 없는 주소 D50'
  ])
})

test('계산이 든 공정도 내보낸다', () => {
  expect(() => exportProgram(generate(counting, { start: 'X0' }).rungs)).not.toThrow()
})

test('샘플로 확인하지 않은 명령(RST T)은 내보내지 않는다', () => {
  const rungs: Rung[] = [{ note: '', instrs: [{ op: 'LD', args: ['X0'] }, { op: 'RST', args: ['T0'] }] }]
  expect(() => exportProgram(rungs)).toThrow('GX Works2 샘플로 확인하지 않은 명령: RST T0')
})
