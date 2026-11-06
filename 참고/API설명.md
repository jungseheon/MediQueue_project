# MediQueue API 명세

## 1. 공통 정보

- 기본 주소: `http://localhost:3000`
- 요청 본문은 JSON이며, JSON 본문을 보내는 요청은 `Content-Type: application/json` 헤더를 사용합니다.
- 시간 입력은 ISO 8601 문자열이어야 합니다. 예: `2026-11-10T09:30:00+09:00`.
- ID 입력은 양의 정수 또는 숫자 문자열입니다. 응답의 BigInt ID는 문자열로 반환됩니다.
- 예약 상태는 `booked`, `cancelled`입니다.
- 대기열 상태는 `booked`, `checked_in`, `cancelled`, `disappeared`, `inprogress`, `completed`, `no_show`입니다. `called`는 대기열 상태가 아니며, 호출 시각을 `called_at`에 기록합니다.
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
| GET | `/api/doctors/:doctorId/queue` | 의사별 대기열 및 예상 대기시간 조회 |
| PATCH | `/api/queue-entries/:id/status` | 대기열 상태 변경 및 완료 통계 갱신 |
| POST | `/api/queue-entries/:id/call` | 환자 호출 기록 및 안내 메시지 반환 |
| POST | `/api/queue-entries/:id/disappear` | 호출 후 부재 처리 및 순번 조정 |
| POST | `/api/queue-entries/:id/return` | 부재 환자를 대기열로 복귀 |

의사 및 환자를 생성·수정·삭제하는 API는 현재 제공하지 않습니다. 이 API들은 이미 등록된 `doctors`와 `patients` 레코드를 참조합니다.

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

ID에 해당하는 예약 하나를 조회하며 `doctor`, `patient`, `queueEntry`를 함께 반환합니다. 이 요청 자체는 노쇼 처리기를 호출하지 않습니다.

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

체크인 요청 전에 노쇼 처리가 실행됩니다. 예약 시각으로부터 5분 이상 지났다면 해당 예약은 `no_show`로 표시되어 체크인이 거부됩니다. 예약이 취소되었거나 이미 체크인·진료 처리되었거나 대기 항목이 취소/노쇼된 경우 `409 Conflict`, 예약을 찾지 못하면 `404 Not Found`입니다.

### 3.8 의사별 대기열과 예상 대기시간 조회

`GET /api/doctors/:doctorId/queue`

특정 의사의 대기열을 조회합니다. 대기열에는 `checked_in`, `disappeared` 상태가 포함되며, 현재 `inprogress`인 환자는 대기 목록과 별도로 남은 시간 계산에 반영됩니다. 조회 전에 전체 예약의 노쇼 처리가 실행됩니다.

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

각 대기 항목에는 예약 시각, 초진 여부, 예상 진료 시작 시각, 예상 대기 분, 예약 시각 대비 지연 분이 포함됩니다. 의사별 초진·재진 EWMA가 있으면 사용하고, 없으면 각각 12분·8분을 기본값으로 사용합니다. 의사를 찾지 못하면 `404 Not Found`입니다.

### 3.9 대기열 상태 변경 및 진료시간 통계 갱신

`PATCH /api/queue-entries/:id/status`

JSON 본문에서 `status`를 지정합니다.

```json
{ "status": "inprogress" }
```

허용 상태: `booked`, `checked_in`, `cancelled`, `disappeared`, `inprogress`, `completed`, `no_show`.

이 API는 지정된 상태로 직접 변경하며, 상태 간 전이 순서는 검증하지 않습니다. 환자 호출·부재·복귀 동작에는 아래 전용 API를 사용하는 것을 권장합니다.

- `inprogress`: 현재 시각을 `startedAt`으로 기록합니다.
- `completed`: 현재 시각을 `completedAt`에 기록하고, 실제 진료 시간을 이용해 EWMA를 갱신합니다. 완료 이전에 같은 의사에게 완료된 진료 기록이 있으면 `재진`, 없으면 `초진` 통계를 갱신합니다. 이후 남은 대기자의 예상 시작·대기·지연 시간을 재계산합니다.
- 다른 허용 상태: 전달한 상태만 기록합니다. 별도의 시각이나 EWMA 변경은 없습니다.

