import type { Cond, Issue, OpConfig, StepTable, Tag } from './types'

// 공정 흐름도: 단계 표를 블록 다이어그램(HTML)으로 보여 준다. 래더를 만들기 전에 사람이 공정을 확인하는 용도.
// 그림 배치는 Mermaid가 한다.
// ponytail: Mermaid를 CDN에서 불러오므로 볼 때 인터넷이 필요하다. 오프라인에서 봐야 하면 스크립트를 파일에 넣는다

/** Mermaid 라벨 안에서 문법으로 읽히는 글자를 바꾼다 */
const label = (lines: string[]): string =>
  `"${lines
    .map((l) => l.replaceAll('"', '#quot;').replaceAll('<', '#lt;').replaceAll('>', '#gt;'))
    .join('<br/>')}"`

const html = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** 단계 표 → Mermaid 흐름도 글 */
export function flowChart(table: StepTable, op: OpConfig, tags: Tag[]): string {
  const tagName = new Map(tags.map((t) => [t.address, t.name]))
  const named = (address: string): string => (tagName.has(address) ? `${address} ${tagName.get(address)}` : address)
  // 조건에는 의미까지 적는다 (이름만으로는 "공급" 앞끝·뒤끝 센서가 구분되지 않는다)
  const tagMeaning = new Map(tags.map((t) => [t.address, t.meaning]))
  const sensed = (address: string): string => [named(address), tagMeaning.get(address)].filter((p) => p).join(' ')
  const step = new Map(table.steps.map((s, i) => [s.id, { node: `s${i}`, name: s.name, timer: s.timer }]))
  const counters = table.counters ?? []
  const counter = new Map(counters.map((c) => [c.id, c]))

  const text = (cond: Cond, nested = false): string => {
    switch (cond.kind) {
      case 'input':
        return sensed(cond.address)
      case 'timer':
        return `${step.get(cond.step)?.name ?? cond.step} ${step.get(cond.step)?.timer ?? '?'}초 지남`
      case 'counter':
        return `${counter.get(cond.id)?.name ?? cond.id} ${counter.get(cond.id)?.target ?? '?'}번 채움`
      case 'compare':
        return `${cond.left} ${cond.op} ${cond.right}`
      case 'not':
        return cond.cond.kind === 'input' ? `${sensed(cond.cond.address)} 아님` : `아님(${text(cond.cond)})`
      default: {
        const joined = cond.conds.map((c) => text(c, true)).join(cond.kind === 'and' ? ' 그리고 ' : ' 또는 ')
        return nested ? `(${joined})` : joined
      }
    }
  }

  // 줄바꿈은 자동에 맡기지 않고 직접 넣는다: 조건은 "그리고/또는" 앞에서, 출력은 두 개마다
  const condLines = (cond: Cond, prefix = ''): string[] => {
    if (cond.kind !== 'and' && cond.kind !== 'or') return [prefix + text(cond)]
    const word = cond.kind === 'and' ? '그리고 ' : '또는 '
    return cond.conds.map((c, i) => (i === 0 ? prefix : word) + text(c, true))
  }
  const pairs = (items: string[], prefix: string): string[] =>
    items.flatMap((_, i) => (i % 2 === 0 ? [(i === 0 ? prefix : '') + items.slice(i, i + 2).join(', ')] : []))

  const lines = ['flowchart TD']
  const start = [`시작: ${named(op.start)}`, ...(op.homeCondition ? condLines(op.homeCondition, '원위치: ') : [])]
  lines.push(`  idle(["대기"])`, `  idle -->|${label(start)}| ${step.get(table.initial)?.node ?? 'idle'}`)

  table.steps.forEach((s, i) => {
    const body = [
      `${i + 1}. ${s.name}`,
      ...pairs(s.outputs.map(named), '켜짐: '),
      ...(s.timer !== null ? [`타이머 ${s.timer}초`] : []),
      ...(s.timeLimit !== undefined ? [`제한 시간 ${s.timeLimit}초`] : []),
      ...(s.writes ?? []).map((w) => `값: ${named(w.address)} = ${w.value}`),
      ...(s.calcs ?? []).map((c) => `계산: ${c.target} = ${c.left}${c.op ? ` ${c.op} ${c.right}` : ''}`)
    ]
    lines.push(`  s${i}[${label(body)}]`)
  })

  let ends = 0
  table.transitions.forEach((tr, i) => {
    // 같은 단계에서 나가는 단계 이동이 여럿이면 위에 적은 것이 우선
    const rivals = table.transitions.filter((other) => other.from.some((f) => tr.from.includes(f)))
    const rank = rivals.length > 1 ? `${rivals.indexOf(tr) + 1}순위: ` : ''
    const notes = [
      ...counters.filter((c) => c.countOn === i).map((c) => `${c.name} 1번 셈`),
      ...counters.filter((c) => c.resetOn === i).map((c) => `${c.name} 0으로`),
      ...(tr.isCycleEnd ? ['사이클 끝'] : [])
    ]
    const condition = [...condLines(tr.cond, rank), ...notes.map((n) => `[${n}]`)]
    const caption = label(condition)
    const from = tr.from.map((id) => step.get(id)?.node ?? id)
    const to = tr.to.length > 0 ? tr.to.map((id) => step.get(id)?.node ?? id) : [`end${ends++}`]
    if (tr.to.length === 0) lines.push(`  ${to[0]}(["끝: 대기로"])`)
    if (from.length === 1 && to.length === 1) lines.push(`  ${from[0]} -->|${caption}| ${to[0]}`)
    else {
      // 병렬 분기·합류: 조건을 가운데 마디에 적고 선을 모았다가 나눈다
      const what = to.length > 1 ? '동시에 시작' : '모두 끝나면'
      lines.push(`  t${i}{{${label([what, ...condition])}}}`)
      from.forEach((f) => lines.push(`  ${f} --> t${i}`))
      to.forEach((t) => lines.push(`  t${i} --> ${t}`))
    }
  })
  return lines.join('\n')
}

