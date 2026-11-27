# MediQueue API 명세

## 1. 공통 정보

- 기본 주소: `http://localhost:3000`
- 요청 본문은 JSON이며, JSON 본문을 보내는 요청은 `Content-Type: application/json` 헤더를 사용합니다.
- 시간 입력은 ISO 8601 문자열이어야 합니다. 예: `2026-11-10T09:30:00+09:00`.
- ID 입력은 양의 정수 또는 숫자 문자열입니다. 응답의 BigInt ID는 문자열로 반환됩니다.
- 예약 상태는 `booked`, `cancelled`입니다.
- 대기열 상태는 `booked`, `checked_in`, `cancelled`, `disappeared`, `in_progress`, `completed`, `no_show`입니다. `called`는 대기열 상태가 아니며, 호출 시각을 `called_at`에 기록합니다.
- 예약 조회 결과의 상태 문자열은 소문자로 반환됩니다.
- 일반적인 오류 응답 형식은 `{ "error": "오류 설명" }`입니다.

## 2. API 목록

| Method | Path | 기능 |
|---|---|---|
| GET | `/health` | 서버와 PostgreSQL 연결 확인 |
| GET | `/api/appointments` | 예약 목록 조회 및 미방문 예약 노쇼 처리 |
| GET | `/api/appointments/:id` | 예약 상세 조회 |
| POST | `/api/appointments` | 예약 생성 |
| PATCH | `/api/appointments/:id` | 예약 정보 또는 상태 수정 |
| DELETE | `/api/appointments/:id` | 예약 취소 |
| POST | `/api/appointments/:id/check-in` | 예약 환자 체크인 및 대기 순번 발급 |
| GET | `/api/appointments/:id/wait` | 환자 본인의 대기 순번·예상 대기시간 조회 |
| GET | `/api/doctors/:doctorId/queue` | 의사별 대기열 및 예상 대기시간 조회 |
| GET | `/api/doctors/:doctorId/stream` | 의사별 대기열 변경 실시간 구독 (SSE) |
| PATCH | `/api/queue-entries/:id/status` | 대기열 상태 변경 및 완료 통계 갱신 |
| POST | `/api/queue-entries/:id/call` | 환자 호출 기록 및 안내 메시지 반환 |
| POST | `/api/queue-entries/:id/disappear` | 호출 후 부재 처리 및 순번 조정 |
| POST | `/api/queue-entries/:id/return` | 부재 환자를 대기열로 복귀 |
| GET | `/api/algorithm-config/:doctorId` | 의사별 알고리즘 설정 조회 |
| PUT | `/api/algorithm-config/:doctorId` | 의사별 알고리즘 설정 저장 |
| GET | `/api/doctors` | 의사 목록 조회 (`department` 필터) |
| GET | `/api/doctors/:id` | 의사 상세 조회 |
| POST | `/api/doctors` | 의사 등록 |
| PATCH | `/api/doctors/:id` | 의사 정보 수정 |
| DELETE | `/api/doctors/:id` | 의사 삭제 (예약이 없을 때만) |
| GET | `/api/doctors/:id/service-time-stats` | 의사별 초진·재진 EWMA(현재 예상 진료시간) 조회 |
| GET | `/api/patients` | 환자 목록 조회 (`name` 검색) |
| GET | `/api/patients/:id` | 환자 상세 조회 |
| POST | `/api/patients` | 환자 등록 |
| PATCH | `/api/patients/:id` | 환자 이름 수정 |
| DELETE | `/api/patients/:id` | 환자 삭제 (예약이 없을 때만) |

## 3. 상세 API 명세

### 3.1 서버 및 데이터베이스 상태 확인

`GET /health`

서버와 데이터베이스 연결 상태를 확인합니다.

```sh
curl -i http://localhost:3000/health
```

성공 응답 (`200 OK`):

```json
{ "status": "ok", "database": "ok" }
```

데이터베이스 연결 실패 응답 (`503 Service Unavailable`):

```json
{ "status": "error", "database": "unavailable" }
```

### 3.2 예약 목록 조회

`GET /api/appointments`

예약을 예약 시각 오름차순으로 조회합니다. 다음 선택적 query parameter로 필터링할 수 있습니다.

| Parameter | 설명 |
|---|---|
| `doctorId` | 의사 ID |
| `patientId` | 환자 ID |
| `status` | `booked` 또는 `cancelled` |