```sh
curl -i -X PATCH http://localhost:3000/api/queue-entries/1/status \
  -H 'Content-Type: application/json' \
  --data '{"status":"inprogress"}'

curl -i -X PATCH http://localhost:3000/api/queue-entries/1/status \
  -H 'Content-Type: application/json' \
  --data '{"status":"completed"}'
```

성공 응답의 `data`는 `updatedEntry`, `updatedEWMA`, `recalculatedQueue`를 포함합니다. 완료 외 상태에서는 `updatedEWMA`가 `null`, `recalculatedQueue`가 빈 배열입니다. 알 수 없는 대기 항목은 `404`, 허용되지 않은 상태는 `400`입니다.

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

허용되지 않은 상태의 항목이면 `409 Conflict`, 대기 항목이 없으면 `404 Not Found`입니다.

### 3.11 호출 후 부재 처리

`POST /api/queue-entries/:id/disappear`

`called_at`이 기록된 `checked_in` 또는 `disappeared` 항목을 호출했으나 환자가 나타나지 않았을 때 사용합니다. 선택 본문:

```json
{ "delayPositions": 2 }
```

`delayPositions`의 기본값은 2이며 1~10 범위로 제한됩니다. 대상 항목은 `disappeared`가 되고, 그 뒤에 있는 대기 환자들은 앞으로 이동하며, 대상 환자의 순번은 지정된 수만큼 뒤로 조정됩니다. 뒤에 대기 환자가 없으면 현재 순번을 유지합니다. 응답에는 처리 결과와 남은 대기열의 예상시간 재계산 결과가 포함됩니다.

```sh
curl -i -X POST http://localhost:3000/api/queue-entries/1/disappear \
  -H 'Content-Type: application/json' \
  --data '{"delayPositions":2}'
```

호출 기록이 없거나 상태가 허용되지 않으면 `409 Conflict`, 대기 항목을 찾지 못하면 `404 Not Found`입니다. 현재 구현은 부재 횟수를 저장하지 않으며, 부재 횟수에 따라 자동 `no_show` 처리하지 않습니다.

### 3.12 부재 환자 대기열 복귀

`POST /api/queue-entries/:id/return`

`disappeared` 항목을 `checked_in`으로 바꾸고 조정된 대기 순번을 유지합니다. `called_at`은 `null`로 초기화되어 다시 호출할 수 있습니다. 요청 본문은 필요하지 않습니다.

```sh
curl -i -X POST http://localhost:3000/api/queue-entries/1/return
```

성공 응답에는 환자 안내 메시지와 갱신된 대기 항목이 포함됩니다. 대상 상태가 `disappeared`가 아니면 `409 Conflict`, 대기 항목이 없으면 `404 Not Found`입니다.

## 4. 자동 예약 노쇼 처리

서버 시작 시 한 번 실행하고, 이후 30초 간격으로 실행합니다. 또한 예약 목록 조회, 의사별 대기열 조회, 체크인 요청 시에도 실행합니다.

예약 상태가 `booked`이고 예약 시각으로부터 5분 이상 경과했으며 체크인하지 않았다면 해당 예약의 대기 항목을 `no_show`로 처리합니다. 대기 항목이 없는 예약에는 `queue_position = 0`인 `no_show` 항목을 생성하며, 예약 상태 자체는 `booked`로 유지됩니다. 이미 체크인한 환자의 대기 상태는 자동 노쇼 처리 대상이 아닙니다.

## 5. 공통 오류 상태

| Status | 의미 |
|---|---|
| `200 OK` | 조회 또는 변경 성공 |
| `201 Created` | 예약 생성 성공 |
| `400 Bad Request` | 잘못된 ID·날짜·상태·본문 또는 존재하지 않는 의사/환자 참조 |
| `404 Not Found` | 예약, 의사 또는 대기 항목을 찾을 수 없음 |
| `409 Conflict` | 현재 상태에서 허용되지 않는 체크인·취소·호출 등의 요청 |
| `500 Internal Server Error` | 처리되지 않은 서버 오류 |
| `503 Service Unavailable` | `/health` 데이터베이스 연결 확인 실패 |
