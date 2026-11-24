import * as z from 'zod'
import { exportComments, exportProgram, formatComment } from './export'
import { generate } from './generate'
import { validateStepTable } from './steptable'
import { readTags } from './tags'
import type { Cond, Issue, OpConfig, Program, StepTable, Tag } from './types'
import { defaultDeviceConfig } from './types'
import { verify } from './verify'

z.config(z.locales.ko())

// 프로젝트 파일(JSON)의 형식. 사람이나 Claude Code가 직접 쓰는 파일이라 모르는 키는 오류로 본다(오타 방지)

const operand = z.union([z.string(), z.number()])
const compareOp = z.enum(['=', '<>', '>', '>=', '<', '<='])
const cond: z.ZodType<Cond> = z.lazy(() =>
  z.union([
    z.strictObject({ kind: z.literal('input'), address: z.string() }),
    z.strictObject({ kind: z.literal('timer'), step: z.string() }),
    z.strictObject({ kind: z.literal('counter'), id: z.string() }),
    z.strictObject({ kind: z.literal('compare'), left: z.string(), op: compareOp, right: operand }),
    z.strictObject({ kind: z.literal('not'), cond }),
    z.strictObject({ kind: z.enum(['and', 'or']), conds: z.array(cond) })
  ])
)
const wordWrite = z.strictObject({ address: z.string(), value: z.number() })

const table = z.strictObject({
  initial: z.string(),
  steps: z.array(
    z.strictObject({
      id: z.string(),
      name: z.string(),
      outputs: z.array(z.string()).default([]),
      timer: z.number().nullable().default(null),
      timeLimit: z.number().optional(),
      writes: z.array(wordWrite).optional(),
      calcs: z
        .array(z.strictObject({ target: z.string(), left: operand, op: z.enum(['+', '-', '*', '/']).optional(), right: operand.optional() }))
        .optional()
    })
  ),
  transitions: z.array(
    z.strictObject({ from: z.array(z.string()), to: z.array(z.string()), cond, isCycleEnd: z.boolean().optional() })
  ),
  counters: z
    .array(z.strictObject({ id: z.string(), name: z.string(), countOn: z.number(), target: z.number(), resetOn: z.number() }))
    .optional(),
  data: z.array(z.strictObject({ address: z.string(), name: z.string() })).optional()
})

const op = z.strictObject({
  start: z.string(),
  stop: z.string().optional(),
  estop: z.string().optional(),
  reset: z.string().optional(),
  autoManual: z.string().optional(),
  homeButton: z.string().optional(),
  homeCondition: cond.optional(),
  homeOutputs: z.array(z.string()).optional(),
  manual: z.array(z.strictObject({ button: z.string(), output: z.string() })).optional(),
  interlocks: z.array(z.tuple([z.string(), z.string()])).optional(),
  sensorPairs: z.array(z.tuple([z.string(), z.string()])).optional(),
  faultLamp: z.string().optional(),
  alwaysOn: z.array(z.string()).optional(),
  alwaysWrites: z.array(wordWrite).optional()
})

const index = z.number().int().min(0)
export const projectSchema = z
  .strictObject({
    /** 공정 이름 (기록용) */
    name: z.string().optional(),
    /** 할당표를 직접 적을 때. X·Y는 방향을 생략할 수 있고, D 주소는 방향이 필요하다 */
    tags: z
      .array(
        z.strictObject({
          address: z.string(),
          name: z.string(),
          meaning: z.string().default(''),
          direction: z.enum(['input', 'output']).optional(),
          contact: z.enum(['A', 'B']).default('A')
        })
      )
      .optional(),
    /** 할당표를 파일(.xlsx, .csv)로 줄 때. 이 프로젝트 파일 기준 상대 경로 */
    tagsFile: z.string().optional(),
    /** tagsFile의 열 제목으로 열을 못 찾을 때: 열 종류 → 열 번호(0부터) */
    tagColumns: z
      .strictObject({ address: index, name: index, meaning: index, contact: index, direction: index })
      .partial()
      .optional(),
    op,
    table,
    /** 내부 디바이스 시작 번호. 생략하면 M0, T0, C0, D0, 타이머 100ms */
    devices: z
      .strictObject({ mStart: index, tStart: index, cStart: index, dStart: index, timerTicksPerSecond: z.number().positive() })
      .partial()
      .optional()
  })
  .refine((p) => (p.tags === undefined) !== (p.tagsFile === undefined), { message: 'tags와 tagsFile 중 하나만 적어야 합니다' })

export type Project = z.infer<typeof projectSchema>

/** JSON 값 → 프로젝트. 형식이 틀리면 어디가 틀렸는지 알려 준다 */
export function parseProject(json: unknown): { project?: Project; issues: Issue[] } {
  const result = projectSchema.safeParse(json)
  if (result.success) return { project: result.data, issues: [] }
  return {
    issues: result.error.issues.map((issue) => ({
      level: 'error' as const,
      code: 'format' as const,
      message: `프로젝트 파일 형식 오류 (${issue.path.join('.') || '전체'}): ${issue.message}`
    }))
  }
}

/** 프로젝트에 직접 적은 할당표 → 태그 목록 (파일에서 읽은 표와 같은 검사를 거친다) */
export function inlineTags(project: Project): { tags: Tag[]; issues: Issue[] } {
  const rows = (project.tags ?? []).map((t) => [t.address, t.name, t.meaning, t.contact, t.direction ?? ''])
  return readTags(rows, { address: 0, name: 1, meaning: 2, contact: 3, direction: 4 }, false)
}

export interface BuildResult {
  issues: Issue[]
  program?: Program
  /** 오류가 없을 때만 있다 */
  files?: { main: Uint8Array; comment: Uint8Array }
}

/** 프로젝트 + 태그 목록 → 구조 검사 → 래더 생성 → 검증 → CSV. 오류가 있으면 CSV를 만들지 않는다 */
export function build(project: Project, tags: Tag[]): BuildResult {
  const stepTable = project.table as StepTable
  const opConfig = project.op as OpConfig
  const config = { ...defaultDeviceConfig, ...project.devices }
  const hasError = (issues: Issue[]): boolean => issues.some((n) => n.level === 'error')

  const thrown = (error: unknown): string => (error instanceof Error ? error.message : String(error))

  const issues = validateStepTable(stepTable, config)
  if (hasError(issues)) return { issues }

  let program: Program
  try {
    program = generate(stepTable, opConfig, tags, config)
  } catch (error) {
    // 운전 설정이 없는 단계·타이머를 가리킬 때 등
    return { issues: [...issues, { level: 'error', code: 'generate', message: thrown(error) }] }
  }
  issues.push(...verify(program, tags, opConfig))
  if (hasError(issues)) return { issues, program }

  const comments = [...tags.map((t) => ({ device: t.address, lines: [t.name, t.meaning] })), ...program.comments].map((c) => {
    const { comment, truncated } = formatComment(...c.lines)
    if (truncated)
      issues.push({ level: 'warning', code: 'comment-length', message: `코멘트가 3행×8칸을 넘어 잘렸습니다: ${c.device} "${c.lines.join(' / ')}"` })
    return { device: c.device, comment }
  })
  try {
    return { issues, program, files: { main: exportProgram(program.rungs), comment: exportComments(comments) } }
  } catch (error) {
    // GX Works2 샘플로 확인하지 않은 명령
    return { issues: [...issues, { level: 'error', code: 'export', message: thrown(error) }], program }
  }
}