조회 전에 예약 시각으로부터 5분 이상 지났고 아직 체크인하지 않은 예약을 대기열 `no_show`로 처리합니다.

```sh
curl -i 'http://localhost:3000/api/appointments?doctorId=1&status=booked'
```

응답은 `{ "data": [ ... ] }` 형태입니다. 각 예약 객체에는 예약 정보와 연결된 `doctor`, `patient`, `queueEntry`가 포함되며, 대기 항목이 없으면 `queueEntry`는 `null`입니다.

```json
{
  "data": [
    {
      "id": "1",
      "doctorId": "1",
      "patientId": "1",
      "scheduledAt": "2026-11-10T00:30:00.000Z",
      "status": "booked",
      "doctor": { "id": "1", "displayName": "김의사", "department": "내과" },
      "patient": { "id": "1", "displayName": "이환자" },
      "queueEntry": null
    }
  ]
}
```

잘못된 ID 또는 상태 필터는 `400 Bad Request`입니다.

### 3.3 예약 상세 조회

`GET /api/appointments/:id`

ID에 해당하는 예약 하나를 조회하며 `doctor`, `patient`, `queueEntry`를 함께 반환합니다. 조회 전에 노쇼 처리가 실행됩니다.

```sh
curl -i http://localhost:3000/api/appointments/1
```

성공 응답은 `{ "data": { ...예약 객체 } }` 형식입니다. 예약을 찾지 못하면 `404 Not Found`입니다.

### 3.4 예약 생성

`POST /api/appointments`

필수 JSON 필드:

| Field | Type | 설명 |
|---|---|---|
| `doctorId` | 양의 정수 또는 숫자 문자열 | 기존 의사의 ID |
| `patientId` | 양의 정수 또는 숫자 문자열 | 기존 환자의 ID |
| `scheduledAt` | ISO 8601 문자열 | 예약 일시 |

새 예약은 `booked` 상태로 생성됩니다. `status`는 요청에서 지정하지 않습니다.

```sh
curl -i -X POST http://localhost:3000/api/appointments \
  -H 'Content-Type: application/json' \
  --data '{"doctorId":"1","patientId":"1","scheduledAt":"2026-11-10T09:30:00+09:00"}'
```

성공 시 `201 Created`와 `{ "data": { ...예약 객체 } }`를 반환합니다. 존재하지 않는 의사 또는 환자 ID는 `400 Bad Request`, 유효하지 않은 필드 형식도 `400`입니다.

### 3.5 예약 수정

`PATCH /api/appointments/:id`

아래 필드 중 하나 이상을 JSON으로 전달합니다. 전달하지 않은 필드는 바뀌지 않습니다.

| Field | Type | 설명 |
|---|---|---|
| `doctorId` | 양의 정수 또는 숫자 문자열 | 담당 의사 ID |
| `patientId` | 양의 정수 또는 숫자 문자열 | 환자 ID |
| `scheduledAt` | ISO 8601 문자열 | 예약 일시 |
| `status` | 문자열 | `booked` 또는 `cancelled` |

```sh
curl -i -X PATCH http://localhost:3000/api/appointments/1 \
  -H 'Content-Type: application/json' \
  --data '{"scheduledAt":"2026-11-10T10:00:00+09:00"}'
```

성공 시 `{ "data": { ...수정된 예약 객체 } }`를 반환합니다. 본문에 수정할 필드가 없으면 `400`, 예약을 찾지 못하면 `404`, 참조한 의사·환자가 없으면 `400`입니다. 취소된 예약을 다시 `booked`로 되돌릴 수 없습니다. 대기열 항목이 활성 상태라면 예약 취소 요청은 `409 Conflict`입니다. 취소 가능한 대기열 상태는 `booked`, `cancelled`, `no_show`이며, 예약 취소와 함께 대기열 항목도 `cancelled`로 바뀝니다.

`doctorId`, `patientId`, `scheduledAt` 변경 규칙:

- 취소된 예약은 변경할 수 없습니다(`409`).
- 체크인 이후(대기 항목이 `checked_in`, `disappeared`, `in_progress`, `completed`)에는 변경할 수 없습니다(`409`). 대기열 순번과 예상시간이 어긋나기 때문입니다.
- `no_show`된 예약을 변경하면 대기 항목이 `booked`로 돌아가 다시 체크인할 수 있습니다. 새 예약 시각도 이미 5분 이상 지났다면 노쇼 처리기가 다시 `no_show`로 바꿉니다.

