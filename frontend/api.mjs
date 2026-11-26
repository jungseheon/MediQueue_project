// 백엔드 API 호출과 오류 안내 (docs/api.md 기준)
import { toIso } from './model.mjs';

const API_BASE = `http://${location.hostname}:3000`;

// 로그인 기능이 없어 시연용 환자를 고정한다 (dump.sql 4번 = 양윤서). 이름은 환자 API로 확인한다.
// TODO: 로그인 기능이 생기면 로그인한 환자 ID로 교체
export const PATIENT_ID = '4';

const statusMessages = {
  400: '입력한 예약 정보를 다시 확인해 주세요.',
  404: '예약 정보를 찾을 수 없습니다. 새로고침 후 다시 확인해 주세요.',
  409: '이미 체크인했거나 취소된 예약이라 처리할 수 없습니다.',
};

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.status = status;
  }
}

// messages: 이 요청에서만 쓸 상태 코드별 안내 문구
async function request(path, options = {}, messages = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  let response;
  try {
    response = await fetch(API_BASE + path, {
      ...options,
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
  } catch (error) {
    const message = error.name === 'AbortError'
      ? '서버 응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.'
      : '서버에 연결할 수 없습니다. 백엔드 실행 여부와 네트워크를 확인해 주세요.';
    throw new ApiError(message);
  } finally {
    clearTimeout(timer);
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(messages[response.status] ?? statusMessages[response.status] ?? '서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.', response.status);
  }
  return body.data;
}

const json = (method, data) => ({ method, body: JSON.stringify(data) });

export const api = {
  doctors: () => request('/api/doctors'),
  patient: () => request(`/api/patients/${PATIENT_ID}`, {}, { 404: `시연용 환자(ID ${PATIENT_ID})를 찾을 수 없습니다. dump.sql 샘플 데이터를 복원했는지 확인해 주세요.` }),
  myAppointments: () => request(`/api/appointments?patientId=${PATIENT_ID}`),
  doctorBooked: doctorId => request(`/api/appointments?doctorId=${doctorId}&status=booked`),
  create: ({ doctorId, date, time }) => request('/api/appointments', json('POST', { doctorId, patientId: PATIENT_ID, scheduledAt: toIso(date, time) })),
  update: (id, { doctorId, date, time }) => request(`/api/appointments/${id}`, json('PATCH', { doctorId, scheduledAt: toIso(date, time) })),
  cancel: id => request(`/api/appointments/${id}`, { method: 'DELETE' }),
  wait: id => request(`/api/appointments/${id}/wait`),
};
