import { expect, test } from 'vitest'
import { generate } from '../src/core/generate'
import { validateStepTable } from '../src/core/steptable'
import { verify } from '../src/core/verify'
import { mps } from './fixtures/mps'
import { Sim } from './sim'

/**
 * MPS 라인을 흉내 내는 아주 작은 설비. 실린더는 명령 즉시 끝에 닿고, 벨트 위치는 스캔 수로 센다.
 * PlcTwin의 실제 속도·통신 지연은 흉내 내지 않는다. 단계 순서가 맞는지만 본다.
 */
function runLine(metal: boolean): { steps: string[]; chip: string } {
  const sim = new Sim(generate(mps.table, mps.op, mps.tags).rungs)
  const extended: Record<string, boolean> = {}
  let chip = 'magazine'
  let belt = 0 // 벨트에 오른 뒤 컨베이어가 돈 스캔 수 (1스캔 = 10 mm로 본다)
  let lift = 140
  const sorter = (): boolean => chip === 'belt' && belt >= 13 && belt <= 23

  // 양솔레노이드: 후진 명령이 우선, 명령이 없으면 그 자리에 있는다
  const double = (name: string, fwd: string, bwd: string, fwdLamp: string, bwdLamp: string): boolean => {
    if (sim.get(bwd)) extended[name] = false
    else if (sim.get(fwd)) extended[name] = true
    sim.set(fwdLamp, !!extended[name])
    sim.set(bwdLamp, !extended[name])
    return !!extended[name]
  }
  const single = (cmd: string, onLamp: string, offLamp: string): boolean => {
    sim.set(onLamp, sim.get(cmd))
    sim.set(offLamp, !sim.get(cmd))
    return sim.get(cmd)
  }
  const plant = (): void => {
    const supply = double('supply', 'D100.0', 'D100.1', 'D0.0', 'D0.1')
    const emit = double('emit', 'D100.2', 'D100.3', 'D0.2', 'D0.3')
    single('D100.4', 'D0.4', 'D0.5')
    const push = double('push', 'D100.5', 'D100.6', 'D0.6', 'D0.7')
    const stopper = single('D100.7', 'D0.9', 'D0.8')
    const pad = double('pad', 'D100.8', 'D100.9', 'D0.A', 'D0.B')
    const stock = double('stock', 'D100.B', 'D100.C', 'D0.D', 'D0.E')

    if (chip === 'magazine' && supply) chip = 'stage'
    if (chip === 'stage' && emit) chip = 'belt'
    if (chip === 'belt' && sim.get('D100.E')) belt = stopper ? Math.min(belt + 1, 55) : belt + 1
    if (chip === 'belt' && push) chip = belt >= 27 && belt <= 33 ? 'box' : 'missed'

    const run = sim.get('D103.0') && sim.get('D102.0') && sim.get('D102.1') && sim.word('D142') === 9003
    const speed = sim.word('D140')
    if (run) lift += Math.max(-speed, Math.min(speed, sim.word('D144') - lift))
    sim.set('D3.4', run && lift === sim.word('D144'))

    const vacuum = sim.get('D100.A')
    if (vacuum && chip === 'belt' && belt === 55 && lift === 0 && !pad) chip = 'held'
    if (!vacuum && chip === 'held') chip = pad && stock && lift === 140 ? 'shelf' : 'dropped'
    sim.set('D0.C', chip === 'held')
    sim.set('D0.F', chip === 'magazine')
    sim.set('D1.1', sorter())
    sim.set('D1.2', sorter() && metal)
    sim.set('D1.3', chip === 'belt' && belt === 55)
  }

  const steps: string[] = []
  plant()
  sim.set('X0', true)
  for (let n = 0; n < 1000; n++) {
    sim.scan()
    sim.set('X0', false)
    plant()
    const now = mps.table.steps.filter((_, i) => sim.get(`M${i}`)).map((s) => s.id).join('+')
    if (now !== steps[steps.length - 1]) steps.push(now)
    if (steps.length > 1 && now === 'wait') break
  }
  return { steps, chip }
}

test('MPS 라인: 단계 표와 생성 결과에 오류가 없다', () => {
  expect(validateStepTable(mps.table)).toEqual([])
  const issues = verify(generate(mps.table, mps.op, mps.tags), mps.tags, mps.op)
  expect(issues.filter((n) => n.level === 'error')).toEqual([])
  // 이 공정이 쓰지 않는 출력: 서보 정지, 조그
  expect(issues.map((n) => n.message)).toEqual([
    '래더에서 쓰지 않는 출력: D102.4 서보정지',
    '래더에서 쓰지 않는 출력: D102.8 조그위로',
    '래더에서 쓰지 않는 출력: D102.C 조그아래',
    '래더에서 쓰지 않는 출력: D146 조그속도'
  ])
})

test('MPS 라인: 금속 칩은 공급부터 창고 선반 적재까지 간다', () => {
  const { steps, chip } = runLine(true)
  expect(steps).toEqual([
    'wait', 'supply', 'supplyBack', 'drill', 'drillUp', 'emit', 'emitBack', 'convey',
    'toStop', 'down', 'grab', 'up', 'stockFwd', 'padFwd', 'place', 'padBack', 'stockBack', 'wait'
  ])
  expect(chip).toBe('shelf')
})

test('MPS 라인: 비금속 칩은 배출 상자로 밀어낸다', () => {
  const { steps, chip } = runLine(false)
  expect(steps).toEqual([
    'wait', 'supply', 'supplyBack', 'drill', 'drillUp', 'emit', 'emitBack', 'convey',
    'toOut', 'push', 'pushBack', 'wait'
  ])
  expect(chip).toBe('box')
})

test('검증: 입력 주소에 쓰는 명령과 내부 디바이스·할당표 겹침을 잡는다', () => {
  const issues = verify(
    {
      rungs: [{ note: '', instrs: [{ op: 'LD', args: ['X0'] }, { op: 'OUT', args: ['D0.0'] }, { op: 'MOV', args: ['K1', 'D40'] }] }],
      comments: [{ device: 'D0', lines: ['이상', '번호'] }]
    },
    mps.tags
  )
  expect(issues.filter((n) => n.level === 'error')).toEqual([
    { level: 'error', code: 'input-write', rung: 0, message: '입력 주소에 쓰는 명령: OUT D0.0' },
    { level: 'error', code: 'input-write', rung: 0, message: '입력 주소에 쓰는 명령: MOV D40' },
    { level: 'error', code: 'device-overlap', message: '내부 디바이스 D0이 할당표 주소 D0.0와 겹칩니다. 설정에서 시작 번호를 바꾸세요' }
  ])
})