### 3.6 예약 취소

`DELETE /api/appointments/:id`

예약 레코드를 삭제하지 않고 예약 상태를 `cancelled`로 변경합니다.

```sh
curl -i -X DELETE http://localhost:3000/api/appointments/1
```

성공 시 `{ "data": { ...취소된 예약 객체 } }`를 반환합니다. 취소 가능한 대기열 항목이 있으면 그 상태도 `cancelled`로 변경합니다. 활성 상태의 대기 항목이 있으면 `409 Conflict`, 예약을 찾지 못하면 `404 Not Found`입니다.

### 3.7 예약 환자 체크인

`POST /api/appointments/:id/check-in`

사전 예약 환자의 도착을 확인하고 대기열에 등록합니다. 요청 본문은 필요하지 않습니다.

```sh
curl -i -X POST http://localhost:3000/api/appointments/1/check-in
```

정상 체크인 시 의사별 당일 체크인 이력을 기준으로 다음 대기 순번을 부여하고 `checked_in` 상태와 `checkedInAt`을 저장합니다. 기존에 예약용 `booked` 대기 항목이 있으면 해당 항목을 갱신하고, 없으면 새 대기 항목을 만듭니다.

성공 응답 (`200 OK`):

```json
{
  "data": {
    "queueEntry": {
      "id": "1",
      "appointmentId": "1",
      "queuePosition": 1,
      "status": "checked_in",
      "checkedInAt": "2026-11-10T00:25:00.000Z"
    },
    "appointment": {
      "id": "1",
      "doctorId": "1",
      "patientId": "1",
      "scheduledAt": "2026-11-10T00:30:00.000Z",
      "status": "booked",
      "doctor": { "id": "1", "displayName": "김의사", "department": "내과" },
      "patient": { "id": "1", "displayName": "이환자" }
    }
  }
}
```
체크인 요청 전에 노쇼 처리가 실행됩니다. 체크인은 예약 시각 5분 후까지 가능하며, 그 이후에는 해당 예약이 `no_show`로 표시되어 체크인이 거부됩니다. **예약일이 오늘(한국 시간 기준)인 예약만** 체크인할 수 있으며, 다른 날 예약은 `409 Conflict`입니다. 당일 순번은 한국 시간 0시 기준으로 매일 1번부터 다시 시작하며, 같은 의사에게 동시에 체크인해도 순번이 겹치지 않습니다. 체크인에 성공하면 해당 의사의 SSE 구독자에게 `QUEUE_UPDATED` 이벤트를 보냅니다(3.13). 예약이 취소되었거나 이미 체크인·진료 처리되었거나 대기 항목이 취소/노쇼된 경우 `409 Conflict`, 예약을 찾지 못하면 `404 Not Found`입니다.


### 3.8 의사별 대기열과 예상 대기시간 조회

`GET /api/doctors/:doctorId/queue`

특정 의사의 대기열을 조회합니다. 대기열에는 `checked_in`, `disappeared` 상태가 포함되며, 현재 `in_progress`인 환자는 대기 목록과 별도로 남은 시간 계산에 반영됩니다. 조회 전에 전체 예약의 노쇼 처리가 실행됩니다.

```sh
curl -i http://localhost:3000/api/doctors/1/queue
```

성공 응답 (`200 OK`):

```json
{
  "data": {
    "doctor": { "id": "1", "displayName": "김의사", "department": "내과" },
    "generatedAt": "2026-11-10T00:45:00.000Z",
    "queue": [
      {
        "id": "1",
        "appointmentId": "1",
        "patientId": "1",
        "queuePosition": 1,
        "status": "checked_in",
        "isFirstVisit": false,
        "scheduledAt": "2026-11-10T00:30:00.000Z",
        "estimatedStartTime": "2026-11-10T00:45:00.000Z",
        "estimatedWaitMinutes": 0,
        "delayMinutes": 15
      }
    ]
  }
}
```

각 대기 항목에는 예약 시각, 초진 여부, 예상 진료 시작 시각, 예상 대기 분, 예약 시각 대비 지연 분이 포함됩니다. 의사별 초진·재진 EWMA가 있으면 사용하고, 없으면 의사별 알고리즘 설정(3.14)의 `firstVisitTime`·`reVisitTime`(설정이 없으면 12분·8분)을 사용합니다. 환자 간 준비시간 `prepTime`과 지연 알림 기준 `delayThreshold`도 설정값을 따릅니다. 진료 중인 환자가 있으면 그 환자의 초진·재진 예상시간이 끝나는 시각부터 대기 환자의 시작 시각을 계산합니다. 의사를 찾지 못하면 `404 Not Found`입니다.

