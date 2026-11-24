import { mkdirSync, writeFileSync } from 'node:fs'
import { expect, test } from 'vitest'
import { diagramPage, flowChart } from '../src/core/diagram'
import { exportProgram } from '../src/core/export'
import { generate } from '../src/core/generate'
import { build, inlineTags, parseProject } from '../src/core/project'
import { checks, judge, reportPage } from '../src/core/report'
import { mps } from './fixtures/mps'
import { conveyor, cylinder, parallel, trafficLight } from './fixtures/processes'

const names: Record<string, string> = {
  cylinder: '실린더 순차 왕복',
  trafficLight: '신호등',
  parallel: '두 실린더 동시 동작',
  conveyor: '컨베이어 분류',
  mps: 'MPS 라인'
}

// 기준 공정을 프로젝트 파일로 써서 스킬 폴더의 examples/에 둔다 (Claude Code가 보고 따라 쓰는 예시)
test('기준 공정 5종: 프로젝트 파일로 만든 결과가 직접 생성한 결과와 같다', () => {
  mkdirSync('skills/autoladder/examples', { recursive: true })
  for (const [key, p] of Object.entries({ cylinder, trafficLight, parallel, conveyor, mps })) {
    const text = JSON.stringify({ name: names[key], tags: p.tags, op: p.op, table: p.table }, null, 2) + '\n'
    writeFileSync(`skills/autoladder/examples/${key}.json`, text)

    const parsed = parseProject(JSON.parse(text))
    expect(parsed.issues).toEqual([])
    const tags = inlineTags(parsed.project!)
    expect(tags.issues).toEqual([])
    expect(tags.tags).toEqual(p.tags)

    const result = build(parsed.project!, tags.tags)
    expect(result.issues.filter((n) => n.level === 'error')).toEqual([])
    expect(result.files!.main).toEqual(exportProgram(generate(p.table, p.op, p.tags).rungs))
  }
})

test('공정 흐름도: 단계, 조건, 선택 분기 순위, 병렬 합류, 카운터가 그림 글에 들어간다', () => {
  const sorting = flowChart(conveyor.table, conveyor.op, conveyor.tags)
  expect(sorting).toContain('idle -->|"시작: X0 시작<br/>원위치: X9 푸셔뒷단 센서"| s0')
  expect(sorting).toContain('s1["2. 이송<br/>켜짐: Y20 컨베이어<br/>제한 시간 5초"]')
  expect(sorting).toContain('s1 -->|"1순위: X5 판정위치 센서<br/>그리고 X6 불량감지 센서"| s3')
  expect(sorting).toContain('s1 -->|"2순위: X5 판정위치 센서"| s2')
  expect(sorting).toContain('s2 -->|"X7 끝단도착 센서<br/>[양품 1번 셈]<br/>[사이클 끝]"| s0')
  expect(sorting).toContain('s0 -->|"1순위: 양품 3번 채움"| s5')

  const both = flowChart(parallel.table, parallel.op, parallel.tags)
  expect(both).toContain('t0{{"동시에 시작<br/>준비 1초 지남"}}')
  expect(both).toContain('t1{{"모두 끝나면<br/>X4 A전진단 센서<br/>그리고 X6 B전진단 센서"}}')
  expect(both).toContain('s3 -->|"X3 A후진단 센서<br/>그리고 X5 B후진단 센서"| end0')

  // 비교 조건의 부등호는 그림 문법과 겹치지 않게 바꾼다
  const page = diagramPage('시험', conveyor.table, conveyor.op, conveyor.tags, [{ level: 'warning', code: 'unused-output', message: 'a < b' }])
  expect(page).toContain('<li>a &lt; b</li>')
  expect(page).toContain('class="mermaid"')
})

