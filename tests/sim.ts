import type { Instr, Rung } from '../src/core/types'

const int16 = (v: number): number => ((v + 32768) & 0xffff) - 32768

/**
 * 테스트 전용 스캔 해석기. Autoladder가 만드는 명령만 구현한다.
 * 한 스캔 = 타이머 1틱(100ms)으로 본다. 최종 판정은 GX Works2 시뮬레이터가 한다.
 */
export class Sim {
  private bits = new Map<string, boolean>()
  private timerCount = new Map<string, number>()
  private counterCount = new Map<string, number>()
  /** 카운터 입력의 직전 스캔 값 (올라가는 순간에만 센다) */
  private counterInput = new Map<string, boolean>()
  private words = new Map<string, number>()

  constructor(private rungs: Rung[]) {}

  /** 펄스 명령 조건의 직전 스캔 값 */
  private pulseInput = new Map<Instr, boolean>()

  word(device: string): number {
    return this.words.get(device) ?? 0
  }

  setWord(device: string, value: number): void {
    this.words.set(device, value)
  }

  /** K상수 또는 워드 값 */
  private value(arg: string): number {
    return arg.startsWith('K') ? Number(arg.slice(1)) : this.word(arg)
  }

  get(device: string): boolean {
    return device === 'SM400' || (this.bits.get(device) ?? false) // SM400 = 항상 ON
  }

  set(device: string, value: boolean): void {
    this.bits.set(device, value)
  }

  /** 켜져 있는 디바이스 중 prefix로 시작하는 것 (정렬됨) */
  on(prefix: string): string[] {
    return [...this.bits]
      .filter(([d, v]) => v && d.startsWith(prefix))
      .map(([d]) => d)
      .sort()
  }

  scan(times = 1): void {
    for (let n = 0; n < times; n++) {
      for (const rung of this.rungs) {
        const stack: boolean[] = []
        const top = (): boolean => stack[stack.length - 1]
        const replace = (v: boolean): void => void (stack[stack.length - 1] = v)
        for (const instr of rung.instrs) {
          const { op, args } = instr
          const d = args[0]
          switch (op) {
            case 'LD':
              stack.push(this.get(d))
              break
            case 'LDI':
              stack.push(!this.get(d))
              break
            case 'AND':
              replace(top() && this.get(d))
              break
            case 'ANI':
              replace(top() && !this.get(d))
              break
            case 'OR':
              replace(top() || this.get(d))
              break
            case 'ORI':
              replace(top() || !this.get(d))
              break
            case 'ANB': {
              const b = stack.pop()!
              replace(top() && b)
              break
            }
            case 'ORB': {
              const b = stack.pop()!
              replace(top() || b)
              break
            }
            case 'OUT':
              if (d.startsWith('T')) {
                const count = top() ? (this.timerCount.get(d) ?? 0) + 1 : 0
                this.timerCount.set(d, count)
                this.set(d, count >= Number(args[1].slice(1)))
              } else if (d.startsWith('C')) {
                if (top() && !this.counterInput.get(d)) this.counterCount.set(d, (this.counterCount.get(d) ?? 0) + 1)
                this.counterInput.set(d, top())
                this.set(d, (this.counterCount.get(d) ?? 0) >= Number(args[1].slice(1)))
              } else this.set(d, top())
              break
            case 'SET':
              if (top()) this.set(d, true)
              break
            case 'RST':
              if (top()) {
                this.set(d, false)
                this.counterCount.delete(d)
              }
              break
            case 'BKRST': {
              // 연속한 비트 n개를 끈다 (10진 번호 디바이스만: M)
              const first = Number(d.slice(1))
              if (top()) for (let k = 0; k < Number(args[1].slice(1)); k++) this.set(d[0] + (first + k), false)
              break
            }
            case 'MOV':
              if (top()) this.words.set(args[1], Number(d.slice(1)))
              break
            case 'MOVP':
            case '+P':
            case '-P':
            case '*P':
            case '/P': {
              // 펄스 명령: 조건이 꺼졌다 켜지는 스캔에만 실행
              const rising = top() && !this.pulseInput.get(instr)
              this.pulseInput.set(instr, top())
              if (!rising) break
              const target = args[args.length - 1]
              const next = `D${Number(target.slice(1)) + 1}`
              const a = this.value(args[0])
              const b = this.value(args[1])
              if (op === 'MOVP') this.words.set(target, a)
              else if (op === '+P') this.words.set(target, int16(a + b))
              else if (op === '-P') this.words.set(target, int16(a - b))
              else if (op === '*P') {
                this.words.set(target, int16(a * b))
                this.words.set(next, (a * b) >> 16) // 결과는 32비트: 윗자리는 다음 워드
              } else {
                if (b === 0) throw new Error('sim: 0으로 나눔 (실제 PLC는 연산 에러로 정지)')
                this.words.set(target, Math.trunc(a / b))
                this.words.set(next, a % b) // 나머지는 다음 워드
              }
              break
            }
            default: {
              const cmp = /^(LD|AND|OR)(=|<>|>=|<=|>|<)$/.exec(op)
              if (!cmp) throw new Error(`sim: 구현하지 않은 명령 ${op}`)
              const a = this.value(args[0])
              const b = this.value(args[1])
              const v = { '=': a === b, '<>': a !== b, '>': a > b, '>=': a >= b, '<': a < b, '<=': a <= b }[cmp[2]]!
              if (cmp[1] === 'LD') stack.push(v)
              else replace(cmp[1] === 'AND' ? top() && v : top() || v)
            }
          }
        }
      }
    }
  }
}
