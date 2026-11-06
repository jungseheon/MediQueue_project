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
npm run db:push
~~~

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

---

## GitHUB 협업 규칙
모든 작업은 main 브랜치에 직접 푸시하지 않고, 기능별 브랜치를 파서 Pull Request(PR)로 진행

1. 최신 main 코드 받기
~~~
git checkout main
git pull origin main
~~~

2. 새로운 기능 브랜치 생성 및 이동
~~~
git checkout -b feat/기능이름 (예: feat/login, feat/dashboard)
~~~

3. 코드 작업 후 커밋
~~~
git add .
git commit -m "feat: 구현한 기능 설명"
~~~

4. 본인의 기능 브랜치로 푸시
~~~
git push origin feat/기능이름
~~~

5. GitHub 웹페이지 접속하여 main 브랜치로 Pull Request (PR) 작성
   -> 본인 제외 1인 리뷰 후 Merge 진행

---

## API

### 1. API 요약

| Method | Path | 설명 |
| --- | --- | --- |
| GET | `/health` | 서버 및 PostgreSQL DB 연결 상태 확인 (성공 시 `200`, 실패 시 `503`) |
| GET | `/api/appointments` | 예약 목록 조회 (`doctorId`, `patientId`, `status` 필터링 지원) |
| GET | `/api/appointments/:id` | 특정 예약 상세 조회 |
| POST | `/api/appointments` | 신규 예약 생성 |
| PATCH | `/api/appointments/:id` | 예약 일시, 담당 의사, 환자, 상태 수정 |
| DELETE | `/api/appointments/:id` | 예약 취소 (DB 행 삭제 대신 상태를 `cancelled`로 변경) |
| POST | `/api/appointments/:id/check-in` | **예약 환자 현장 체크인**. 당일 순번(`queuePosition`: 1, 2, 3...)을 부여하고 대기열(`QueueEntry`) 등록 |
| GET | `/api/doctors/:doctorId/queue` | 특정 의사의 실시간 대기열 목록 및 EWMA 기반 예상 시작 시각·대기·지연시간 조회 |
| PATCH | `/api/queue-entries/:id/status` | 대기열 상태 변경 (`in_progress`, `completed` 등). 진료 완료 시 실제 소요시간 기반 EWMA 및 전체 대기시간 자동 재계산 |

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

---

#### [예약] 예약 목록 조회
- **Path**: `GET /api/appointments`
- **Query Parameters (선택)**:
  - `doctorId`: 의사 ID (정수)
  - `patientId`: 환자 ID (정수)
  - `status`: `booked` 또는 `cancelled`
- **요청 예시**:
  ```sh
  curl -i 'http://localhost:3000/api/appointments?doctorId=1&status=booked'
  ```

---

#### [예약] 예약 생성
- **Path**: `POST /api/appointments`
- **Request Body (JSON)**:
  - `doctorId` (string | number, 필수): 의사 ID
  - `patientId` (string | number, 필수): 환자 ID
  - `scheduledAt` (ISO 8601 string, 필수): 예약 일시
- **요청 예시**:
  ```sh
  curl -i -X POST http://localhost:3000/api/appointments \
    -H 'Content-Type: application/json' \
    --data '{"doctorId":"1","patientId":"1","scheduledAt":"2026-11-10T09:30:00+09:00"}'
  ```

---

#### [예약] 예약 수정 및 취소
- **예약 수정**: `PATCH /api/appointments/:id`
  ```sh
  curl -i -X PATCH http://localhost:3000/api/appointments/1 \
    -H 'Content-Type: application/json' \
    --data '{"scheduledAt":"2026-11-10T10:00:00+09:00"}'
  ```
- **예약 취소**: `DELETE /api/appointments/:id`
  - 이미 체크인되어 활성화된 대기표가 있는 예약은 취소할 수 없습니다(`409 Conflict`).
  ```sh
  curl -i -X DELETE http://localhost:3000/api/appointments/1
  ```

---