/** 운전 설정을 사람이 읽는 줄로 */
function opLines(op: OpConfig, tags: Tag[]): string[] {
  const tagName = new Map(tags.map((t) => [t.address, t.name]))
  const named = (address: string): string => (tagName.has(address) ? `${address} ${tagName.get(address)}` : address)
  const pairs = (list: [string, string][]): string => list.map(([a, b]) => `${named(a)} ↔ ${named(b)}`).join(', ')
  return [
    `시작 버튼: ${named(op.start)}`,
    op.stop ? `정지 버튼(사이클 끝에서 멈춤): ${named(op.stop)}` : '',
    op.estop ? `비상정지: ${named(op.estop)}` : '',
    op.reset ? `이상 해제 버튼: ${named(op.reset)}` : '',
    op.autoManual ? `자동·수동 스위치(ON = 자동): ${named(op.autoManual)}` : '',
    op.homeButton ? `원점복귀 버튼: ${named(op.homeButton)}` : '',
    op.homeOutputs?.length ? `원점복귀 중 켜는 출력: ${op.homeOutputs.map(named).join(', ')}` : '',
    op.manual?.length ? `수동 버튼: ${op.manual.map((b) => `${named(b.button)} → ${named(b.output)}`).join(', ')}` : '',
    op.interlocks?.length ? `동시에 켜지면 안 되는 출력: ${pairs(op.interlocks)}` : '',
    op.sensorPairs?.length ? `동시에 감지되면 이상인 센서: ${pairs(op.sensorPairs)}` : '',
    op.faultLamp ? `이상 램프: ${named(op.faultLamp)}` : '',
    op.alwaysOn?.length ? `항상 켜 두는 출력: ${op.alwaysOn.map(named).join(', ')}` : '',
    op.alwaysWrites?.length ? `항상 써 두는 값: ${op.alwaysWrites.map((w) => `${named(w.address)} = ${w.value}`).join(', ')}` : ''
  ].filter((l) => l)
}

/** 흐름도 + 운전 설정 + 검사 결과를 담은 HTML 한 장 */
export function diagramPage(name: string, table: StepTable, op: OpConfig, tags: Tag[], issues: Issue[]): string {
  const list = (items: string[]): string => items.map((i) => `<li>${html(i)}</li>`).join('\n')
  const errors = issues.filter((n) => n.level === 'error').map((n) => n.message)
  const warnings = issues.filter((n) => n.level === 'warning').map((n) => n.message)
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${html(name)} 공정 흐름도</title>
<style>
body { margin: 0; padding: 24px; background: #F4F6F9; color: #1B2430; font: 14px/1.6 'Malgun Gothic', 'Noto Sans KR', system-ui, sans-serif; }
h1 { margin: 0 0 4px; font-size: 22px; }
h2 { margin: 0 0 8px; font-size: 16px; }
p { margin: 0 0 16px; color: #4A5565; }
section { margin: 0 0 16px; padding: 16px; background: #FFFFFF; border: 1px solid #D9DEE6; border-radius: 8px; overflow-x: auto; }
ul { margin: 0; padding-left: 20px; }
.error { border-color: #C2410C; } .error h2 { color: #9A3412; }
.warning { border-color: #E0B565; } .warning h2 { color: #5C3A00; }
</style>
</head>
<body>
<h1>${html(name)}</h1>
<p>공정 흐름도입니다. 네모 = 단계(그동안 켜지는 출력), 화살표 = 단계 이동(넘어가는 조건). 맞는지 확인한 뒤 래더를 만드세요.</p>
${errors.length ? `<section class="error"><h2>오류 ${errors.length}건 (고쳐야 래더를 만들 수 있습니다)</h2><ul>\n${list(errors)}\n</ul></section>` : ''}
${warnings.length ? `<section class="warning"><h2>경고 ${warnings.length}건</h2><ul>\n${list(warnings)}\n</ul></section>` : ''}
<section>
<pre class="mermaid">
${html(flowChart(table, op, tags))}
</pre>
</section>
<section>
<h2>운전 설정</h2>
<ul>
${list(opLines(op, tags))}
</ul>
</section>
<script type="module">
import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@12/dist/mermaid.esm.min.mjs'
mermaid.initialize({ startOnLoad: true, theme: 'neutral', flowchart: { htmlLabels: true, curve: 'linear', wrappingWidth: 2000 } })
</script>
</body>
</html>
`
}
