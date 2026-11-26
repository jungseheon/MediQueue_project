# MediQueue

실시간 예상 대기 시간 안내 기반 병원 예약 관리 시스템

> 숭실대 오픈소스기반기초설계 7조
> 정세헌(jungseheon) · 임지수(jisuyim) · 양윤서(yunseo4002) · 김태연(taetaeris)

## 주요 기능

- EWMA(지수 가중 이동 평균)로 의사별 진료 소요 시간을 보정한 예상 대기 시간
- 실제 진료 진행 상태와 환자별 지연을 반영한 대기 시간 재계산
- 예약·체크인·호출·부재·복귀 대기열 관리
- 의사별 알고리즘 설정(초진·재진 기본시간, 준비시간, EWMA 비율, 지연 알림 기준)
- SSE로 대기열 변경 실시간 전송
- 환자용 화면: 의사 목록 기반 병원 검색·예약·변경·취소, 본인 대기 순번·예상 진료 시각·호출 안내 (30초마다 자동 갱신)

## 기술 스택

| 구분 | 사용 기술 |
| --- | --- |
| 백엔드 | Node.js, TypeScript, Express 5 |
| 데이터베이스 | PostgreSQL 17 (Docker), Prisma 7 (`@prisma/adapter-pg`) |
| 프론트엔드 | 빌드 없는 HTML·CSS·JavaScript (환자용 시연 화면, 병원용 화면) |
| 개발·테스트 | tsx, tsc, Vitest, supertest |

## 폴더 구조

~~~
src/            API 서버 (routes, services, utils, errors)
prisma/         스키마와 migration
tests/          백엔드 단위·통합 테스트 (Vitest)
frontend/       환자용 화면 (frontend/README.md 참고)
frontend/hospital/  병원용 화면: 대기열 대시보드, 예약 관리, 예측 알고리즘 설정 (frontend/hospital/README.md 참고)
docs/           API 명세(api.md), 테이블 정의(entities.md)
dump.sql        개발용 샘플 데이터 (데이터 전용)
~~~

## 실행 방법

### 1. 환경 변수 설정

~~~sh
cp .env.example .env   # 이후 .env의 비밀번호(USER_PASSWORD)를 바꾼다
~~~

`.env`에는 비밀번호가 들어 있으므로 Git에 커밋하지 않는다.

### 2. 의존성 설치 및 데이터베이스 준비

~~~sh
npm install
npx prisma generate     # Prisma Client 생성 (설치 후·스키마 변경 후)
docker compose up -d db
npm run db:migrate
docker exec -i mediqueue-db sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB' < dump.sql   # 선택: 샘플 데이터
~~~

`dump.sql`은 스키마 없이 데이터만 담고 있으므로 migration을 적용한 빈 DB에 한 번만 복원한다.

### 3. 서버 실행

~~~sh
npm run dev           # API 서버 http://localhost:3000
npm run dev:patient   # 환자용 화면 http://localhost:5173
curl http://localhost:3000/health   # DB 연결 확인
~~~

병원용 화면은 API 서버를 켠 뒤 `frontend/hospital/dashboard.html`(대기열 대시보드), `frontend/hospital/appointments.html`(예약 관리), `frontend/hospital/settings.html`(예측 알고리즘 설정)을 브라우저로 연다.

빌드 후 실행은 `npm run build && npm start`. 종료는 `Ctrl+C`, DB 컨테이너는 `docker compose stop db`.

### 4. 테스트

~~~sh
npm test               # 백엔드 단위·통합 테스트 (DB 컨테이너 필요, 테스트용 mq_test DB를 만들고 지움)
npm run test:patient   # 환자용 화면 테스트
~~~

## 스키마 변경

스키마는 `prisma/migrations`의 migration으로만 만든다(`prisma db push`는 사용하지 않는다).

1. `prisma/schema.prisma` 수정
2. `npm run db:migrate:dev -- --name 변경내용`으로 migration 생성
3. 생성된 migration 폴더를 함께 커밋하고, [테이블 정의](docs/entities.md)도 고친다

`npx prisma migrate status`가 "Database schema is up to date!"를 출력하면 DB가 최신이다.

로컬 DB의 migration 이력이 맞지 않으면 DB를 다시 만든다. **기존 데이터는 모두 지워진다.**

~~~sh
docker exec mediqueue-db sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"'
npm run db:migrate
docker exec -i mediqueue-db sh -c 'psql -U $POSTGRES_USER -d $POSTGRES_DB' < dump.sql
~~~

## API

요청·응답과 동작의 기준 문서는 [API 명세](docs/api.md)다.

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/health` | 서버 및 DB 연결 상태 확인 |
| GET | `/api/appointments` | 예약 목록 조회 (`doctorId`, `patientId`, `status` 필터) |
| GET | `/api/appointments/:id` | 예약 상세 조회 |
| POST | `/api/appointments` | 예약 생성 |
| PATCH | `/api/appointments/:id` | 예약 일시·의사·환자·상태 수정 |
| DELETE | `/api/appointments/:id` | 예약 취소 (`cancelled`로 변경) |
| POST | `/api/appointments/:id/check-in` | 체크인, 대기 순번 발급 |
| GET | `/api/appointments/:id/wait` | 환자 본인의 대기 순번·예상 대기시간 (다른 환자 정보 제외) |
| GET | `/api/doctors/:doctorId/queue` | 의사별 대기열과 예상 시작·대기·지연 시간 |
| GET | `/api/doctors/:doctorId/stream` | 의사별 대기열 변경 실시간 구독 (SSE) |
| PATCH | `/api/queue-entries/:id/status` | 대기 상태 변경, 진료 완료 시 EWMA 갱신 |
| POST | `/api/queue-entries/:id/call` | 환자 호출 |
| POST | `/api/queue-entries/:id/disappear` | 호출 후 부재 처리, 순번 미루기 |
| POST | `/api/queue-entries/:id/return` | 부재 환자 대기열 복귀 |
| GET | `/api/algorithm-config/:doctorId` | 의사별 알고리즘 설정 조회 |
| PUT | `/api/algorithm-config/:doctorId` | 의사별 알고리즘 설정 저장 |
| GET·POST | `/api/doctors` | 의사 목록 조회 (`department` 필터)·등록 |
| GET·PATCH·DELETE | `/api/doctors/:id` | 의사 상세 조회·수정·삭제 (예약이 있으면 삭제 불가) |
| GET·POST | `/api/patients` | 환자 목록 조회 (`name` 검색)·등록 |
| GET·PATCH·DELETE | `/api/patients/:id` | 환자 상세 조회·수정·삭제 (예약이 있으면 삭제 불가) |

## GitHub 협업 규칙

`main`에 직접 푸시하지 않고, 기능별 브랜치에서 작업한 뒤 Pull Request로 머지한다.

~~~sh
git checkout main && git pull origin main   # 1. 최신 main 받기
git checkout -b feat/기능이름               # 2. 기능 브랜치 생성 (예: feat/login)
git add . && git commit -m "feat: 구현한 기능 설명"   # 3. 커밋
git push origin feat/기능이름               # 4. 푸시
~~~

5. GitHub에서 `main`으로 Pull Request를 만들고, 본인 외 1명의 리뷰를 받은 뒤 머지한다.
