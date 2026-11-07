# MediQueue_Project
실시간 예상 대기 시간 안내 기반 병원 예약 관리 시스템

## 주요 기능
- EWMA(지수 가중 이동 평균) 방식에 따른 진료 소요 시간에 대한 동적 보정한 대기 시간 제공
- 실제 진료 진행 상태 반영한 대기 시간 제공
- 개인별 진료 지연 반영한 대기시간 제공
- 실시간 알림 제공

> 숭실대 오픈소스기반기초설계 7조
> **팀원**
> 정세헌(jungseheon)
> 임지수(jisuyim)
> 양윤서(yunseo4002)
> 김태연(taetaeris)

## 기술 스택
- 런타임·언어: Node.js, TypeScript
- 프론트엔드: 
- 백엔드: Express 5 기반 REST API
- 데이터베이스: PostgreSQL
- ORM·DB 연결: Prisma 7, @prisma/adapter-pg, pg
- 개발·빌드: tsx (개발 서버 실행), tsc (빌드)
- 기타: dotenv (환경변수 관리), cors (CORS 처리)

## 실행 방법
### 1. 환경 변수 설정
~~~bash
cp .env.example .env
//이후 .env에서 PASSWORD 변경
~~~
.env 파일에는 비밀번호가 포홤되므로 Git에 커밋하지 않는다.

### 2. 의존성 설치 및 데이터베이스 실행
~~~sh
npm install
docker compose up -d db
~~~

### 3. 데이터베이스 스키마 반영
~~~sh
npm run db:migrate
~~~

