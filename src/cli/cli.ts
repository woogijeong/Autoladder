import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { diagramPage } from '../core/diagram'
import { build, inlineTags, parseProject } from '../core/project'
import type { BuildResult, Project } from '../core/project'
import { reportPage } from '../core/report'
import { readTags } from '../core/tags'
import type { Issue, OpConfig, StepTable, Tag } from '../core/types'
import { readTableFile } from './table'

// 명령줄 도구. Claude Code가 프로젝트 파일(JSON)을 쓰고 이 도구로 검사·생성한다.
// 화면 없이 코어만 쓴다: 프로젝트 파일 → 구조 검사 → 래더 생성 → 검증 → CSV

const usage = `사용법:
  autoladder check <프로젝트.json>                검사만 한다 (파일을 쓰지 않음)
  autoladder generate <프로젝트.json> [--out 폴더]  검사하고 MAIN.csv, COMMENT.csv를 쓴다
  autoladder diagram <프로젝트.json> [--out 파일]   공정 흐름도를 HTML로 쓴다 (브라우저로 연다)
  autoladder report <프로젝트.json> [--out 파일]    검증 결과서를 HTML로 쓴다 (검사 항목별 합격·불합격)
  autoladder tags <할당표.xlsx|.csv>              할당표 파일을 읽어 태그 목록(JSON)으로 보여 준다

종료 코드: 0 = 오류 없음, 1 = 오류 있음`

const print = (line = ''): void => void process.stdout.write(line + '\n')
const hasError = (issues: Issue[]): boolean => issues.some((n) => n.level === 'error')

function printIssues(issues: Issue[]): void {
  for (const level of ['error', 'warning'] as const) {
    for (const issue of issues.filter((n) => n.level === level)) {
      const where = issue.row !== undefined ? ` [할당표 ${issue.row}행]` : issue.rung !== undefined ? ` [렁 ${issue.rung + 1}]` : ''
      print(`${level === 'error' ? '오류' : '경고'}${where}: ${issue.message}`)
    }
  }
}

interface Loaded {
  issues: Issue[]
  project?: Project
  /** 할당표에 오류가 없을 때만 있다 */
  tags?: Tag[]
  result?: BuildResult
}

/** 프로젝트 파일을 읽고 갈 수 있는 데까지 검사한다. 앞 단계에 오류가 있으면 거기서 멈춘다 */
async function load(file: string): Promise<Loaded> {
  const parsed = parseProject(JSON.parse((await readFile(file, 'utf8')).replace(/^﻿/, '')))
  if (!parsed.project) return { issues: parsed.issues }
  const project = parsed.project
  const read = project.tagsFile
    ? readTags(await readTableFile(resolve(dirname(file), project.tagsFile)), project.tagColumns)
    : inlineTags(project)
  if (hasError(read.issues)) return { issues: read.issues, project }
  const result = build(project, read.tags)
  return { issues: [...read.issues, ...result.issues], project, tags: read.tags, result }
}

async function run(command: string, file: string, outPath?: string): Promise<boolean> {
  if (command === 'tags') {
    const { tags, issues } = readTags(await readTableFile(file))
    printIssues(issues)
    if (!hasError(issues)) print(JSON.stringify(tags, null, 2))
    return !hasError(issues)
  }

  const stem = basename(file, extname(file))
  const { issues, project, tags, result } = await load(file)
  const name = project?.name ?? stem
  const program = result?.program
  printIssues(issues)

  if (command === 'report') {
    const path = resolve(outPath ?? join(dirname(file), `${stem}_검증결과서.html`))
    const date = new Date().toLocaleString('ko-KR', { dateStyle: 'long', timeStyle: 'short' })
    await writeFile(
      path,
      reportPage({
        name,
        file: basename(file),
        date,
        issues,
        program,
        tags: tags?.length,
        steps: project?.table.steps.length,
        transitions: project?.table.transitions.length
      })
    )
    print(`종합 판정: ${hasError(issues) ? '불합격' : '합격'}`)
    print(`결과: ${path}`)
    return !hasError(issues)
  }

  if (command === 'diagram') {
    // 오류가 있어도 그림은 그린다 (어디가 틀렸는지 보면서 고치도록). 할당표까지는 읽혀야 한다
    if (!project || !tags) {
      print('결과: 프로젝트 파일이나 할당표에 오류가 있어 흐름도를 그리지 못했습니다')
      return false
    }
    const path = resolve(outPath ?? join(dirname(file), `${stem}.html`))
    await writeFile(path, diagramPage(name, project.table as StepTable, project.op as OpConfig, tags, issues))
    print(`결과: ${path}`)
    return true
  }

  if (program) {
    const devices = program.comments.map((c) => `${c.device}=${c.lines.join(' ')}`)
    print(`렁 ${program.rungs.length}개, 내부 디바이스 ${devices.length}개`)
    print(`내부 디바이스: ${devices.join(', ')}`)
  }
  if (hasError(issues) || !result?.files) {
    print('결과: 오류가 있어 CSV를 만들지 않았습니다')
    return false
  }
  if (command === 'check') {
    print('결과: 오류 없음 (check는 파일을 쓰지 않습니다)')
    return true
  }
  const dir = resolve(outPath ?? join(dirname(file), stem))
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'MAIN.csv'), result.files.main)
  await writeFile(join(dir, 'COMMENT.csv'), result.files.comment)
  print(`결과: ${join(dir, 'MAIN.csv')}`)
  print(`결과: ${join(dir, 'COMMENT.csv')}`)
  return true
}

const [command, file, ...rest] = process.argv.slice(2)
if (!['check', 'generate', 'diagram', 'report', 'tags'].includes(command ?? '') || !file) {
  print(usage)
  process.exitCode = 1
} else {
  const out = rest[0] === '--out' ? rest[1] : undefined
  run(command, file, out).then(
    (ok) => void (process.exitCode = ok ? 0 : 1),
    (error) => {
      print(`오류: ${error instanceof Error ? error.message : error}`)
      process.exitCode = 1
    }
  )
}
