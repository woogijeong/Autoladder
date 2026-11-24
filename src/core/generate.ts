import type { CompareOp, Cond, DeviceComment, DeviceConfig, Instr, OpConfig, Operand, Program, Rung, StepTable, Tag } from './types'
import { defaultDeviceConfig } from './types'

/** 접점 1개. cmp가 있으면 비교 접점(device cmp right) */
type Lit = { device: string; neg: boolean; cmp?: CompareOp; right?: string }
type Group = { kind: 'and' | 'or'; items: Node[] }
type Node = Lit | Group

const isLit = (n: Node): n is Lit => 'device' in n
const lit = (device: string, neg = false): Lit => ({ device, neg })
const ins = (op: string, ...args: string[]): Instr => ({ op, args })
const operand = (value: Operand): string => (typeof value === 'number' ? `K${value}` : value)

const opposite: Record<CompareOp, CompareOp> = { '=': '<>', '<>': '=', '>': '<=', '<=': '>', '<': '>=', '>=': '<' }
const negated = { LD: 'LDI', AND: 'ANI', OR: 'ORI' }

/** 접점 명령. 비교 접점의 부정은 반대 연산자로 바꾼다 */
function contact(base: 'LD' | 'AND' | 'OR', l: Lit): Instr {
  if (l.cmp) return ins(base + (l.neg ? opposite[l.cmp] : l.cmp), l.device, l.right!)
  return ins(l.neg ? negated[base] : base, l.device)
}

/** 같은 종류의 중첩 묶음을 펴고, 항목이 하나뿐인 묶음은 그 항목으로 바꾼다 */
function group(kind: 'and' | 'or', items: Node[]): Node {
  const flat = items.flatMap((n) => (!isLit(n) && n.kind === kind ? n.items : [n]))
  if (flat.length === 0) throw new Error('빈 조건식')
  return flat.length === 1 ? flat[0] : { kind, items: flat }
}

/** 조건 묶음 → LD로 시작하는 명령 블록 */
function compile(node: Node): Instr[] {
  if (isLit(node)) return [contact('LD', node)]
  const [series, join] = node.kind === 'and' ? (['AND', 'ANB'] as const) : (['OR', 'ORB'] as const)
  const out = compile(node.items[0])
  for (const item of node.items.slice(1)) {
    if (isLit(item)) out.push(contact(series, item))
    else out.push(...compile(item), ins(join))
  }
  return out
}

/**
 * 단계 표 + 운전 설정 → 래더 (단계 릴레이 방식).
 * 블록 순서: 운전 상태 → 전이 성립 비트 → 단계 갱신 → 타이머·카운터 → 이상 감지
 * → 모든 단계 해제 → 원점복귀 → 출력.
 * 전이 판정 블록은 단계 릴레이를 바꾸지 않으므로 한 스캔에 한 단계만 진행하고,
 * 출력 코일은 마지막 블록에만 있어 이중 코일이 생기지 않는다.
 */