### 3.9 대기열 상태 변경 및 진료시간 통계 갱신

`PATCH /api/queue-entries/:id/status`

JSON 본문에서 `status`를 지정합니다.

```json
{ "status": "in_progress" }
```

허용 상태: `booked`, `checked_in`, `cancelled`, `disappeared`, `in_progress`, `completed`, `no_show`.

이 API는 지정된 상태로 직접 변경합니다. 다만 아래 두 상태는 직전 상태를 검사하며, 조건에 맞지 않으면 `409 Conflict`입니다. 환자 호출·부재·복귀 동작에는 아래 전용 API를 사용하는 것을 권장합니다.

| 바꿀 상태 | 허용되는 현재 상태 | 추가 조건 |
|---|---|---|
| `in_progress` | `checked_in`, `disappeared` | 같은 의사에게 이미 `in_progress`인 환자가 없어야 함 |
| `completed` | `in_progress` | 같은 항목을 두 번 완료할 수 없음 (EWMA 중복 반영 방지) |

- `in_progress`: 현재 시각을 `startedAt`으로 기록합니다.
- `completed`: 현재 시각을 `completedAt`에 기록하고, 실제 진료 시간을 이용해 EWMA를 갱신합니다. 갱신 비율은 의사별 설정의 `alpha`(없으면 0.3)이고, 아직 통계가 없으면 설정의 `firstVisitTime`·`reVisitTime`에서 시작합니다. 완료 이전에 같은 의사에게 완료된 진료 기록이 있으면 `재진`, 없으면 `초진` 통계를 갱신합니다. 이후 남은 대기자의 예상 시작·대기·지연 시간을 재계산합니다.
- 다른 허용 상태: 전달한 상태만 기록합니다. 별도의 시각이나 EWMA 변경은 없습니다.

```sh
curl -i -X PATCH http://localhost:3000/api/queue-entries/1/status \
  -H 'Content-Type: application/json' \
  --data '{"status":"in_progress"}'

curl -i -X PATCH http://localhost:3000/api/queue-entries/1/status \
  -H 'Content-Type: application/json' \
  --data '{"status":"completed"}'
```

성공 응답의 `data`는 `updatedEntry`, `updatedEWMA`, `recalculatedQueue`를 포함합니다. 상태를 바꿀 때마다 남은 활성 대기자의 예상 시간을 재계산하여 `recalculatedQueue`에 담아 반환하고, 해당 의사의 SSE 구독자에게 `QUEUE_UPDATED` 이벤트를 보냅니다(3.13). `updatedEWMA`는 `completed`로 변경되면서 실제 진료시간이 반영된 경우에만 갱신된 수치를 반환하며, 그 외 상태 변경에서는 `null`입니다. 알 수 없는 대기 항목은 `404`, 상태 값 형식이 잘못되면 `400`, 허용되지 않은 상태 전환이면 `409`입니다.

### 3.10 환자 호출

`POST /api/queue-entries/:id/call`

`checked_in` 또는 `disappeared` 상태의 대기 항목을 호출합니다. 호출 시 현재 시각을 `called_at`에 기록하지만 대기열 상태는 변경하지 않습니다.

```sh
curl -i -X POST http://localhost:3000/api/queue-entries/1/call
```

성공 응답 (`200 OK`):

```json
{
  "data": {
    "queueEntry": {
      "id": "1",
      "appointmentId": "1",
      "queuePosition": 1,
      "status": "checked_in"
    },
    "callMessage": "이환자님, 내과 (김의사 의사실)로 들어오세요."
  }
}
```
호출에 성공하면 대기열을 재계산하지 않고 해당 의사의 SSE 구독자에게 `PATIENT_CALLED` 이벤트를 보냅니다(3.13). 허용되지 않은 상태의 항목이면 `409 Conflict`, 대기 항목이 없으면 `404 Not Found`입니다.

### 3.11 호출 후 부재 처리

`POST /api/queue-entries/:id/disappear`

`called_at`이 기록된 `checked_in` 또는 `disappeared` 항목을 호출했으나 환자가 나타나지 않았을 때 사용합니다. 선택 본문:

