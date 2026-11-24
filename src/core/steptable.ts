import type { CheckCode, Cond, DeviceConfig, Issue, Operand, StepTable, Transition } from './types'
import { defaultDeviceConfig } from './types'

/**
 * 조건을 무시하고 전이를 따라가며, 동시에 켜질 수 있는 단계 조합을 전부 찾는다.
 * steps = 한 번이라도 켜지는 단계, fired = 성립할 수 있는 전이, remet = 이미 켜진 단계를 다시 켜는 전이
 */
function explore(transitions: Transition[], start: string[]) {
  const steps = new Set<string>()
  const fired = new Set<number>()
  const remet = new Map<number, string>()
  const seen = new Set<string>()
  const queue = [[...new Set(start)].sort()]
  // ponytail: 조합 5000개에서 멈춘다 (그 뒤는 검사 생략). 병렬이 아주 깊은 표가 나오면 올린다
  while (queue.length > 0 && seen.size < 5000) {
    const active = queue.pop()!
    const key = active.join('\n')
    if (seen.has(key)) continue
    seen.add(key)
    active.forEach((s) => steps.add(s))
    transitions.forEach((tr, i) => {
      if (!tr.from.every((f) => active.includes(f))) return
      fired.add(i)
      const rest = active.filter((s) => !tr.from.includes(s))
      const again = tr.to.find((t) => rest.includes(t))
      if (again !== undefined) remet.set(i, again)
      queue.push([...new Set([...rest, ...tr.to])].sort())
    })
  }
  return { steps, fired, remet }
}

/** 단계 표의 구조 검사. 오류가 있으면 래더를 생성하지 않는다 */
export function validateStepTable(table: StepTable, config: DeviceConfig = defaultDeviceConfig): Issue[] {
  const issues: Issue[] = []
  const add = (code: CheckCode, message: string): void => void issues.push({ level: 'error', code, message })
  /** 참조 오류: 없는 단계·타이머·카운터를 가리킴 */
  const error = (message: string): void => add('step-ref', message)
  /** 값 오류: 시간, 횟수, 상수 */
  const badValue = (message: string): void => add('step-value', message)
  /** 계산용 워드 오류 */
  const badWord = (message: string): void => add('word', message)

  const ids = new Set<string>()
  for (const s of table.steps) {
    if (ids.has(s.id)) error(`단계 id 중복: ${s.id}`)
    ids.add(s.id)
    if (s.timer !== null && s.timer <= 0) badValue(`단계 "${s.name}"의 타이머는 0보다 커야 합니다`)
    if (s.timeLimit !== undefined && s.timeLimit <= 0) badValue(`단계 "${s.name}"의 제한 시간은 0보다 커야 합니다`)
  }
  if (!ids.has(table.initial)) error(`첫 단계가 단계 목록에 없습니다: ${table.initial}`)

  const counters = table.counters ?? []
  const counterIds = new Set<string>()
  for (const c of counters) {
    if (counterIds.has(c.id)) error(`카운터 id 중복: ${c.id}`)
    counterIds.add(c.id)
    if (!Number.isInteger(c.target) || c.target < 1) badValue(`카운터 "${c.name}"의 목표 횟수는 1 이상의 정수여야 합니다`)
    for (const index of [c.countOn, c.resetOn])
      if (!table.transitions[index]) error(`카운터 "${c.name}": 없는 단계 이동 ${index + 1}`)
  }

  // 워드: 선언한 것만 쓸 수 있고 상수는 16비트 정수
  const words = new Set<string>()
  for (const d of table.data ?? []) {
    if (!/^D\d+$/.test(d.address)) badWord(`워드 주소 형식 오류: ${d.address}`)
    if (words.has(d.address)) badWord(`워드 주소 중복: ${d.address}`)
    if (d.address === `D${config.dStart}`) badWord(`${d.address}은 이상 번호에 씁니다. 다른 워드를 쓰거나 설정에서 이상 번호 워드를 바꾸세요`)
    words.add(d.address)
  }
  const checkOperand = (value: Operand, where: string): void => {
    if (typeof value === 'string') {
      if (!words.has(value)) badWord(`${where}: 워드 목록에 없는 주소 ${value}`)
    } else if (!Number.isInteger(value) || value < -32768 || value > 32767) badValue(`${where}: 상수는 -32768~32767의 정수여야 합니다 (${value})`)
  }
  for (const s of table.steps) {
    for (const w of s.writes ?? []) checkOperand(w.value, `단계 "${s.name}"의 값 쓰기`)
    for (const c of s.calcs ?? []) {
      const where = `단계 "${s.name}"의 계산`
      checkOperand(c.target, where)
      checkOperand(c.left, where)
      if ((c.op === undefined) !== (c.right === undefined)) badValue(`${where}: 연산자와 둘째 값은 함께 있어야 합니다`)
      if (c.right !== undefined) checkOperand(c.right, where)
      if (c.op === '/' && c.right === 0) badValue(`${where}: 0으로 나눌 수 없습니다`)
      if (c.op === '*' || c.op === '/') {
        const next = `D${Number(c.target.slice(1)) + 1}`
        const what = c.op === '*' ? '곱셈 결과의 윗자리' : '나머지'
        if (words.has(next) || next === `D${config.dStart}`) badWord(`${where}: ${what}가 ${next}에 쓰여 값이 덮어쓰입니다. ${next}을 비워 두세요`)
      }
    }
  }

  const timed = new Set(table.steps.filter((s) => s.timer !== null).map((s) => s.id))
  const checkCond = (cond: Cond, where: string): void => {
    if (cond.kind === 'compare') {
      checkOperand(cond.left, where)
      checkOperand(cond.right, where)
    }
    if (cond.kind === 'timer' && !timed.has(cond.step)) error(`${where}: 타이머가 없는 단계를 조건으로 씁니다 (${cond.step})`)
    if (cond.kind === 'counter' && !counterIds.has(cond.id)) error(`${where}: 없는 카운터를 조건으로 씁니다 (${cond.id})`)
    if (cond.kind === 'not') checkCond(cond.cond, where)
    if (cond.kind === 'and' || cond.kind === 'or') {
      if (cond.conds.length === 0) badValue(`${where}: 조건이 비어 있습니다`)
      cond.conds.forEach((c) => checkCond(c, where))
    }
  }
  table.transitions.forEach((tr, i) => {
    const where = `단계 이동 ${i + 1}`
    if (tr.from.length === 0) error(`${where}: 출발 단계가 없습니다`)
    for (const id of [...tr.from, ...tr.to]) if (!ids.has(id)) error(`${where}: 없는 단계 ${id}`)
    checkCond(tr.cond, where)
  })
  // 흐름 검사는 단계·전이 참조가 모두 맞을 때만 의미가 있다
  if (issues.length > 0) return issues

  const all = explore(table.transitions, [table.initial])
  for (const s of table.steps) if (!all.steps.has(s.id)) add('unreachable', `어떤 단계 이동으로도 갈 수 없는 단계: ${s.name}`)
  table.transitions.forEach((tr, i) => {
    if (tr.to.length < 2 || !all.fired.has(i)) return
    const after = explore(table.transitions, tr.to).fired
    if (![...after].some((j) => table.transitions[j].from.length > 1)) add('parallel-join', `단계 이동 ${i + 1}: 병렬 분기 뒤에 합류가 없습니다`)
  })
  for (const [i, id] of [...all.remet].sort((a, b) => a[0] - b[0]))
    add('parallel-join', `단계 이동 ${i + 1}: 이미 진행 중인 단계 ${id}를 다시 켭니다 (병렬 흐름이 합류 없이 만남)`)
  return issues
}