export function generate(
  table: StepTable,
  op: OpConfig,
  tags: Tag[] = [],
  config: DeviceConfig = defaultDeviceConfig
): Program {
  const { steps, transitions } = table
  const counters = table.counters ?? []
  const { stop, estop, reset, autoManual, homeButton, homeCondition } = op
  const sensorPairs = op.sensorPairs ?? []
  const limited = steps.filter((s) => s.timeLimit !== undefined)
  const timed = steps.filter((s) => s.timer !== null)

  let m = config.mStart
  const nextM = (): string => `M${m++}`
  const stepM = new Map(steps.map((s) => [s.id, nextM()]))
  const trM = transitions.map(() => nextM())
  const runM = nextM()
  const stopM = stop ? nextM() : null
  const faultM = limited.length + sensorPairs.length > 0 ? nextM() : null
  const homingM = homeButton && homeCondition ? nextM() : null
  const stepT = new Map(timed.map((s, i) => [s.id, `T${config.tStart + i}`]))
  const limitT = new Map(limited.map((s, i) => [s.id, `T${config.tStart + timed.length + i}`]))
  const counterC = new Map(counters.map((c, i) => [c.id, `C${config.cStart + i}`]))
  const faultD = `D${config.dStart}`
  const stepName = new Map(steps.map((s) => [s.id, s.name]))
  const ticks = (seconds: number): string => `K${Math.round(seconds * config.timerTicksPerSecond)}`

  const relay = (id: string): string => {
    const device = stepM.get(id)
    if (!device) throw new Error(`없는 단계: ${id}`)
    return device
  }

  // B접점 입력은 눌림/감지일 때 OFF이므로 접점을 뒤집는다
  const bContact = new Set(tags.filter((t) => t.contact === 'B').map((t) => t.address))
  const inp = (address: string, neg = false): Lit => lit(address, neg !== bContact.has(address))

  const toNode = (cond: Cond, neg = false): Node => {
    switch (cond.kind) {
      case 'input':
        return inp(cond.address, neg)
      case 'timer': {
        const t = stepT.get(cond.step)
        if (!t) throw new Error(`타이머가 없는 단계: ${cond.step}`)
        return lit(t, neg)
      }
      case 'counter': {
        const c = counterC.get(cond.id)
        if (!c) throw new Error(`없는 카운터: ${cond.id}`)
        return lit(c, neg)
      }
      case 'compare':
        return { device: cond.left, neg, cmp: cond.op, right: operand(cond.right) }
      case 'not':
        return toNode(cond.cond, !neg)
      default: {
        // 드모르간: NOT(A AND B) = NOT A OR NOT B
        const kind = neg ? (cond.kind === 'and' ? 'or' : 'and') : cond.kind
        return group(
          kind,
          cond.conds.map((c) => toNode(c, neg))
        )
      }
    }
  }

  const names = (ids: string[]): string => ids.map((id) => stepName.get(id) ?? id).join(', ')
  const rungs: Rung[] = []
  const rung = (note: string, cond: Node, ...outs: Instr[]): void =>
    void rungs.push({ note, instrs: [...compile(cond), ...outs] })

  /** 비상정지도 이상도 아닐 때만 참 */
  const safe: Node[] = [...(estop ? [inp(estop, true)] : []), ...(faultM ? [lit(faultM, true)] : [])]

  // 1. 운전 상태
  rung(
    '운전 상태: 진행 중인 단계가 있으면 자동 운전 중',
    group(
      'or',
      steps.map((s) => lit(relay(s.id)))
    ),
    ins('OUT', runM)
  )
  if (stop && stopM)
    rung(
      '정지 예약: 정지 버튼을 누르면 사이클 끝까지 기억',
      group('and', [group('or', [inp(stop), lit(stopM)]), lit(runM)]),
      ins('OUT', stopM)
    )

  // 2. 전이 성립 비트
  transitions.forEach((tr, i) => {
    // 같은 출발 단계를 가진 앞선 전이가 성립하면 이 전이는 막는다 (표의 위쪽이 우선)
    const earlier = transitions
      .slice(0, i)
      .flatMap((other, j) => (other.from.some((f) => tr.from.includes(f)) ? [lit(trM[j], true)] : []))
    rung(
      `단계 이동 ${i + 1} 조건: ${names(tr.from)} → ${names(tr.to) || '종료'}`,
      group('and', [...tr.from.map((f) => lit(relay(f))), toNode(tr.cond), ...earlier]),
      ins('OUT', trM[i])
    )
  })

  // 3. 단계 갱신
  rung(
    `시작: 대기 상태에서 시작 버튼으로 ${names([table.initial])} 시작`,
    group('and', [
      inp(op.start),
      ...(autoManual ? [inp(autoManual)] : []),
      lit(runM, true),
      ...(homeCondition ? [toNode(homeCondition)] : []),
      ...safe,
      ...(homingM ? [lit(homingM, true)] : [])
    ]),
    ins('SET', relay(table.initial))
  )
  transitions.forEach((tr, i) => {
    const where = `${names(tr.from)} → ${names(tr.to) || '종료'}`
    const sets = tr.to.map((t) => ins('SET', relay(t)))
    const hold = stopM && tr.isCycleEnd && sets.length > 0
    rung(`단계 이동 ${i + 1} 실행: ${where}`, lit(trM[i]), ...tr.from.map((f) => ins('RST', relay(f))), ...(hold ? [] : sets))
    if (hold) rung(`단계 이동 ${i + 1} 실행: 정지 예약이 없을 때만 ${names(tr.to)} 시작`, group('and', [lit(trM[i]), lit(stopM, true)]), ...sets)
  })

  // 4. 타이머·카운터
  for (const s of timed)
    rung(`타이머: ${s.name} ${s.timer}초`, lit(relay(s.id)), ins('OUT', stepT.get(s.id)!, ticks(s.timer!)))
  for (const c of counters) {
    const device = counterC.get(c.id)!
    rung(`횟수 ${c.name}: 단계 이동 ${c.countOn + 1}마다 1번, ${c.target}번이면 완료`, lit(trM[c.countOn]), ins('OUT', device, `K${c.target}`))
    rung(`횟수 ${c.name} 지움: 단계 이동 ${c.resetOn + 1}`, lit(trM[c.resetOn]), ins('RST', device))
  }

  // 4-1. 계산: 펄스 명령(+P, MOVP)이라 단계 릴레이가 켜지는 순간 한 번만 실행된다
  for (const s of steps) {
    const calcs = s.calcs ?? []
    if (calcs.length === 0) continue
    const formula = calcs.map((c) => `${c.target} = ${c.left}${c.op ? ` ${c.op} ${c.right}` : ''}`).join(', ')
    rung(
      `계산: ${s.name}에 들어올 때 ${formula}`,
      lit(relay(s.id)),
      ...calcs.map((c) =>
        c.op ? ins(`${c.op}P`, operand(c.left), operand(c.right!), c.target) : ins('MOVP', operand(c.left), c.target)
      )
    )
  }

  // 5. 이상 감지. 이상 비트가 꺼져 있을 때만 번호를 적으므로 먼저 난 이상의 번호가 남는다
  if (faultM) {
    const raise = (note: string, cond: Node[], code: number): void =>
      rung(note, group('and', [...cond, lit(faultM, true)]), ins('MOV', `K${code}`, faultD), ins('SET', faultM))
    if (reset) rung('이상 해제: 리셋 버튼', inp(reset), ins('RST', faultM), ins('MOV', 'K0', faultD))
    for (const s of limited) {
      const t = limitT.get(s.id)!
      const code = steps.indexOf(s) + 1
      rung(`제한 시간: ${s.name} ${s.timeLimit}초`, lit(relay(s.id)), ins('OUT', t, ticks(s.timeLimit!)))
      raise(`이상 ${code}: ${s.name} 제한 시간 초과`, [lit(t)], code)
    }
    sensorPairs.forEach(([a, b], j) => raise(`이상 ${101 + j}: ${a}, ${b} 동시 감지`, [inp(a), inp(b)], 101 + j))
  }

  // 6. 비상정지·이상·수동 전환 → 모든 단계 해제 (다시 시작하면 처음부터)
  const clear = [
    ...(estop ? [inp(estop)] : []),
    ...(faultM ? [lit(faultM)] : []),
    ...(autoManual ? [inp(autoManual, true)] : [])
  ]
  if (clear.length > 0)
    rung(
      '비상정지·이상·수동 전환: 모든 단계 해제',
      group('or', clear),
      // 단계 릴레이는 mStart부터 연속이라 한 번에 지운다
      ins('BKRST', `M${config.mStart}`, `K${steps.length}`),
      ...counters.map((c) => ins('RST', counterC.get(c.id)!))
    )

  // 7. 원점복귀: 자기 유지 회로라 비상정지·이상이면 바로 풀린다
  if (homeButton && homeCondition && homingM)
    rung(
      '원점복귀: 버튼을 누르면 원위치까지 (자동 운전 중 무시)',
      group('and', [group('or', [inp(homeButton), lit(homingM)]), lit(runM, true), toNode(homeCondition, true), ...safe]),
      ins('OUT', homingM)
    )

  // 7-1. 고정값 쓰기: 상시 값은 상시 ON 접점(SM400)으로, 단계 값은 단계 릴레이로
  const movs = (writes: { address: string; value: number }[]): Instr[] => writes.map((w) => ins('MOV', `K${w.value}`, w.address))
  const text = (writes: { address: string; value: number }[]): string => writes.map((w) => `${w.address} = ${w.value}`).join(', ')
  const alwaysWrites = op.alwaysWrites ?? []
  if (alwaysWrites.length > 0) rung(`상시 값: ${text(alwaysWrites)}`, lit('SM400'), ...movs(alwaysWrites))
  for (const s of steps)
    if (s.writes?.length) rung(`값 쓰기: ${s.name} 동안 ${text(s.writes)}`, lit(relay(s.id)), ...movs(s.writes))

  // 8. 출력: 출력 1개당 렁 1개
  const manual = autoManual ? (op.manual ?? []) : []
  const homeOutputs = homingM ? (op.homeOutputs ?? []) : []
  const alwaysOn = op.alwaysOn ?? []
  const outputs = [...steps.flatMap((s) => s.outputs), ...manual.map((b) => b.output), ...homeOutputs, ...alwaysOn]
  for (const y of new Set(outputs)) {
    const users = steps.filter((s) => s.outputs.includes(y))
    const buttons = manual.filter((b) => b.output === y).map((b) => b.button)
    const home = homeOutputs.includes(y)
    const always = alwaysOn.includes(y)
    const sources: Node[] = [
      ...users.map((s) => lit(relay(s.id))),
      ...buttons.map((b) => group('and', [inp(b), inp(autoManual!, true)])),
      ...(home ? [lit(homingM!)] : []),
      ...(always ? [lit('SM400')] : [])
    ]
    const partners = (op.interlocks ?? []).flatMap(([a, b]) => (a === y ? [b] : b === y ? [a] : []))
    const why = [
      names(users.map((s) => s.id)),
      buttons.length ? `수동 ${buttons.join(', ')}` : '',
      home ? '원점복귀' : '',
      always ? '항상 켬' : ''
    ]
    rung(
      `출력 ${y}: ${why.filter((w) => w).join(' / ')}`,
      group('and', [group('or', sources), ...partners.map((p) => lit(p, true)), ...safe]),
      ins('OUT', y)
    )
  }
  if (op.faultLamp && faultM) rung('이상 램프', lit(faultM), ins('OUT', op.faultLamp))

  // 코멘트 한 행은 8칸이라 병렬 단계는 첫 단계 이름에 "등"을 붙인다
  const brief = (ids: string[]): string => names(ids.slice(0, 1)) + (ids.length > 1 ? '등' : '')
  const comments: DeviceComment[] = [
    ...steps.map((s) => ({ device: relay(s.id), lines: [s.name, '하는 중'] })),
    ...transitions.map((tr, i) => ({ device: trM[i], lines: [brief(tr.from), '다음은', brief(tr.to) || '끝'] })),
    { device: runM, lines: ['자동', '운전 중'] },
    ...(stopM ? [{ device: stopM, lines: ['정지', '예약'] }] : []),
    ...(faultM ? [{ device: faultM, lines: ['이상', '발생'] }] : []),
    ...(homingM ? [{ device: homingM, lines: ['원점', '복귀 중'] }] : []),
    ...timed.map((s) => ({ device: stepT.get(s.id)!, lines: [s.name, '타이머', `${s.timer}초`] })),
    ...limited.map((s) => ({ device: limitT.get(s.id)!, lines: [s.name, '시간초과', `${s.timeLimit}초`] })),
    ...counters.map((c) => ({ device: counterC.get(c.id)!, lines: [c.name, '횟수', `${c.target}번`] })),
    ...(faultM ? [{ device: faultD, lines: ['이상', '번호'] }] : []),
    ...(table.data ?? []).map((d) => ({ device: d.address, lines: [d.name] }))
  ]

  return { rungs, comments }
}
