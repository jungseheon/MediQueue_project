// 화면에서 쓰는 데이터 형식과 예약 검증 (DOM·네트워크 없이 테스트 가능)

const TZ = 'Asia/Seoul';

// 백엔드에 병원 테이블과 의사 목록 API가 아직 없어서, 병원별 의사 ID를 여기서 연결한다.
// 의사 ID와 이름은 dump.sql의 정신건강의학과 의사(13, 23번) 기준이다.
// TODO: 의사 목록 API가 생기면 서버 응답으로 교체
export const hospitals = [
  { id: 'onyu', name: '온유 정신건강의학과', area: '서울 강남구', doctors: [{ id: '13', name: '가상 의사 08' }] },
  { id: 'maeum', name: '마음봄 정신건강의학과', area: '서울 마포구', doctors: [{ id: '23', name: '가상 의사 18' }] },
];

export const times = ['13:30', '14:00', '14:30', '15:00', '15:30'];

export function today() {
  return new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
}

// 서울 기준 현재 시각 "HH:MM"
export function nowTime(now = new Date()) {
  return now.toLocaleTimeString('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
}

export function shiftDate(value, amount) {
  const date = new Date(`${value}T12:00:00+09:00`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toLocaleDateString('sv-SE', { timeZone: TZ });
}

export function formatDate(value) {
  return new Date(`${value}T12:00:00+09:00`).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: TZ });
}

// ISO 시각 → 서울 기준 날짜와 시각
export function splitKst(iso) {
  const date = new Date(iso);
  return { date: date.toLocaleDateString('sv-SE', { timeZone: TZ }), time: nowTime(date) };
}

export function toIso(date, time) {
  return `${date}T${time}:00+09:00`;
}

export function hospitalOfDoctor(doctorId) {
  return hospitals.find(hospital => hospital.doctors.some(doctor => doctor.id === doctorId)) ?? null;
}

// 체크인 이후에는 서버가 예약 변경·취소를 막는다(409).
export const CHECKED_IN = ['checked_in', 'disappeared', 'in_progress'];
export const isCheckedIn = item => CHECKED_IN.includes(item.queueStatus);

// 서버 예약 객체 → 화면용 예약
export function fromApi(appointment) {
  const { date, time } = splitKst(appointment.scheduledAt);
  const queueStatus = appointment.queueEntry?.status ?? null;
  let status = 'active';
  if (appointment.status === 'cancelled' || queueStatus === 'cancelled') status = 'cancelled';
  else if (queueStatus === 'completed') status = 'completed';
  else if (queueStatus === 'no_show') status = 'noshow';
  const hospital = hospitalOfDoctor(appointment.doctorId);
  return {
    id: appointment.id,
    doctorId: appointment.doctorId,
    doctor: appointment.doctor?.displayName ?? '',
    department: appointment.doctor?.department ?? '',
    hospitalId: hospital?.id ?? null,
    hospitalName: hospital?.name ?? `${appointment.doctor?.department ?? ''} 협력 병원`,
    date,
    time,
    status,
    queueStatus,
    queuePosition: appointment.queueEntry?.queuePosition ?? null,
    estimate: null, // 체크인 후 대기열 API로 채움
  };
}

// 대기열 API 항목에서 예상 진료 정보 추출
export function estimateFromQueue(entry) {
  if (!entry) return null;
  return {
    start: nowTime(new Date(entry.estimatedStartTime)),
    delay: Math.max(0, Math.round(entry.delayMinutes ?? 0)),
    position: entry.queuePosition,
  };
}

// 선택한 의사·날짜에서 예약 가능한 시간
// doctorBooked: 그 의사의 예약(fromApi 결과), editingId: 변경 중인 내 예약은 제외
export function available(draft, doctorBooked, editingId = null, now = new Date()) {
  const current = draft.date === today() ? nowTime(now) : null;
  return times.filter(time =>
    !(current && time <= current) &&
    !doctorBooked.some(item => item.id !== editingId && item.status === 'active' && item.doctorId === draft.doctorId && item.date === draft.date && item.time === time));
}

export function validate(draft, { doctorBooked = [], mine = [] }, editingId = null, now = new Date()) {
  const hospital = hospitals.find(item => item.id === draft.hospitalId);
  if (!hospital || !hospital.doctors.some(doctor => doctor.id === draft.doctorId)) return '병원과 담당의를 확인해 주세요.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || draft.date < today()) return '오늘 이후 날짜를 선택해 주세요.';
  if (!available(draft, doctorBooked, editingId, now).includes(draft.time)) return '예약 가능한 시간을 선택해 주세요.';
  if (mine.some(item => item.id !== editingId && item.status === 'active' && item.date === draft.date && item.time === draft.time)) return '같은 시간에 다른 예약이 있습니다.';
  return '';
}
