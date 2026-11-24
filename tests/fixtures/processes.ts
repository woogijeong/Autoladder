import type { OpConfig, StepTable, Tag } from '../../src/core/types'

// 기준 공정. 주소는 테스트용 가정값이다.

export const input = (address: string, name: string, meaning: string): Tag => ({
  address,
  name,
  meaning,
  direction: 'input',
  contact: 'A'
})
export const output = (address: string, name: string, meaning: string): Tag => ({
  address,
  name,
  meaning,
  direction: 'output',
  contact: 'A'
})
export const x = (address: string) => ({ kind: 'input' as const, address })

/** 실린더 순차 왕복 A+ B+ B- A- (편솔레노이드: 출력 ON = 전진, OFF = 후진) */
export const cylinder = {
  tags: [
    input('X0', '시작', '버튼'),
    input('X1', 'A후진단', '센서'),
    input('X2', 'A전진단', '센서'),
    input('X3', 'B후진단', '센서'),
    input('X4', 'B전진단', '센서'),
    output('Y20', 'A전진', '솔밸브'),
    output('Y21', 'B전진', '솔밸브')
  ],
  op: { start: 'X0' } satisfies OpConfig,
  table: {
    initial: 'a_fwd',
    steps: [
      { id: 'a_fwd', name: 'A전진', outputs: ['Y20'], timer: null },
      { id: 'b_fwd', name: 'B전진', outputs: ['Y20', 'Y21'], timer: null },
      { id: 'b_back', name: 'B후진', outputs: ['Y20'], timer: null },
      { id: 'a_back', name: 'A후진', outputs: [], timer: null }
    ],
    transitions: [
      { from: ['a_fwd'], to: ['b_fwd'], cond: x('X2') },
      { from: ['b_fwd'], to: ['b_back'], cond: x('X4') },
      { from: ['b_back'], to: ['a_back'], cond: x('X3') },
      { from: ['a_back'], to: [], cond: x('X1') }
    ]
  } satisfies StepTable
}

/**
 * 컨베이어 이송 + 양품/불량 분류. 양품 3개마다 상자 교체.
 * 비상정지는 B접점(평소 ON), 원위치 = 푸셔 뒷단.
 */
export const conveyor = {
  tags: [
    input('X0', '시작', '버튼'),
    input('X1', '정지', '버튼'),
    { ...input('X2', '비상정지', '버튼'), contact: 'B' as const },
    input('X3', '리셋', '버튼'),
    input('X4', '투입감지', '센서'),
    input('X5', '판정위치', '센서'),
    input('X6', '불량감지', '센서'),
    input('X7', '끝단도착', '센서'),
    input('X8', '푸셔앞단', '센서'),
    input('X9', '푸셔뒷단', '센서'),
    input('XA', '교체확인', '버튼'),
    output('Y20', '컨베이어', '모터'),
    output('Y21', '푸셔전진', '솔밸브'),
    output('Y22', '상자교체', '램프'),
    output('Y23', '이상', '램프')
  ],
  op: {
    start: 'X0',
    stop: 'X1',
    estop: 'X2',
    reset: 'X3',
    homeCondition: x('X9'),
    sensorPairs: [['X8', 'X9']],
    faultLamp: 'Y23'
  } satisfies OpConfig,
  table: {
    initial: 'wait',
    steps: [
      { id: 'wait', name: '투입대기', outputs: [], timer: null },
      { id: 'move', name: '이송', outputs: ['Y20'], timer: null, timeLimit: 5 },
      { id: 'pass', name: '양품배출', outputs: ['Y20'], timer: null },
      { id: 'push', name: '불량밀기', outputs: ['Y21'], timer: null },
      { id: 'back', name: '푸셔복귀', outputs: [], timer: null },
      { id: 'full', name: '상자교체', outputs: ['Y22'], timer: null }
    ],
    transitions: [
      { from: ['wait'], to: ['full'], cond: { kind: 'counter', id: 'good' } },
      { from: ['wait'], to: ['move'], cond: x('X4') },
      { from: ['move'], to: ['push'], cond: { kind: 'and', conds: [x('X5'), x('X6')] } },
      { from: ['move'], to: ['pass'], cond: x('X5') },
      { from: ['pass'], to: ['wait'], cond: x('X7'), isCycleEnd: true },
      { from: ['push'], to: ['back'], cond: x('X8') },
      { from: ['back'], to: ['wait'], cond: x('X9'), isCycleEnd: true },
      { from: ['full'], to: ['wait'], cond: x('XA') }
    ],
    counters: [{ id: 'good', name: '양품', countOn: 4, target: 3, resetOn: 7 }]
  } satisfies StepTable
}

