import type { OpConfig, StepTable, Tag } from '../../src/core/types'
import { input, output, x } from './processes'

/**
 * MPS 라인 (PlcTwin). 디바이스 맵은 plc_twin/README.md 3절 그대로다.
 * 공정 순서와 시간은 PlcTwin 설비 모델을 읽고 정한 가정값이며 사용자 확인이 필요하다.
 *   칩 대기 → 공급 → 가공(드릴) → 송출 → 컨베이어 → 판별
 *   금속: 스토퍼에서 멈춤 → 리프트 하강 → 흡착 → 상승 → 창고 선반에 적재
 *   비금속: 배출 실린더 앞에서 멈춤 → 배출 상자로 밀어냄
 * 시작 버튼 X0은 PlcTwin에 없는 가정 주소다 (GX Works2 디바이스 테스트로 켠다).
 */
const sensor = (address: string, name: string, meaning: string): Tag => input(address, name, meaning)

export const mps = {
  tags: [
    input('X0', '시작', '버튼'),
    sensor('D0.0', '공급', '앞끝센서'),
    sensor('D0.1', '공급', '뒤끝센서'),
    sensor('D0.2', '송출', '앞끝센서'),
    sensor('D0.3', '송출', '뒤끝센서'),
    sensor('D0.4', '가공', '아래센서'),
    sensor('D0.5', '가공', '위센서'),
    sensor('D0.6', '배출', '앞끝센서'),
    sensor('D0.7', '배출', '뒤끝센서'),
    sensor('D0.8', '스토퍼', '아래센서'),
    sensor('D0.9', '스토퍼', '위센서'),
    sensor('D0.A', '흡착', '앞끝센서'),
    sensor('D0.B', '흡착', '뒤끝센서'),
    sensor('D0.C', '흡착패드', '칩잡음'),
    sensor('D0.D', '창고', '앞끝센서'),
    sensor('D0.E', '창고', '뒤끝센서'),
    sensor('D0.F', '공급센서', '칩있음'),
    sensor('D1.1', '물품감지', '칩있음'),
    sensor('D1.2', '금속감지', '센서'),
    sensor('D1.3', '스토퍼', '칩도착'),
    sensor('D2.0', '서보', '준비됨'),
    sensor('D2.C', '서보', '움직임'),
    sensor('D3.0', '서보', '기동완료'),
    sensor('D3.4', '서보', '위치완료'),
    sensor('D40', '리프트', '현재위치'),
    output('D100.0', '공급전진', '솔밸브'),
    output('D100.1', '공급후진', '솔밸브'),
    output('D100.2', '송출전진', '솔밸브'),
    output('D100.3', '송출후진', '솔밸브'),
    output('D100.4', '가공하강', '솔밸브'),
    output('D100.5', '배출전진', '솔밸브'),
    output('D100.6', '배출후진', '솔밸브'),
    output('D100.7', '스토퍼', '올리기'),
    output('D100.8', '흡착전진', '솔밸브'),
    output('D100.9', '흡착후진', '솔밸브'),
    output('D100.A', '흡착패드', '켜기'),
    output('D100.B', '창고전진', '솔밸브'),
    output('D100.C', '창고후진', '솔밸브'),
    output('D100.D', '드릴', '회전'),
    output('D100.E', '컨베이어', '모터'),
    output('D102.0', 'PLC준비', ''),
    output('D102.1', '서보켜기', ''),
    output('D102.4', '서보정지', ''),
    output('D102.8', '조그위로', ''),
    output('D102.C', '조그아래', ''),
    output('D103.0', '위치이동', '시작'),
    output('D140', '이동속도', ''),
    output('D142', '이동명령', ''),
    output('D144', '목표위치', ''),
    output('D146', '조그속도', '')
  ],
  op: {
    start: 'X0',
    // 원위치: 실린더가 모두 뒤(위)에 있을 때
    homeCondition: { kind: 'and', conds: ['D0.1', 'D0.3', 'D0.5', 'D0.7', 'D0.B', 'D0.E'].map(x) },
    alwaysOn: ['D102.0', 'D102.1'],
    alwaysWrites: [
      { address: 'D140', value: 10 }, // 50 mm/s
      { address: 'D142', value: 9003 } // 이 값일 때만 위치 이동이 된다
    ]
  } satisfies OpConfig,
  table: {
    initial: 'wait',
    steps: [
      { id: 'wait', name: '칩대기', outputs: [], timer: null },
      { id: 'supply', name: '공급', outputs: ['D100.0'], timer: null },
      { id: 'supplyBack', name: '공급복귀', outputs: ['D100.1'], timer: null },
      { id: 'drill', name: '가공', outputs: ['D100.4', 'D100.D'], timer: 2 }, // 하강 약 1.4초 + 가공
      { id: 'drillUp', name: '가공복귀', outputs: [], timer: null },
      { id: 'emit', name: '송출', outputs: ['D100.2'], timer: null },
      { id: 'emitBack', name: '송출복귀', outputs: ['D100.3'], timer: null },
      { id: 'convey', name: '이송', outputs: ['D100.E', 'D100.7'], timer: null },
      { id: 'toStop', name: '스토퍼로', outputs: ['D100.E', 'D100.7'], timer: null },
      { id: 'down', name: '내려가기', outputs: ['D103.0'], timer: null, writes: [{ address: 'D144', value: 0 }] },
      { id: 'grab', name: '칩잡기', outputs: ['D100.A'], timer: null },
      { id: 'up', name: '올라가기', outputs: ['D100.A', 'D103.0'], timer: null, writes: [{ address: 'D144', value: 140 }] },
      { id: 'stockFwd', name: '창고전진', outputs: ['D100.A', 'D100.B'], timer: null },
      { id: 'padFwd', name: '흡착전진', outputs: ['D100.A', 'D100.8'], timer: null },
      { id: 'place', name: '내려놓기', outputs: [], timer: null },
      { id: 'padBack', name: '흡착후진', outputs: ['D100.9'], timer: null },
      { id: 'stockBack', name: '창고후진', outputs: ['D100.C'], timer: null },
      // 물품감지부터 배출 실린더 앞까지 약 180 mm, 벨트 100 mm/s. 통신 지연을 빼고 1.6초 (조정값)
      { id: 'toOut', name: '배출위치', outputs: ['D100.E'], timer: 1.6 },
      { id: 'push', name: '배출', outputs: ['D100.5'], timer: null },
      { id: 'pushBack', name: '배출복귀', outputs: ['D100.6'], timer: null }
    ],
    transitions: [
      { from: ['wait'], to: ['supply'], cond: x('D0.F') },
      { from: ['supply'], to: ['supplyBack'], cond: x('D0.0') },
      { from: ['supplyBack'], to: ['drill'], cond: x('D0.1') },
      { from: ['drill'], to: ['drillUp'], cond: { kind: 'and', conds: [x('D0.4'), { kind: 'timer', step: 'drill' }] } },
      { from: ['drillUp'], to: ['emit'], cond: x('D0.5') },
      { from: ['emit'], to: ['emitBack'], cond: x('D0.2') },
      { from: ['emitBack'], to: ['convey'], cond: x('D0.3') },
      // 금속 칩은 물품감지와 금속감지가 함께 켜진다. 위쪽 전이가 우선
      { from: ['convey'], to: ['toStop'], cond: x('D1.2') },
      { from: ['convey'], to: ['toOut'], cond: x('D1.1') },
      { from: ['toStop'], to: ['down'], cond: x('D1.3') },
      { from: ['down'], to: ['grab'], cond: x('D3.4') },
      { from: ['grab'], to: ['up'], cond: x('D0.C') },
      { from: ['up'], to: ['stockFwd'], cond: x('D3.4') },
      { from: ['stockFwd'], to: ['padFwd'], cond: x('D0.D') },
      { from: ['padFwd'], to: ['place'], cond: x('D0.A') },
      { from: ['place'], to: ['padBack'], cond: { kind: 'not', cond: x('D0.C') } },
      { from: ['padBack'], to: ['stockBack'], cond: x('D0.B') },
      { from: ['stockBack'], to: ['wait'], cond: x('D0.E'), isCycleEnd: true },
      { from: ['toOut'], to: ['push'], cond: { kind: 'timer', step: 'toOut' } },
      { from: ['push'], to: ['pushBack'], cond: x('D0.6') },
      { from: ['pushBack'], to: ['wait'], cond: x('D0.7'), isCycleEnd: true }
    ]
  } satisfies StepTable
}