#### [체크인] 예약 환자 현장 도착 접수
- **Path**: `POST /api/appointments/:id/check-in`
- **설명**: 
  - 예약한 환자가 병원에 도착했을 때 호출합니다. (현장 신규 접수가 아닌 **사전 예약 환자의 도착 확인**)
  - 해당 진료실(의사)의 당일 체크인 이력을 확인하여 **당일 순번(`queuePosition`)을 1, 2, 3... 순서대로 부여**합니다.
  - 대기열(`queue_entries`)에 상태를 `checked_in`으로 등록하고 도착 시각(`checkedInAt`)을 기록합니다.
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
        "doctor": { "id": "1", "displayName": "김의사", "department": "내과 1진료실" },
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
  - 특정 의사의 현재 대기열(`checked_in`, `called`)을 조회합니다.
  - 현재 진료 중인 환자(`in_progress`)의 시작 시각 및 의사의 EWMA 평균 진료 시간을 반영하여 **각 대기 환자의 예상 시작 시각(`estimatedStartTime`), 남은 대기 시간(`estimatedWaitMinutes`), 지연 시간(`delayMinutes`)**을 반환합니다.
- **요청 예시**:
  ```sh
  curl -i http://localhost:3000/api/doctors/1/queue
  ```
- **성공 응답 (`200 OK`)**:
  ```json
  {
    "data": {
      "doctor": { "id": "1", "displayName": "김의사", "department": "내과 1진료실" },
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

#### [대기열] 진료 상태 변경 및 EWMA 자동 재계산
- **Path**: `PATCH /api/queue-entries/:id/status`
- **설명**: 
  - 환자의 대기 상태를 변경합니다. (`called`, `in_progress`, `completed`, `no_show` 등)
  - **`in_progress` (진료 시작)**: 진료 시작 시각(`startedAt`)을 기록합니다.
  - **`completed` (진료 완료)**: 
    1. 진료 완료 시각(`completedAt`)을 기록하고 실제 진료 소요 시간을 계산합니다.
    2. EWMA(지수 가중 이동 평균) 알고리즘으로 의사의 새로운 평균 진료시간을 산출하여 DB(`service_time_stats`)에 갱신합니다.
    3. 남은 대기자들의 예상 대기 시간과 지연 여부를 즉시 전체 재계산하여 반환합니다.
- **요청 예시**:
  ```sh
  # 1. 진료실 입장 및 진료 시작
  curl -i -X PATCH http://localhost:3000/api/queue-entries/1/status \
    -H 'Content-Type: application/json' \
    --data '{"status":"in_progress"}'

  # 2. 진료 완료 (소요시간 계산 -> EWMA 및 남은 대기자 대기시간 자동 재계산)
  curl -i -X PATCH http://localhost:3000/api/queue-entries/1/status \
    -H 'Content-Type: application/json' \
    --data '{"status":"completed"}'
  ```

---

### 3. 공통 규칙 및 상태 코드
- **데이터 형식**: 모든 요청 및 응답 본문은 JSON(`application/json`) 형식입니다.
- **ID 포맷**: 요청 시 ID는 정수 또는 숫자 문자열로 전송 가능하며, 응답 시 안전한 BigInt 처리를 위해 문자열로 반환됩니다.
- **상태 코드**:
  - `200 OK`: 요청 성공
  - `201 Created`: 자원 생성 성공 (예약 생성 등)
  - `400 Bad Request`: 필수 필드 누락, 유효하지 않은 날짜/ID 형식, 허용되지 않은 상태 값 전달
  - `404 Not Found`: 대상 예약, 의사, 대기열 항목이 존재하지 않음
  - `409 Conflict`: 이미 체크인된 예약, 취소된 예약에 대한 작업, 활성 대기열이 있는 예약 취소 시도 등 비즈니스 충돌
  - `500 Internal Server Error`: 서버 내부 오류
  - `503 Service Unavailable`: PostgreSQL 데이터베이스 연결 실패 (`/health`)