```json
{ "delayPositions": 2 }
```

`delayPositions`의 기본값은 2이며 1~10 사이의 정수여야 합니다(그 외 값은 `400 Bad Request`). 대상 항목은 `disappeared`가 되고, 바로 뒤의 대기 환자 `delayPositions`명이 각각 앞사람의 순번을 받아 한 칸씩 앞으로 이동하며, 대상 환자는 마지막으로 앞지른 환자의 순번을 받습니다. 뒤 환자가 `delayPositions`명보다 적으면 있는 만큼만 미룹니다. 뒤에 대기 환자가 없으면 현재 순번을 유지합니다. 응답에는 처리 결과와 남은 대기열의 예상시간 재계산 결과가 포함됩니다.

**부재 횟수 제한**: `queue_entries.disappear_count` 컬럼에 누적 횟수를 저장합니다. 부재를 2회까지는 `disappeared`로 처리하여 순번을 뒤로 미룹니다. 3회째 부재 처리 시 순번 조정 없이 즉시 `no_show`로 전환됩니다. 응답 `updatedEntry`에 `disappearCount`가 포함됩니다.

```sh
curl -i -X POST http://localhost:3000/api/queue-entries/1/disappear \
  -H 'Content-Type: application/json' \
  --data '{"delayPositions":2}'
```

부재 처리에 성공하면 남은 대기자의 예상 시간을 재계산하여 응답의 `recalculatedQueue`에 담아 반환하고, 해당 의사의 SSE 구독자에게 `QUEUE_UPDATED` 이벤트를 보냅니다(3.13). 호출 기록이 없거나 상태가 허용되지 않으면 `409 Conflict`, 대기 항목을 찾지 못하면 `404 Not Found`입니다.

### 3.12 부재 환자 대기열 복귀

`POST /api/queue-entries/:id/return`

`disappeared` 항목을 `checked_in`으로 바꾸고 조정된 대기 순번을 유지합니다. `called_at`은 `null`로 초기화되어 다시 호출할 수 있습니다. 요청 본문은 필요하지 않습니다.

```sh
curl -i -X POST http://localhost:3000/api/queue-entries/1/return
```

성공 응답에는 환자 안내 메시지와 갱신된 대기 항목이 포함되며, 복귀 직후 해당 의사의 SSE 구독자에게 `QUEUE_UPDATED` 이벤트를 보냅니다(3.13). 대상 상태가 `disappeared`가 아니면 `409 Conflict`, 대기 항목이 없으면 `404 Not Found`입니다.

### 3.13 의사별 대기열 실시간 구독 (SSE)

`GET /api/doctors/:doctorId/stream`

Server-Sent Events(`text/event-stream`) 연결을 열어 두고, 해당 의사의 대기열이 변경되거나 환자가 호출될 때마다 실시간 이벤트를 받습니다. 연결 직후 `CONNECTED` 이벤트를 한 번 보냅니다.

```sh
curl -N http://localhost:3000/api/doctors/1/stream
```

```text
data: {"type":"CONNECTED","doctorId":"1"}

data: {"type":"QUEUE_UPDATED","updatedEWMA":9.5,"recalculatedQueue":[{"ticketId":2,"estimatedStartTime":"2026-11-10T00:55:00.000Z","delayMinutes":10,"isAlertTriggered":true}],"alertTargets":[{"ticketId":2,"estimatedStartTime":"2026-11-10T00:55:00.000Z","delayMinutes":10,"isAlertTriggered":true}]}

data: {"type":"PATIENT_CALLED","queueEntry":{"id":"2","appointmentId":"2","queuePosition":1,"status":"checked_in"},"callMessage":"이환자님, 내과 (김의사 의사실)로 들어오세요."}
```

| 이벤트 `type` | 발생 시점 | 설명 |
|---|---|---|
| `CONNECTED` | 스트림 연결 직후 (1회) | 해당 `doctorId` 채널 구독이 시작되었음을 알립니다. |
| `QUEUE_UPDATED` | 체크인(3.7), 상태 변경(3.9), 부재 처리(3.11), 복귀 처리(3.12) 성공 시 | 대기열 구성·순번·예상 시간이 바뀔 때 재계산 결과와 지연 알림 대상을 전송합니다. |
| `PATIENT_CALLED` | 환자 호출(3.10) 성공 시 | 순번이나 예상 시간 변동이 없으므로 대기열을 재계산하지 않고 호출 정보만 전송합니다. |