/**
 * 두 실린더 동시 동작 후 합류 (양솔레노이드). 준비 1초 → A·B 동시 전진 → 둘 다 전진단이면 함께 후진.
 * 수동 버튼은 A만 둔다.
 */
export const parallel = {
  tags: [
    input('X0', '시작', '버튼'),
    input('X1', '자동', '스위치'),
    input('X2', '원점복귀', '버튼'),
    input('X3', 'A후진단', '센서'),
    input('X4', 'A전진단', '센서'),
    input('X5', 'B후진단', '센서'),
    input('X6', 'B전진단', '센서'),
    input('X7', 'A전진', '수동버튼'),
    input('X8', 'A후진', '수동버튼'),
    { ...input('X9', '비상정지', '버튼'), contact: 'B' as const },
    output('Y20', 'A전진', '솔밸브'),
    output('Y21', 'A후진', '솔밸브'),
    output('Y22', 'B전진', '솔밸브'),
    output('Y23', 'B후진', '솔밸브')
  ],
  op: {
    start: 'X0',
    estop: 'X9',
    autoManual: 'X1',
    homeButton: 'X2',
    homeCondition: { kind: 'and', conds: [x('X3'), x('X5')] },
    homeOutputs: ['Y21', 'Y23'],
    manual: [
      { button: 'X7', output: 'Y20' },
      { button: 'X8', output: 'Y21' }
    ],
    interlocks: [
      ['Y20', 'Y21'],
      ['Y22', 'Y23']
    ]
  } satisfies OpConfig,
  table: {
    initial: 'ready',
    steps: [
      { id: 'ready', name: '준비', outputs: [], timer: 1 },
      { id: 'a_fwd', name: 'A전진', outputs: ['Y20'], timer: null },
      { id: 'b_fwd', name: 'B전진', outputs: ['Y22'], timer: null },
      { id: 'back', name: '함께후진', outputs: ['Y21', 'Y23'], timer: null }
    ],
    transitions: [
      { from: ['ready'], to: ['a_fwd', 'b_fwd'], cond: { kind: 'timer', step: 'ready' } },
      { from: ['a_fwd', 'b_fwd'], to: ['back'], cond: { kind: 'and', conds: [x('X4'), x('X6')] } },
      { from: ['back'], to: [], cond: { kind: 'and', conds: [x('X3'), x('X5')] } }
    ]
  } satisfies StepTable
}

/** 신호등: 타이머만으로 반복 */
export const trafficLight = {
  tags: [
    input('X0', '시작', '버튼'),
    output('Y30', '녹색등', '램프'),
    output('Y31', '황색등', '램프'),
    output('Y32', '적색등', '램프')
  ],
  op: { start: 'X0' } satisfies OpConfig,
  table: {
    initial: 'green',
    steps: [
      { id: 'green', name: '녹색', outputs: ['Y30'], timer: 3 },
      { id: 'yellow', name: '황색', outputs: ['Y31'], timer: 1 },
      { id: 'red', name: '적색', outputs: ['Y32'], timer: 3 }
    ],
    transitions: [
      { from: ['green'], to: ['yellow'], cond: { kind: 'timer', step: 'green' } },
      { from: ['yellow'], to: ['red'], cond: { kind: 'timer', step: 'yellow' } },
      { from: ['red'], to: ['green'], cond: { kind: 'timer', step: 'red' } }
    ]
  } satisfies StepTable
}
