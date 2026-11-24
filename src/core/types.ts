/** I/O 할당표 한 행 */
export interface Tag {
  /** X·Y + 16진수, 워드의 비트(D0.F), 워드(D144) */
  address: string
  name: string
  meaning: string
  direction: 'input' | 'output'
  contact: 'A' | 'B'
}

/** 전이 조건식: 입력, 단계 타이머 완료, 카운터 완료의 AND / OR / NOT 조합. 입력은 "눌림/감지"가 참이다 */
export type Cond =
  | { kind: 'input'; address: string }
  | { kind: 'timer'; step: string }
  | { kind: 'counter'; id: string }
  | { kind: 'compare'; left: string; op: CompareOp; right: Operand }
  | { kind: 'not'; cond: Cond }
  | { kind: 'and' | 'or'; conds: Cond[] }

/** 워드 주소(D10) 또는 상수. 값은 16비트 정수(-32768~32767) */
export type Operand = string | number
export type CompareOp = '=' | '<>' | '>' | '>=' | '<' | '<='

/**
 * 워드 계산: target = left (op right). op가 없으면 대입.
 * 곱셈은 결과의 윗자리를, 나눗셈은 나머지를 target 다음 워드에 쓴다 (Q 시리즈 명령의 동작)
 */
export interface Calc {
  target: string
  left: Operand
  op?: '+' | '-' | '*' | '/'
  right?: Operand
}

/** 출력 워드(할당표에 있는 D144 등)에 쓰는 16비트 고정값 */
export interface WordWrite {
  address: string
  value: number
}

export interface Step {
  id: string
  name: string
  /** 이 단계가 활성인 동안 켜지는 출력 주소 */
  outputs: string[]
  /** 단계 타이머(초). 없으면 null */
  timer: number | null
  /** 제한 시간(초). 단계가 이보다 오래 켜져 있으면 이상. 없으면 감시하지 않는다 */
  timeLimit?: number
  /** 이 단계가 활성인 동안 출력 워드에 써 두는 고정값 (예: 서보 목표 위치) */
  writes?: WordWrite[]
  /** 이 단계에 들어올 때 한 번만 하는 계산 (위에서부터 차례로) */
  calcs?: Calc[]
}

export interface Transition {
  from: string[]
  /** 빈 배열이면 공정 종료(대기로) */
  to: string[]
  cond: Cond
  /** 사이클의 끝. 정지 예약이 있으면 to 단계를 켜지 않고 대기로 간다 */
  isCycleEnd?: boolean
}

export interface Counter {
  id: string
  name: string
  /** 이 전이가 성립할 때마다 1번 센다 (transitions 배열의 인덱스) */
  countOn: number
  target: number
  /** 이 전이가 성립하면 0으로 되돌린다 (transitions 배열의 인덱스) */
  resetOn: number
}

export interface StepTable {
  steps: Step[]
  transitions: Transition[]
  counters?: Counter[]
  /** 계산과 비교에 쓰는 워드. 여기에 없는 워드는 쓸 수 없다. 비상정지·이상에도 값을 지우지 않는다 */
  data?: { address: string; name: string }[]
  /** 시작 버튼으로 켜지는 첫 단계 */
  initial: string
}

/** 운전 설정. 지정하지 않은 기능은 생성하지 않는다 */
export interface OpConfig {
  /** 시작 버튼 입력 주소 */
  start: string
  /** 정지 버튼: 현재 사이클을 끝내고 대기 */
  stop?: string
  estop?: string
  /** 이상 해제 버튼 */
  reset?: string
  /** 자동·수동 전환 스위치. ON = 자동 (가정). 없으면 항상 자동 */
  autoManual?: string
  homeButton?: string
  /** 원위치 조건. 시작 조건이자 원점복귀의 끝 */
  homeCondition?: Cond
  /** 원점복귀 중에 켜는 출력 */
  homeOutputs?: string[]
  /** 수동 모드에서 버튼을 누르는 동안만 켜는 출력 */
  manual?: { button: string; output: string }[]
  /** 동시에 켜지면 안 되는 출력 쌍 */
  interlocks?: [string, string][]
  /** 동시에 ON이면 안 되는 입력 쌍 */
  sensorPairs?: [string, string][]
  faultLamp?: string
  /** 항상 켜 두는 출력 (예: PLC READY). 비상정지·이상이면 끈다 */
  alwaysOn?: string[]
  /** 항상 써 두는 고정값 (예: 이동 속도) */
  alwaysWrites?: WordWrite[]
}

export interface DeviceConfig {
  mStart: number
  tStart: number
  cStart: number
  /** 이상 번호를 적는 워드 (0 = 정상) */
  dStart: number
  /** 타이머 설정값 = 초 × 이 값. Q 저속 타이머 기본 100ms → 10 */
  timerTicksPerSecond: number
}

export const defaultDeviceConfig: DeviceConfig = { mStart: 0, tStart: 0, cStart: 0, dStart: 0, timerTicksPerSecond: 10 }

/** 명령 1개. args[0]이 명령과 같은 행, 나머지는 다음 행에 쓰인다 */
export interface Instr {
  op: string
  args: string[]
}

export interface Rung {
  /** 이 렁이 어디서 나왔는지 (렁별 설명) */
  note: string
  /** 행 간 스테이트먼트를 직접 정할 때만 쓴다. 없으면 내보낼 때 note로 만든다 */
  statement?: string
  instrs: Instr[]
}

export interface DeviceComment {
  device: string
  /** 코멘트 행 (최대 3행, 행당 8칸) */
  lines: string[]
}

export interface Program {
  rungs: Rung[]
  /** Autoladder가 할당한 내부 디바이스(M, T, C, D)의 이름 */
  comments: DeviceComment[]
}

/** 검사 항목. 검증 결과서에서 항목별 합격·불합격을 내는 데 쓴다 (목록과 순서는 report.ts) */
export type CheckCode =
  | 'format'
  | 'tag-address'
  | 'tag-duplicate'
  | 'tag-field'
  | 'step-ref'
  | 'step-value'
  | 'word'
  | 'unreachable'
  | 'parallel-join'
  | 'generate'
  | 'io-known'
  | 'input-write'
  | 'double-coil'
  | 'interlock'
  | 'device-overlap'
  | 'unused-output'
  | 'export'
  | 'comment-length'

export interface Issue {
  level: 'error' | 'warning'
  /** 어느 검사에서 나왔는지 */
  code: CheckCode
  /** rungs 배열의 인덱스. 렁과 무관하면 없음 */
  rung?: number
  /** 할당표의 행 번호(1부터). 할당표 오류에만 있음 */
  row?: number
  message: string
}