- `CONNECTED`: 연결된 의사 ID 문자열(`doctorId`)을 포함합니다.
- `QUEUE_UPDATED`: 대기열 변경 시 전송되며 아래 필드를 포함합니다.
  - `updatedEWMA`: 진료 완료(`completed`)로 실제 진료시간이 반영된 경우에만 갱신된 EWMA(분)를 담으며, 체크인·진료 시작·취소·노쇼·부재·복귀 등 그 외 이벤트에서는 `null`입니다.
  - `recalculatedQueue`: 남은 활성 대기자(`checked_in`, `disappeared`)의 예상 시간 재계산 결과 배열입니다. 완료뿐 아니라 모든 상태 변경(3.9) 및 체크인·부재·복귀 시 최신 계산 결과를 포함하며, 각 항목은 `ticketId`(대기 항목 ID 숫자), `estimatedStartTime`(예상 시작 시각), `delayMinutes`(예약 대비 지연 분), `isAlertTriggered`(지연 알림 기준 도달 여부)를 가집니다.
  - `alertTargets`: `recalculatedQueue` 중 지연 시간이 의사별 알고리즘 설정(3.14)의 `delayThreshold`(설정이 없으면 10분) 이상(`isAlertTriggered: true`)인 항목만 추린 배열입니다.
- `PATIENT_CALLED`: 환자 호출 시 대기열 재계산 없이 호출된 대기 항목 요약(`queueEntry`: `id`, `appointmentId`, `queuePosition`, `status`)과 안내 메시지(`callMessage`)만 전송합니다.

브라우저에서는 `new EventSource("http://localhost:3000/api/doctors/1/stream")`로 구독하며, 페이지를 벗어나거나 진료실을 바꿀 때는 `close()`로 기존 연결을 종료합니다. 잘못된 `doctorId` 형식은 `400 Bad Request`입니다.

### 3.14 의사별 알고리즘 설정 조회

`GET /api/algorithm-config/:doctorId`

의사별 예상시간 계산 설정을 조회합니다. 저장된 설정이 없으면 기본값을 반환합니다(이때 `id`는 없습니다). 의사를 찾지 못하면 `404 Not Found`입니다.

```sh
curl -i http://localhost:3000/api/algorithm-config/1
```

성공 응답 (`200 OK`):

```json
{
  "data": {
    "doctorId": "1",
    "firstVisitTime": 12,
    "reVisitTime": 8,
    "prepTime": 1,
    "alpha": 0.3,
    "sampleCount": 10,
    "delayThreshold": 10,
    "reNotifyThreshold": 5,
    "imminentCount": 2
  }
}
```

| 필드 | 기본값 | 허용 범위 | 의미 |
|---|---|---|---|
| `firstVisitTime` | 12 | 0 초과 240 이하 | 초진 EWMA가 없을 때 쓰는 초진 진료시간(분) |
| `reVisitTime` | 8 | 0 초과 240 이하 | 재진 EWMA가 없을 때 쓰는 재진 진료시간(분) |
| `prepTime` | 1 | 0 ~ 60 | 환자 간 준비시간(분) |
| `alpha` | 0.3 | 0 초과 1 이하 | 진료 완료 시 EWMA 갱신 비율 |
| `sampleCount` | 10 | 정수 1 ~ 1000 | 반영할 최근 진료 수 (아직 계산에 쓰지 않음) |
| `delayThreshold` | 10 | 정수 0 ~ 240 | 지연 알림 기준(분) |
| `reNotifyThreshold` | 5 | 정수 1 ~ 240 | 추가 지연 재알림 간격(분) (아직 쓰지 않음) |
| `imminentCount` | 2 | 정수 0 ~ 100 | 순서 임박 알림 기준(몇 명 전) (아직 쓰지 않음) |

### 3.15 의사별 알고리즘 설정 저장

`PUT /api/algorithm-config/:doctorId`

3.14의 필드 중 바꿀 값만 JSON 본문으로 보냅니다. 설정이 없으면 새로 만들고(보내지 않은 필드는 기본값), 있으면 보낸 필드만 바꿉니다. 그 밖의 필드는 무시합니다.

```sh
curl -i -X PUT http://localhost:3000/api/algorithm-config/1 \
  -H 'Content-Type: application/json' \
  --data '{"alpha":0.4,"delayThreshold":15}'
```

