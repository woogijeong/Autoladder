import type { CheckCode, Issue, Program } from './types'

// 검증 결과서: 자동 검사 항목마다 합격·불합격을 적은 문서 한 장(HTML, 인쇄용).
// 검사는 단계 순서로 진행하고, 앞 단계에 오류가 있으면 뒤 단계는 돌지 않으므로 "미실시"로 적는다.

interface Check {
  code: CheckCode
  /** 앞 단계에 오류가 있으면 이 단계는 실시하지 않는다 */
  stage: number
  group: string
  name: string
  rule: string
}

export const checks: Check[] = [
  { code: 'format', stage: 0, group: '프로젝트 파일', name: '파일 형식', rule: '정해진 항목만 있고 빠진 값이 없다' },
  { code: 'tag-address', stage: 1, group: '할당표', name: '주소 형식', rule: 'X·Y + 16진수, 워드의 비트(D0.F), 워드(D144) 형식이다' },
  { code: 'tag-duplicate', stage: 1, group: '할당표', name: '주소 중복', rule: '같은 주소가 두 번 나오지 않는다' },
  { code: 'tag-field', stage: 1, group: '할당표', name: '이름·접점·방향', rule: '이름이 있고, 접점은 A 또는 B, D 주소는 입력·출력 방향이 있다' },
  { code: 'step-ref', stage: 2, group: '단계 표', name: '단계·타이머·카운터 참조', rule: '없는 단계, 타이머, 카운터를 가리키지 않는다' },
  { code: 'step-value', stage: 2, group: '단계 표', name: '시간·횟수·상수 값', rule: '시간과 횟수는 0보다 크고, 상수는 16비트 범위이며, 0으로 나누지 않는다' },
  { code: 'word', stage: 2, group: '단계 표', name: '계산용 워드', rule: '선언한 워드만 쓰고, 이상 번호나 덮어쓰이는 워드와 겹치지 않는다' },
  { code: 'unreachable', stage: 3, group: '단계 표', name: '도달 불가 단계', rule: '모든 단계에 갈 수 있다' },
  { code: 'parallel-join', stage: 3, group: '단계 표', name: '병렬 분기 합류', rule: '병렬 분기는 합류하고, 진행 중인 단계를 다시 켜지 않는다' },
  { code: 'generate', stage: 4, group: '래더', name: '래더 생성', rule: '단계 표와 운전 설정으로 래더가 만들어진다' },
  { code: 'io-known', stage: 5, group: '래더', name: '할당표 밖 주소', rule: '래더에 쓰인 모든 I/O 주소가 할당표에 있다' },
  { code: 'input-write', stage: 5, group: '래더', name: '입력 주소 쓰기', rule: '입력 주소에 값을 쓰는 명령이 없다' },
  { code: 'double-coil', stage: 5, group: '래더', name: '이중 코일', rule: '출력 코일은 디바이스당 한 번만 나온다' },
  { code: 'interlock', stage: 5, group: '래더', name: '인터록', rule: '인터록 쌍의 출력 렁에 상대 출력의 B접점이 있다' },
  { code: 'device-overlap', stage: 5, group: '래더', name: '내부 디바이스 겹침', rule: '자동 할당한 디바이스가 할당표 주소와 겹치지 않는다' },
  { code: 'unused-output', stage: 5, group: '래더', name: '미사용 출력', rule: '할당표의 출력을 래더에서 모두 쓴다 (안 쓰면 경고)' },
  { code: 'export', stage: 6, group: '내보내기', name: '명령 형식', rule: 'GX Works2에서 내보낸 샘플로 확인한 명령만 쓴다' },
  { code: 'comment-length', stage: 6, group: '내보내기', name: '코멘트 길이', rule: '디바이스 코멘트가 3행×8칸 안에 들어간다 (넘으면 잘라내고 경고)' }
]

export type Verdict = '합격' | '경고' | '불합격' | '미실시'

/** 검사 항목별 판정. 앞 단계에 오류가 있으면 뒤 단계 항목은 미실시 */
export function judge(issues: Issue[]): { check: Check; verdict: Verdict; found: Issue[] }[] {
  const stageOf = new Map(checks.map((c) => [c.code, c.stage]))
  const errorStages = issues.filter((n) => n.level === 'error').map((n) => stageOf.get(n.code)!)
  const firstFailed = errorStages.length > 0 ? Math.min(...errorStages) : Infinity
  return checks.map((check) => {
    const found = issues.filter((n) => n.code === check.code)
    const verdict: Verdict =
      check.stage > firstFailed ? '미실시' : found.some((n) => n.level === 'error') ? '불합격' : found.length > 0 ? '경고' : '합격'
    return { check, verdict, found }
  })
}

const esc = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** 사람이 해야 하는 확인. 자동 검사로는 알 수 없는 것 */
const manualChecks = [
  'GX Works2에서 프로그램 CSV를 읽고 변환했을 때 오류가 0건이다',
  'GX Works2에서 코멘트 CSV를 읽었을 때 디바이스 코멘트가 표시된다',
  'GX Works2 시뮬레이터에서 공정 설명대로 단계가 진행된다',
  '비상정지, 이상 정지, 수동 운전이 의도대로 동작한다 (설정한 경우)',
  '실기 투입 전에 담당자가 래더를 검토했다'
]

export interface ReportInput {
  /** 공정 이름 */
  name: string
  /** 프로젝트 파일 이름 */
  file: string
  /** 작성 일시 (결과서에 그대로 적는다) */
  date: string
  issues: Issue[]
  program?: Program
  steps?: number
  transitions?: number
  tags?: number
}