새 데이터베이스는 tracked migration들을 순서대로 적용하여 생성한다. 기존 DB를 이 프로젝트의 migration 관리로 옮기는 경우에는 아래의 [기존 데이터베이스 배포 절차](#기존-데이터베이스-배포)를 먼저 따른다. 배포 환경에서는 `prisma db push`를 사용하지 않는다.

### 4. 개발 서버 실행
~~~sh
npm run dev
~~~
서버는 기본적으로 http://localhost:3000 에서 실행된다.

#### DB연결 확인
~~~sh
curl http://localhost:3000/health
~~~

### 5. 종료
- 개발 서버 종료: 실행 중인 터미널에서 'Ctrl+C'
- PostgreSQL 컨테이너:
~~~sh
docker compose stop db
~~~

### 6. 프로젝트 빌드 및 실행
~~~sh
npm run build
npm start
~~~
cf. 현재 'npm test'는 테스트 러너가 설정되어있지 않아 "테스트 미지정 오류" 발생한다.

### 기존 데이터베이스 배포

배포 전 DB 백업을 만들고 복구 가능한지 확인한다. 애플리케이션 인스턴스를 중지하거나 쓰기를 막은 뒤, 기존 스키마를 사용하는 DB에서 **최초 1회만** baseline을 기록하고 이후 migration을 적용한다.

~~~sh
npx prisma migrate resolve --applied 20261025160000_baseline
npm run db:migrate
~~~

`migrate resolve`는 이미 존재하는 테이블을 다시 만들지 않고 해당 스키마가 baseline 상태라고 migration 이력에 기록한다. 현재 코드는 그 다음 migration으로 `called_at`, 새 대기 상태와 서비스 종류 enum을 반영한다. 신규 DB에는 baseline을 `resolve`하지 말고 `npm run db:migrate`만 실행한다.

`npx prisma migrate status`로 적용 상태를 확인하고, `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`가 차이 없음을 확인한 뒤 새 애플리케이션 버전을 배포한다. migration 적용이 실패하면 새 애플리케이션 버전을 배포하지 말고, 오류를 해결한 후 `npm run db:migrate`를 다시 실행한다. 기존 데이터의 내용 변경이 포함되는 migration은 자동 롤백하지 않는다. 롤백이 필요하면 애플리케이션 버전을 이전 버전으로 되돌리고, 스키마를 되돌려야 하는 경우 백업을 복원한다.

---

## GitHUB 협업 규칙
모든 작업은 main 브랜치에 직접 푸시하지 않고, 기능별 브랜치를 파서 Pull Request(PR)로 진행

1. 최신 main 코드 받기
~~~sh
git checkout main
git pull origin main
~~~

2. 새로운 기능 브랜치 생성 및 이동
~~~sh
git checkout -b feat/기능이름 (예: feat/login, feat/dashboard)
~~~

3. 코드 작업 후 커밋
~~~sh
git add .
git commit -m "feat: 구현한 기능 설명"
~~~

4. 본인의 기능 브랜치로 푸시
~~~sh
git push origin feat/기능이름
~~~

5. GitHub 웹페이지 접속하여 main 브랜치로 Pull Request (PR) 작성
   -> 본인 제외 1인 리뷰 후 Merge 진행

---

## API

전체 API 요청·응답과 동작에 대한 기준 문서는 [API 명세](참고/API설명.md)를 참고하세요.

모든 API의 기본 주소는 `http://localhost:3000`이며, 별도로 표시하지 않는 한 JSON 응답을 사용합니다. 현재 제공하는 API는 아래와 같습니다. 의사·환자 등록/수정 API는 제공하지 않습니다.

### 1. API 요약

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/health` | 서버 및 PostgreSQL DB 연결 상태 확인 (성공 시 `200`, 실패 시 `503`) |
| GET | `/api/appointments` | 예약 목록 조회 (`doctorId`, `patientId`, `status` 필터링 지원) |
| GET | `/api/appointments/:id` | 특정 예약 상세 조회 |
| POST | `/api/appointments` | 신규 예약 생성 |
| PATCH | `/api/appointments/:id` | 예약 일시, 담당 의사, 환자, 상태 수정 |
| DELETE | `/api/appointments/:id` | 예약 취소 (DB 행 삭제 대신 상태를 `cancelled`로 변경) |
| POST | `/api/appointments/:id/check-in` | 예약 환자 체크인, 대기 순번 발급 |
| POST | `/api/queue-entries/:id/call` | 환자 호출 시각 기록 및 안내 메시지 반환 |
| POST | `/api/queue-entries/:id/disappear` | 호출 후 부재 처리, 순번 조정 및 대기시간 재계산 |
| POST | `/api/queue-entries/:id/return` | 부재 환자를 대기 상태로 복귀 |
| GET | `/api/doctors/:doctorId/queue` | 특정 의사의 실시간 대기열 목록 및 EWMA 기반 예상 시작 시각·대기·지연시간 조회 |
| PATCH | `/api/queue-entries/:id/status` | 대기열 상태 변경 (`inprogress`, `completed` 등). 진료 완료 시 실제 소요시간 기반 EWMA 및 전체 대기시간 자동 재계산 |

---

### 2. 세부 API 명세 및 요청 예시

#### [시스템] 서버 및 DB 상태 확인
- **Path**: `GET /health`
- **설명**: API 서버 구동 및 PostgreSQL 연결 상태를 확인합니다.
- **요청 예시**:
  ```sh
  curl -i http://localhost:3000/health
  ```
- **성공 응답 (`200 OK`)**:
  ```json
  { "status": "ok", "database": "ok" }
  ```
- **실패 응답 (`503 Service Unavailable`)**:
  ```json
  { "status": "error", "database": "unavailable" }
  ```

---

#### [예약] 예약 목록 조회
- **Path**: `GET /api/appointments`
- **Query Parameters (선택)**:
  - `doctorId`: 의사 ID (정수)
  - `patientId`: 환자 ID (정수)
  - `status`: `booked` 또는 `cancelled`
- **동작**: 예약 시각 오름차순으로 반환합니다. 조회 전에 예약 시각 5분이 지난 미체크인 예약을 대기열 `no_show`로 처리합니다.
- **요청 예시**:
  ```sh
  curl -i 'http://localhost:3000/api/appointments?doctorId=1&status=booked'
  ```
- **응답**: `{ "data": [ ...예약 객체 ] }`. 각 객체에는 예약, 의사, 환자 정보와 `queueEntry`(없으면 `null`)가 포함됩니다. ID는 문자열이며 상태는 소문자입니다.

---

#### [예약] 예약 상세 조회
- **Path**: `GET /api/appointments/:id`
- **설명**: ID로 예약 한 건을 조회합니다. 결과에는 예약과 연결된 의사·환자·대기 항목이 포함됩니다.
- **요청 예시**:
  ```sh
  curl -i http://localhost:3000/api/appointments/1
  ```
- **응답**: `{ "data": { ...예약 객체 } }`. 해당 ID가 없으면 `404`입니다.

---

#### [예약] 예약 생성
- **Path**: `POST /api/appointments`
- **Request Body (JSON)**:
  - `doctorId` (string | number, 필수): 의사 ID
  - `patientId` (string | number, 필수): 환자 ID
  - `scheduledAt` (ISO 8601 string, 필수): 예약 일시
- 예약은 `booked` 상태로 생성됩니다. 생성 요청의 상태 필드는 사용하지 않습니다.
- **요청 예시**:
  ```sh
  curl -i -X POST http://localhost:3000/api/appointments \
    -H 'Content-Type: application/json' \
    --data '{"doctorId":"1","patientId":"1","scheduledAt":"2026-11-10T09:30:00+09:00"}'
  ```

---

#### [예약] 예약 수정 및 취소
- **예약 수정**: `PATCH /api/appointments/:id`. 다음 필드 중 하나 이상을 전달합니다.
  - `doctorId` (string | number): 담당 의사 ID
  - `patientId` (string | number): 환자 ID
  - `scheduledAt` (ISO 8601 string): 예약 일시
  - `status`: `booked` 또는 `cancelled`
  - 변경 필드가 없으면 `400`, 없는 예약 ID면 `404`입니다. 취소된 예약을 다시 `booked`로 되돌릴 수 없습니다. 대기 상태인 항목이 이미 활성화된 예약은 취소할 수 없으며 `409`를 반환합니다.
  ```sh
  curl -i -X PATCH http://localhost:3000/api/appointments/1 \
    -H 'Content-Type: application/json' \
    --data '{"scheduledAt":"2026-11-10T10:00:00+09:00"}'
  ```
- **예약 취소**: `DELETE /api/appointments/:id`
  - 예약을 삭제하지 않고 `cancelled`로 변경합니다. 이미 체크인되어 활성화된 대기표가 있으면 `409 Conflict`입니다.
  - 성공 시 `{ "data": { ...취소된 예약 객체 } }`를 반환합니다.
  ```sh
  curl -i -X DELETE http://localhost:3000/api/appointments/1
  ```

---

#### [체크인] 예약 환자 현장 도착 접수
- **Path**: `POST /api/appointments/:id/check-in`
- **설명**:
  - 예약한 환자가 병원에 도착했을 때 호출합니다. (현장 신규 접수가 아닌 **사전 예약 환자의 도착 확인**)
  - **예약 시간 초과 검증**: 예약 시각(`scheduledAt`) 5분 후까지 체크인하지 않으면 대기열 상태가 자동으로 **`no_show`**로 변경되고 체크인이 차단됩니다(`409 Conflict`). 예약 상태는 `booked`로 유지됩니다.
  - 정시 도착 체크인 시, 해당 진료실(의사)의 당일 체크인 이력을 확인하여 **당일 순번(`queuePosition`)을 1, 2, 3... 순서대로 부여**합니다.
  - 대기열(`queue_entries`)에 상태를 `checked_in`으로 등록하고 도착 시각(`checkedInAt`)을 기록합니다.
  - 체크인 가능 시각은 예약 시각까지입니다. 예약 시각 이후 5분이 지나 자동 `no_show`로 처리된 뒤에는 체크인할 수 없습니다.
- **요청 예시**:
  ```sh
  curl -i -X POST http://localhost:3000/api/appointments/1/check-in
  ```
- **성공 응답 (`200 OK`)**:
  ```json
  {
    "data": {
      "queueEntry": {
        "id": "1",
        "appointmentId": "1",
        "queuePosition": 1,
        "status": "checked_in",
        "checkedInAt": "2026-11-06T08:40:00.000Z"
      },
      "appointment": {
        "id": "1",
        "doctorId": "1",
        "patientId": "1",
        "scheduledAt": "2026-11-06T09:00:00.000Z",
        "status": "booked",
        "doctor": { "id": "1", "displayName": "김의사", "department": "내과" },
        "patient": { "id": "1", "displayName": "이환자" }
      }
    }
  }
  ```
- **오류 응답**:
  - `404`: 존재하지 않는 예약 ID
  - `409`: 취소된 예약이거나 이미 체크인된 예약

---

#### [대기열] 의사별 실시간 대기열 조회
- **Path**: `GET /api/doctors/:doctorId/queue`
- **설명**: 
  - 특정 의사의 현재 대기열(`checked_in`, `disappeared`)을 조회합니다.
  - 현재 진료 중인 환자(`inprogress`)의 시작 시각 및 초진·재진별 EWMA 평균 진료 시간을 반영하여 **각 대기 환자의 예상 시작 시각(`estimatedStartTime`), 남은 대기 시간(`estimatedWaitMinutes`), 지연 시간(`delayMinutes`)**을 반환합니다.
  - 조회 시 전역 예약 노쇼 처리를 먼저 실행합니다. 대기 목록에는 `checked_in`, `disappeared` 상태가 포함되며, 진료 중 환자는 대기 목록과 별도로 예상 시간 계산에 반영됩니다.
  - 의사 ID가 없으면 `404`를 반환합니다. 진료시간 통계가 없으면 초진 12분, 재진 8분 기본값을 사용합니다.
- **요청 예시**:
  ```sh
  curl -i http://localhost:3000/api/doctors/1/queue
  ```
- **성공 응답 (`200 OK`)**:
  ```json
  {
    "data": {
      "doctor": { "id": "1", "displayName": "김의사", "department": "내과" },
      "generatedAt": "2026-11-06T08:45:00.000Z",
      "queue": [
        {
          "id": "1",
          "appointmentId": "1",
          "patientId": "1",
          "queuePosition": 1,
          "status": "checked_in",
          "isFirstVisit": false,
          "scheduledAt": "2026-11-06T09:00:00.000Z",
          "estimatedStartTime": "2026-11-06T09:00:00.000Z",
          "estimatedWaitMinutes": 15,
          "delayMinutes": 0
        }
      ]
    }
  }
  ```

---

#### [대기열] 상태 변경 및 진료 완료 통계 갱신
- **Path**: `PATCH /api/queue-entries/:id/status`
- **Request Body**:
  ```json
  { "status": "inprogress" }
  ```
- **설명**: 
  - 대기 항목의 상태를 다음 중 하나로 지정합니다: `booked`, `checked_in`, `cancelled`, `disappeared`, `inprogress`, `completed`, `no_show`.
  - 이 API는 요청한 상태를 직접 저장하며, 상태 간 전이 순서를 검증하지 않습니다. 보통 호출 시 부재는 `/disappear`, 자리 복귀는 `/return`을 사용합니다.
  - **`inprogress` (진료 시작)**: 진료 시작 시각(`startedAt`)을 기록합니다.
  - **`completed` (진료 완료)**: 
    1. 완료 시각을 기록하고, 시작 시각부터 실제 소요 시간을 계산합니다.
    2. 과거 완료 이력이 있는 환자는 재진, 없으면 초진으로 분류해 해당 종류의 EWMA 통계를 갱신합니다.
    3. 남은 대기자들의 예상 시간을 계산해 반환합니다.
  - 성공 응답은 갱신한 `updatedEntry`, 완료가 아닌 경우 `null`인 `updatedEWMA`, 그리고 `recalculatedQueue`를 포함합니다.
- **요청 예시**:
  ```sh
  # 1. 진료실 입장 및 진료 시작
  curl -i -X PATCH http://localhost:3000/api/queue-entries/1/status \
    -H 'Content-Type: application/json' \
    --data '{"status":"inprogress"}'

  # 2. 진료 완료 (소요시간 계산 -> EWMA 및 남은 대기자 대기시간 자동 재계산)
  curl -i -X PATCH http://localhost:3000/api/queue-entries/1/status \
    -H 'Content-Type: application/json' \
    --data '{"status":"completed"}'
  ```

---

#### [호출] 환자 진료실 호출
- **Path**: `POST /api/queue-entries/:id/call`
- **설명**: 
  - `checked_in` 또는 `disappeared` 상태 환자를 호출할 수 있습니다. 호출 시 `called_at`에 현재 시각을 기록하며, 대기 상태는 그대로 유지됩니다.
  - 응답에는 갱신된 대기 항목과 안내용 `callMessage`가 포함됩니다. 그 외 상태인 경우 `409`입니다.
- **요청 예시**:
  ```sh
  curl -i -X POST http://localhost:3000/api/queue-entries/1/call
  ```
- **성공 응답 (`200 OK`)**:
  ```json
  {
    "data": {
      "queueEntry": {
        "id": "1",
        "appointmentId": "1",
        "queuePosition": 1,
        "status": "checked_in"
      },
      "callMessage": "이환자님, 내과 1진료실 (김의사 의사실)로 들어오세요."
    }
  }
  ```

---

#### [부재 처리] 호출 시 부재(자리비움) 처리 및 순번 미루기 (Disappear)
- **Path**: `POST /api/queue-entries/:id/disappear`
- **Request Body (선택)**:
  ```json
  { "delayPositions": 2 }
  ```
- **설명**: 
  - `called_at`이 기록된 `checked_in` 또는 `disappeared` 항목만 처리할 수 있습니다. 호출하지 않은 환자는 `409`입니다.
  - `delayPositions`는 뒤로 미룰 칸 수이며 기본값은 2, 유효 범위는 1~10입니다. 뒤에 대기 환자가 없으면 순번을 유지합니다.
  - 항목 상태를 `disappeared`로 바꾸고 사이에 있던 환자를 앞으로 당깁니다. 응답에 처리 결과와 남은 대기시간 재계산 결과가 포함됩니다.
  - 현재 구현은 부재 횟수를 저장하거나 일정 횟수 후 자동으로 `no_show`로 바꾸지 않습니다.
- **요청 예시 (순번 2칸 뒤로 미루기)**:
  ```sh
  curl -i -X POST http://localhost:3000/api/queue-entries/1/disappear \
    -H 'Content-Type: application/json' \
    --data '{"delayPositions": 2}'
  ```

---

#### [대기 복귀] 자리비움 환자 대기열 복귀 (Return)
- **Path**: `POST /api/queue-entries/:id/return`
- **설명**:
  - `disappeared` 상태 항목을 `checked_in`으로 바꾸고, 연기된 순번을 유지합니다.
  - 호출 시각(`called_at`)을 초기화합니다. `disappeared`가 아닌 상태면 `409`입니다.
  - 응답에는 환자 안내 메시지와 갱신된 대기 항목이 포함됩니다.
- **요청 예시**:
  ```sh
  curl -i -X POST http://localhost:3000/api/queue-entries/1/return
  ```

---

### 3. 공통 규칙 및 상태 코드
- **데이터 형식**: 모든 요청 및 응답 본문은 JSON(`application/json`) 형식입니다.
- **ID 포맷**: 요청 시 ID는 정수 또는 숫자 문자열로 전송 가능하며, 응답 시 안전한 BigInt 처리를 위해 문자열로 반환됩니다.
- **날짜 형식**: 날짜/시간 입력은 ISO 8601 문자열이어야 합니다. 예: `2026-11-10T09:30:00+09:00`.
- **예약 노쇼 자동 처리**: 서버 시작 시와 이후 30초 간격으로, 예약 시각이 5분 이상 지났고 아직 체크인하지 않은 예약을 `queue_entries.status = no_show`로 처리합니다. 예약 상태는 `booked`로 유지됩니다. 예약 목록·의사별 대기열·체크인 API도 처리기를 호출합니다.
- **공통 오류 응답 형식**: 대부분의 API 오류는 `{ "error": "오류 설명" }` 형태입니다.
- **상태 코드**:
  - `200 OK`: 요청 성공
  - `201 Created`: 자원 생성 성공 (예약 생성 등)
  - `400 Bad Request`: 필수 필드 누락, 유효하지 않은 날짜/ID 형식, 허용되지 않은 상태 값 전달
  - `404 Not Found`: 대상 예약, 의사, 대기열 항목이 존재하지 않음
  - `409 Conflict`: 이미 체크인된 예약, 취소된 예약에 대한 작업, 활성 대기열이 있는 예약 취소 시도 등 비즈니스 충돌
  - `500 Internal Server Error`: 서버 내부 오류
  - `503 Service Unavailable`: PostgreSQL 데이터베이스 연결 실패 (`/health`)
