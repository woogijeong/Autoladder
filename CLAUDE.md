# Autoladder

공정 설명과 I/O 할당표를 넣으면 미쓰비시 Q(Q03UDV) + GX Works2용 래더 CSV를 만들어 주는 도구.
사용 방식: Claude Code가 프로젝트 파일(JSON)을 쓰고 명령줄 도구로 CSV를 만든다 (`skills/autoladder/SKILL.md`).
TypeScript, 화면 없음(공정 흐름도와 검증 결과서는 HTML 파일로 낸다). 출력 글은 한국어, 단일 사용자용.

## 문서

- `PRD.md`: 요구사항과 시스템 설계. 맨 위의 방향 변경 안내가 본문보다 우선한다 (앱 화면과 앱 안의 Claude 호출은 만들지 않는다)
- `docs/plan.md`: 작업 단계와 현재 상태
- `docs/devlog.md`: 날짜별 개발 기록

## 명령

```
npm test           # vitest. 통과 시 samples/ 에 기준 공정 CSV도 다시 쓴다
npm run typecheck  # 타입 검사 (src, tests)
npm run build:cli  # 명령줄 도구 빌드 → skills/autoladder/cli.mjs (라이브러리까지 한 파일. 코어를 고치면 다시 빌드). 묶인 라이브러리의 라이선스 문구도 다시 쓴다
npm run install:skill  # 빌드 후 스킬 폴더를 ~/.claude/skills/autoladder 로 복사
node skills/autoladder/cli.mjs check|generate|diagram|report <프로젝트.json>   # 검사 / CSV 생성 / 공정 흐름도 / 검증 결과서
```

## 구조

- `src/core/`: 순수 TypeScript. Node API를 쓰지 않는다 (파일 읽기·쓰기는 `src/cli/`에서만)
  - `generate.ts` 단계 표 → 래더, `verify.ts` 검증, `export.ts` CSV, `steptable.ts` 구조 검사, `types.ts`
  - `project.ts` 프로젝트 파일 형식(zod)과 빌드(검사 → 생성 → 검증 → CSV), `tags.ts` 할당표 읽기, `diagram.ts` 공정 흐름도(HTML), `report.ts` 검증 결과서(HTML, 검사 항목 목록도 여기)
- `src/cli/`: Node 쪽. `cli.ts` 명령줄 도구, `table.ts` xlsx·csv 읽기
- `skills/autoladder/`: Claude Code용 스킬. `SKILL.md`(안내) + `cli.mjs`(빌드 결과, 커밋한다) + `examples/`(기준 공정의 프로젝트 파일, `npm test`가 다시 쓴다). 이 폴더만 복사하면 다른 PC에서도 쓴다. 프로젝트 파일 형식을 바꾸면 SKILL.md도 고치고 `npm run install:skill`
- `tests/`: `sim.ts`는 테스트 전용 스캔 해석기, `fixtures/`는 GX Works2 샘플 CSV와 기준 공정

## 지킬 것

- **LLM(Claude Code)은 프로젝트 파일을 쓰는 데까지만 관여한다.** 프로젝트 파일 이후(생성·검증·내보내기)는 같은 입력에 항상 같은 출력이어야 한다. 도구 안에서 Claude를 부르지 않는다
- **CSV 형식은 `tests/fixtures/`의 GX Works2 샘플이 기준이다.** 샘플에 없는 명령을 새로 쓰려면 그 명령이 든 샘플을 사용자에게 받아 바이트 일치 테스트를 먼저 추가한다. 형식이나 스텝 수를 추측해서 넣지 않는다
- 프로그램 CSV는 UTF-16 LE + BOM, 탭, CRLF. 코멘트 CSV는 줄바꿈이 LF다
- 출력 코일(OUT)은 디바이스당 한 번만. 한 스캔에 한 단계만 진행 (전이 판정 블록과 단계 갱신 블록 분리)
- 디바이스 코멘트는 최대 3행×8칸(한글 2칸), 전문 용어 대신 쉬운 말로 쓴다
- 사용자가 주지 않은 I/O 주소·수치는 만들지 않는다. 테스트용 가정값은 가정이라고 적는다
- 생성 로직을 바꾸면 `tests/sim.ts`로 동작 테스트를 붙인다. 최종 확인은 사용자가 GX Works2 시뮬레이터와 PlcTwin에서 한다

## 외부 폴더

- 이 저장소와 같은 상위 폴더의 `plc_twin`: 사용자의 MPS 디지털 트윈(PlcTwin). **읽기만 하고 수정하지 않는다.** 실행과 Connect는 사용자가 하며 시뮬레이터에만 연결한다. 입출력은 D 워드 비트(앱이 D0~D3·D40~D44에 쓰고, 래더는 D100~D103·D140~D146에 쓴다)

## 작업 방식

- 단계(M)를 끝내거나 중요한 결정을 하면 `docs/devlog.md`에 기록을 추가한다 (문제, 결정, 이유, 결과. 지어낸 수치 금지)
- 사용자 확인 관문(GX Works2 불러오기, PlcTwin 동작)은 건너뛰지 않는다
- 커밋은 사용자가 요청할 때만 한다