성공 응답(`200 OK`)의 `data`는 저장된 설정 전체(`id`, `doctorId`, `updatedAt` 포함)입니다. 값이 숫자가 아니거나 3.14 표의 허용 범위를 벗어나면 `400 Bad Request`(예: `alpha must be a number in (0, 1]`), 의사를 찾지 못하면 `404 Not Found`입니다.

### 3.16 환자용 대기 정보 조회

`GET /api/appointments/:id/wait`

환자용 화면(`frontend/`)이 체크인한 오늘 예약의 대기 정보를 표시할 때 쓰는 API입니다. 의사 전체 대기열(3.8)과 달리 **해당 예약의 대기 정보만** 반환하며, 다른 환자의 ID·순번·예상 시간은 포함하지 않습니다. 조회 전에 노쇼 처리가 실행됩니다.

```sh
curl -i http://localhost:3000/api/appointments/1/wait
```

성공 응답 (`200 OK`):

```json
{
  "data": {
    "appointmentId": "1",
    "doctor": { "id": "1", "displayName": "김의사", "department": "내과" },
    "scheduledAt": "2026-11-10T00:30:00.000Z",
    "appointmentStatus": "booked",
    "queueStatus": "checked_in",
    "generatedAt": "2026-11-10T00:45:00.000Z",
    "waiting": {
      "queuePosition": 3,
      "peopleAhead": 2,
      "isCalled": false,
      "estimatedStartTime": "2026-11-10T01:11:00.000Z",
      "estimatedWaitMinutes": 26,
      "delayMinutes": 41,
      "isDelayed": true
    }
  }
}
```

| 필드 | 설명 |
|---|---|
| `queueStatus` | 대기열 상태. 대기 항목이 아직 없으면(체크인 전) `null` |
| `waiting` | 대기 중(`checked_in`, `disappeared`)일 때만 값이 있고, 그 밖의 상태(체크인 전, 진료 중, 완료, 취소, 노쇼)에서는 `null` |
| `waiting.queuePosition` | 대기 순번 |
| `waiting.peopleAhead` | 앞에 남은 대기 인원 (진료 중인 환자는 제외) |
| `waiting.isCalled` | 진료실 호출 여부 (`called_at` 기록 여부) |
| `waiting.estimatedStartTime` | 예상 진료 시작 시각 |
| `waiting.estimatedWaitMinutes` | 예상 시작까지 남은 분 |
| `waiting.delayMinutes` | 예약 시각 대비 예상 지연 분 |
| `waiting.isDelayed` | 지연이 의사별 `delayThreshold`(기본 10분) 이상인지 여부 |

예상 시간은 3.8과 같은 방식으로 계산합니다. 예약을 찾지 못하면 `404 Not Found`, 잘못된 ID는 `400 Bad Request`입니다.

### 3.17 의사 목록·상세 조회

`GET /api/doctors`, `GET /api/doctors/:id`

의사를 ID 오름차순으로 조회합니다. 목록 조회는 선택적 query parameter `department`(진료과 이름과 정확히 일치)로 필터링할 수 있습니다.

```sh
curl -i 'http://localhost:3000/api/doctors?department=내과'
curl -i http://localhost:3000/api/doctors/1
```

```json
{ "data": [{ "id": "1", "displayName": "김의사", "department": "내과" }] }
```

상세 조회는 `{ "data": { ...의사 객체 } }`이며, 의사를 찾지 못하면 `404 Not Found`입니다.

### 3.18 의사 등록·수정·삭제

`POST /api/doctors`, `PATCH /api/doctors/:id`, `DELETE /api/doctors/:id`

| Field | Type | 설명 |
|---|---|---|
| `displayName` | 문자열 (1~50자) | 의사 이름 |
| `department` | 문자열 (1~50자) | 진료과 |

- 등록: 두 필드 모두 필수입니다. 성공 시 `201 Created`.
- 수정: 보낸 필드만 바꿉니다. 수정할 필드가 하나도 없으면 `400`, 의사가 없으면 `404`.
- 삭제: 예약 기록이 하나라도 있는 의사는 삭제하지 않고 `409 Conflict`를 반환합니다. 예약이 없으면 그 의사의 알고리즘 설정과 진료시간 통계를 함께 삭제합니다. 성공 시 삭제된 의사 객체를 반환합니다.
- 문자열 앞뒤 공백은 지워서 저장하며, 비어 있거나 50자를 넘으면 `400 Bad Request`입니다.

