import type { Issue, OpConfig, Program, Tag } from './types'

/** 할당표에 있어야 하는 주소: X·Y, 워드의 비트(D0.F), 워드(D144) */
const isIo = (device: string): boolean => /^([XY][0-9A-F]+|D\d+(\.[0-9A-F])?)$/.test(device)
/** D0.F → D0 */
const wordOf = (device: string): string => device.split('.')[0]

/** 명령이 값을 쓰는 디바이스. 접점이면 없음 */
function target(op: string, args: string[]): string | undefined {
  if (['OUT', 'SET', 'RST', 'BKRST'].includes(op)) return args[0]
  if (/^(MOVP?|[-+*/]P)$/.test(op)) return args[args.length - 1]
  return undefined
}

/** 생성된 래더를 I/O 할당표, 운전 설정의 인터록 쌍과 대조한다 */
export function verify(program: Program, tags: Tag[], op?: OpConfig): Issue[] {
  const { rungs } = program
  const issues: Issue[] = []
  const byAddress = new Map(tags.map((t) => [t.address, t]))
  // Autoladder가 할당한 디바이스 (M, T, C, 이상 번호, 계산용 워드)
  const internal = new Set(program.comments.map((c) => c.device))
  const used = new Set<string>()
  const coilRungs = new Map<string, number[]>()

  rungs.forEach((rung, i) => {
    for (const instr of rung.instrs) {
      for (const arg of instr.args) {
        used.add(arg)
        if (isIo(arg) && !byAddress.has(arg) && !internal.has(arg))
          issues.push({ level: 'error', code: 'io-known', rung: i, message: `I/O 할당표에 없는 주소: ${arg}` })
      }
      const written = target(instr.op, instr.args)
      if (written && byAddress.get(written)?.direction === 'input')
        issues.push({ level: 'error', code: 'input-write', rung: i, message: `입력 주소에 쓰는 명령: ${instr.op} ${written}` })
      if (instr.op === 'OUT') coilRungs.set(instr.args[0], [...(coilRungs.get(instr.args[0]) ?? []), i])
    }
  })

  for (const [device, where] of coilRungs) {
    if (where.length > 1)
      for (const rung of where) issues.push({ level: 'error', code: 'double-coil', rung, message: `이중 코일: ${device}` })
  }
  // 인터록: 한쪽 출력 렁에 상대 출력의 B접점이 있어야 한다
  for (const [a, b] of op?.interlocks ?? []) {
    for (const [coil, partner] of [[a, b], [b, a]]) {
      for (const rung of coilRungs.get(coil) ?? []) {
        const blocked = rungs[rung].instrs.some((n) => ['LDI', 'ANI', 'ORI'].includes(n.op) && n.args[0] === partner)
        if (!blocked) issues.push({ level: 'error', code: 'interlock', rung, message: `인터록 누락: ${coil} 렁에 ${partner}의 B접점이 없습니다` })
      }
    }
  }
  // 내부 워드가 할당표의 워드(또는 그 비트)와 같은 번호이면 서로 덮어쓴다
  for (const device of internal) {
    const clash = tags.find((t) => wordOf(t.address) === device)
    if (clash)
      issues.push({ level: 'error', code: 'device-overlap', message: `내부 디바이스 ${device}이 할당표 주소 ${clash.address}와 겹칩니다. 설정에서 시작 번호를 바꾸세요` })
  }
  for (const tag of tags) {
    if (tag.direction === 'output' && !used.has(tag.address))
      issues.push({ level: 'warning', code: 'unused-output', message: `래더에서 쓰지 않는 출력: ${tag.address} ${tag.name}` })
  }
  return issues
}