test('검증 결과서: 항목별 판정. 경고는 경고로, 앞 단계가 불합격이면 뒤 단계는 미실시', () => {
  const verdicts = (issues: Parameters<typeof judge>[0]): Record<string, string> =>
    Object.fromEntries(judge(issues).map((r) => [r.check.code, r.verdict]))

  // 컨베이어 분류: 전 항목 합격
  const clean = build(parseProject({ tags: conveyor.tags, op: conveyor.op, table: conveyor.table }).project!, conveyor.tags)
  expect(new Set(Object.values(verdicts(clean.issues)))).toEqual(new Set(['합격']))

  // MPS 라인: 쓰지 않는 출력이 있어 그 항목만 경고
  const warned = verdicts(build(parseProject({ tags: mps.tags, op: mps.op, table: mps.table }).project!, mps.tags).issues)
  expect(warned['unused-output']).toBe('경고')
  expect(Object.values(warned).filter((v) => v !== '합격')).toEqual(['경고'])

  // 없는 단계를 가리키면 그 항목이 불합격, 흐름 검사부터는 돌지 않았으므로 미실시
  const broken = { ...conveyor.table, initial: 'nowhere' }
  const failed = verdicts(build(parseProject({ tags: conveyor.tags, op: conveyor.op, table: broken }).project!, conveyor.tags).issues)
  expect(failed['step-ref']).toBe('불합격')
  expect(failed['tag-address']).toBe('합격')
  expect(failed['step-value']).toBe('합격') // 같은 단계의 다른 항목은 검사했다
  expect([failed['unreachable'], failed['double-coil'], failed['export']]).toEqual(['미실시', '미실시', '미실시'])

  // 모든 검사 코드가 결과서 항목에 있다 (항목 없이 사라지는 오류가 없게)
  const page = reportPage({ name: '시험', file: 'a.json', date: '2026년 11월 24일', issues: clean.issues, program: clean.program })
  expect(page).toContain('종합 판정')
  expect(checks).toHaveLength(18)
})

test('프로젝트 파일: 생략한 값은 기본값으로 채운다 (출력 없음, 타이머 없음, A접점, X·Y 방향)', () => {
  const { project, issues } = parseProject({
    tags: [
      { address: 'X0', name: '시작' },
      { address: 'Y20', name: '램프' }
    ],
    op: { start: 'X0' },
    table: {
      initial: 'on',
      steps: [{ id: 'on', name: '켜기', outputs: ['Y20'], timer: 2 }, { id: 'off', name: '끄기' }],
      transitions: [
        { from: ['on'], to: ['off'], cond: { kind: 'timer', step: 'on' } },
        { from: ['off'], to: [], cond: { kind: 'not', cond: { kind: 'input', address: 'X0' } } }
      ]
    }
  })
  expect(issues).toEqual([])
  expect(project!.table.steps[1]).toEqual({ id: 'off', name: '끄기', outputs: [], timer: null })
  const tags = inlineTags(project!).tags
  expect(tags.map((t) => [t.direction, t.contact, t.meaning])).toEqual([['input', 'A', ''], ['output', 'A', '']])
  expect(build(project!, tags).issues).toEqual([])
})

test('프로젝트 파일: 모르는 키와 빠진 값은 위치와 함께 오류로 알린다', () => {
  const { project, issues } = parseProject({
    tags: [{ address: 'X0', name: '시작' }],
    op: { start: 'X0', estopp: 'X1' },
    table: { initial: 'a', steps: [{ id: 'a' }], transitions: [] }
  })
  expect(project).toBeUndefined()
  expect(issues.map((n) => n.message.split(':')[0])).toEqual(['프로젝트 파일 형식 오류 (op)', '프로젝트 파일 형식 오류 (table.steps.0.name)'])
})

test('프로젝트 빌드: 오류가 있으면 CSV를 만들지 않는다', () => {
  const { project } = parseProject({
    tags: [{ address: 'X0', name: '시작' }],
    op: { start: 'X0' },
    table: {
      initial: 'a',
      steps: [{ id: 'a', name: '가', outputs: ['Y99'] }],
      transitions: [{ from: ['a'], to: [], cond: { kind: 'input', address: 'X5' } }]
    }
  })
  const result = build(project!, inlineTags(project!).tags)
  expect(result.files).toBeUndefined()
  expect(result.issues.map((n) => n.message)).toEqual(['I/O 할당표에 없는 주소: X5', 'I/O 할당표에 없는 주소: Y99'])
})