/** 검증 결과서 HTML */
export function reportPage(input: ReportInput): string {
  const rows = judge(input.issues)
  const errors = input.issues.filter((n) => n.level === 'error').length
  const warnings = input.issues.filter((n) => n.level === 'warning').length
  const overall = errors > 0 ? '불합격' : '합격'
  const count = (v: Verdict): number => rows.filter((r) => r.verdict === v).length
  const where = (n: Issue): string => (n.row !== undefined ? `[할당표 ${n.row}행] ` : n.rung !== undefined ? `[렁 ${n.rung + 1}] ` : '')
  const number = (value: number | undefined): string => (value === undefined ? '-' : String(value))

  const body = rows
    .map(
      ({ check, verdict, found }, i) => `<tr>
<td class="num">${i + 1}</td><td class="keep">${esc(check.group)}</td><td class="keep">${esc(check.name)}</td><td>${esc(check.rule)}</td>
<td class="verdict v-${verdict}">${verdict}</td>
<td>${found.length === 0 ? (verdict === '미실시' ? '앞 단계 오류로 검사하지 않음' : '위반 0건') : `${found.length}건<ul>${found.map((n) => `<li>${esc(where(n) + n.message)}</li>`).join('')}</ul>`}</td>
</tr>`
    )
    .join('\n')

  const devices = (input.program?.comments ?? []).map((c) => `<tr><td class="mono">${esc(c.device)}</td><td>${esc(c.lines.join(' '))}</td></tr>`).join('\n')

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<title>${esc(input.name)} 래더 프로그램 검증 결과서</title>
<style>
body { margin: 0; padding: 32px; background: #FFFFFF; color: #1B2430; font: 13px/1.6 'Malgun Gothic', 'Noto Sans KR', system-ui, sans-serif; }
main { max-width: 960px; margin: 0 auto; }
h1 { margin: 0 0 16px; font-size: 22px; text-align: center; }
h2 { margin: 24px 0 8px; font-size: 15px; }
table { width: 100%; border-collapse: collapse; }
th, td { border: 1px solid #8A94A3; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #EEF1F5; font-weight: 700; white-space: nowrap; }
ul { margin: 4px 0 0; padding-left: 18px; }
p { margin: 0 0 8px; }
.num { text-align: center; white-space: nowrap; }
.keep { white-space: nowrap; }
.mono { font-family: Consolas, monospace; white-space: nowrap; }
.verdict { text-align: center; font-weight: 700; white-space: nowrap; }
.v-합격 { color: #1E6B34; } .v-경고 { color: #8A5A00; } .v-불합격 { color: #B42318; } .v-미실시 { color: #5B6675; }
.overall { font-size: 18px; }
.box { display: inline-block; width: 14px; height: 14px; border: 1px solid #1B2430; vertical-align: -2px; }
.note { color: #4A5565; }
@media print { body { padding: 0; } h2 { break-after: avoid; } tr { break-inside: avoid; } }
</style>
</head>
<body>
<main>
<h1>래더 프로그램 검증 결과서</h1>

<table>
<tr><th>공정</th><td>${esc(input.name)}</td><th>프로젝트 파일</th><td>${esc(input.file)}</td></tr>
<tr><th>대상</th><td>미쓰비시 Q(Q03UDV), GX Works2</td><th>작성 일시</th><td>${esc(input.date)}</td></tr>
<tr><th>검사 도구</th><td>Autoladder 자동 검사</td><th>종합 판정</th><td class="verdict overall v-${overall}">${overall}</td></tr>
</table>

<h2>1. 요약</h2>
<table>
<tr><th>할당표 행</th><th>단계</th><th>단계 이동</th><th>렁</th><th>내부 디바이스</th><th>오류</th><th>경고</th></tr>
<tr><td class="num">${number(input.tags)}</td><td class="num">${number(input.steps)}</td><td class="num">${number(input.transitions)}</td><td class="num">${number(input.program?.rungs.length)}</td><td class="num">${number(input.program?.comments.length)}</td><td class="num">${errors}</td><td class="num">${warnings}</td></tr>
</table>
<p class="note">검사 항목 ${rows.length}개: 합격 ${count('합격')}, 경고 ${count('경고')}, 불합격 ${count('불합격')}, 미실시 ${count('미실시')}. 오류가 하나라도 있으면 CSV를 만들지 않습니다.</p>

<h2>2. 자동 검사 항목</h2>
<table>
<tr><th>번호</th><th>구분</th><th>검사 항목</th><th>기준</th><th>판정</th><th>내용</th></tr>
${body}
</table>

<h2>3. 사람이 확인할 항목</h2>
<p class="note">자동 검사는 래더가 할당표·단계 표와 어긋나지 않는지만 봅니다. 아래는 GX Works2와 설비에서 직접 확인해야 합니다.</p>
<table>
<tr><th>번호</th><th>확인 항목</th><th>확인</th><th>확인자</th><th>일자</th></tr>
${manualChecks.map((m, i) => `<tr><td class="num">${i + 1}</td><td>${esc(m)}</td><td class="num"><span class="box"></span></td><td></td><td></td></tr>`).join('\n')}
</table>
${
  devices
    ? `
<h2>4. 자동 할당한 내부 디바이스</h2>
<table>
<tr><th>디바이스</th><th>쓰임</th></tr>
${devices}
</table>`
    : ''
}
</main>
</body>
</html>
`
}