```sh
curl -i -X POST http://localhost:3000/api/doctors \
  -H 'Content-Type: application/json' \
  --data '{"displayName":"김의사","department":"내과"}'
```

### 3.19 환자 목록·상세 조회

`GET /api/patients`, `GET /api/patients/:id`

환자를 ID 오름차순으로 조회합니다. 목록 조회는 선택적 query parameter `name`으로 이름에 해당 문자열이 포함된 환자만 검색할 수 있습니다.

```sh
curl -i 'http://localhost:3000/api/patients?name=이'
```

```json
{ "data": [{ "id": "1", "displayName": "이환자" }] }
```

상세 조회에서 환자를 찾지 못하면 `404 Not Found`입니다.

### 3.20 환자 등록·수정·삭제

`POST /api/patients`, `PATCH /api/patients/:id`, `DELETE /api/patients/:id`

- 등록·수정 본문은 `{ "displayName": "이환자" }`이며 `displayName`(1~50자)은 필수입니다. 등록 성공 시 `201 Created`.
- 삭제: 예약 기록이 있는 환자는 `409 Conflict`입니다. 진료 이력이 초진·재진 판단에 쓰이기 때문입니다.
- 환자를 찾지 못하면 `404 Not Found`입니다.

### 3.21 의사별 초진·재진 EWMA 조회

`GET /api/doctors/:id/service-time-stats`

진료 완료(3.9) 때 갱신되는 의사별 초진·재진 EWMA, 즉 대기열 계산(3.8)에 실제로 쓰이는 예상 진료시간을 조회합니다. 아직 완료된 진료가 없어 통계가 없으면 알고리즘 설정(3.14)의 `firstVisitTime`·`reVisitTime`(설정이 없으면 12분·8분)을 돌려주고 `isDefault`를 `true`로 표시합니다.

```sh
curl -i http://localhost:3000/api/doctors/1/service-time-stats
```

성공 응답 (`200 OK`):

```json
{
  "data": {
    "doctorId": "1",
    "firstVisit": { "ewmaMinutes": 13.6, "sampleCount": 3, "updatedAt": "2026-11-26T13:20:05.701Z", "isDefault": false },
    "followUp": { "ewmaMinutes": 8, "sampleCount": 0, "updatedAt": null, "isDefault": true }
  }
}
```

| 필드 | 설명 |
|---|---|
| `ewmaMinutes` | 현재 예상 진료시간(분) |
| `sampleCount` | EWMA에 반영된 진료 완료 건수 |
| `updatedAt` | 마지막 갱신 시각, 통계가 없으면 `null` |
| `isDefault` | 통계가 없어 설정 기본시간을 돌려준 경우 `true` |

의사를 찾지 못하면 `404 Not Found`입니다.

## 4. 자동 예약 노쇼 처리

서버 시작 시 한 번 실행하고, 이후 30초 간격으로 실행합니다. 또한 예약 목록·상세 조회, 환자용 대기 정보 조회, 의사별 대기열 조회, 체크인 요청 시에도 실행합니다.

예약 상태가 `booked`이고 예약 시각으로부터 5분 이상 경과했으며 체크인하지 않았다면 해당 예약의 대기 항목을 `no_show`로 처리합니다. 대기 항목이 없는 예약에는 `queue_position = 0`인 `no_show` 항목을 생성하며, 예약 상태 자체는 `booked`로 유지됩니다. 이미 체크인한 환자의 대기 상태는 자동 노쇼 처리 대상이 아닙니다.

## 5. 공통 오류 상태

| Status | 의미 |
|---|---|
| `200 OK` | 조회 또는 변경 성공 |
| `201 Created` | 예약·의사·환자 생성 성공 |
| `400 Bad Request` | 잘못된 ID·날짜·상태·본문(JSON 형식 오류 포함) 또는 존재하지 않는 의사/환자 참조 |
| `404 Not Found` | 예약, 의사, 환자 또는 대기 항목을 찾을 수 없음 |
| `409 Conflict` | 현재 상태에서 허용되지 않는 체크인·취소·호출 등의 요청, 예약이 있는 의사·환자 삭제 |
| `500 Internal Server Error` | 처리되지 않은 서버 오류 |
| `503 Service Unavailable` | `/health` 데이터베이스 연결 확인 실패 |
