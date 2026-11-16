// 백엔드 API 호출 및 공통 함수 (README의 API 명세 기준)
const API_BASE = "http://localhost:3000";

async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `요청 실패 (${res.status})`);
  return body.data;
}

const Api = {
  getAppointments: () => api("/api/appointments"),
  updateAppointment: (id, data) => api(`/api/appointments/${id}`, { method: "PATCH", body: JSON.stringify(data) }),
  cancelAppointment: (id) => api(`/api/appointments/${id}`, { method: "DELETE" }),
  getQueue: (doctorId) => api(`/api/doctors/${doctorId}/queue`),
  setQueueStatus: (id, status) => api(`/api/queue-entries/${id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }),
  call: (id) => api(`/api/queue-entries/${id}/call`, { method: "POST" }),
  disappear: (id) => api(`/api/queue-entries/${id}/disappear`, { method: "POST", body: JSON.stringify({}) }),
  returnToQueue: (id) => api(`/api/queue-entries/${id}/return`, { method: "POST" }),
};

// 시간 표시
const TZ = "Asia/Seoul";

function fmtTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("ko-KR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
}

// YYYY-MM-DD (KST)
function dateKey(value) {
  return new Date(value).toLocaleDateString("sv-SE", { timeZone: TZ });
}

// "YYYY-MM-DD" 날짜 계산 (정오 기준이라 시간대 영향 없음)
function keyToDate(key) {
  return new Date(key + "T12:00:00+09:00");
}
function addDays(key, n) {
  const d = keyToDate(key);
  d.setUTCDate(d.getUTCDate() + n);
  return dateKey(d);
}
function weekdayOf(key) {
  return "일월화수목금토"[keyToDate(key).getUTCDay()];
}

// "날짜"
function fmtDateLabel(key) {
  const [, m, d] = key.split("-");
  return `${Number(m)}/${Number(d)} (${weekdayOf(key)})`;
}

function delayText(minutes) {
  return minutes > 0 ? `+${minutes}분` : "정시";
}

// 지연 알림 기준(백엔드 calculator 기본값 10분)
const DELAY_ALERT_MINUTES = 10;

// 대기열 상태
const QUEUE_STATUS_LABEL = {
  booked: "예약 · 미도착",
  checked_in: "대기 · 도착",
  disappeared: "부재 처리",
  in_progress: "진료 중",
  completed: "진료 완료",
  cancelled: "취소",
  no_show: "노쇼",
};

// 예약의 화면용 상태 (대기열이 없으면 예약 상태 기준)
function viewStatus(appt) {
  if (appt.status === "cancelled") return "cancelled";
  return appt.queueEntry ? appt.queueEntry.status : "booked";
}

// 상태 필터 그룹 (예약 관리 화면의 요약 카드/필터)
const STATUS_GROUPS = {
  waiting: ["booked", "checked_in"],
  in_progress: ["in_progress"],
  completed: ["completed"],
  cancelled: ["cancelled", "no_show", "disappeared"],
};

function patientName(appt) {
  return appt ? appt.patient.displayName : "—";
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
