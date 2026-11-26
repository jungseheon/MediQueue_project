// 화면에서 쓰는 데이터 형식과 예약 검증 (DOM·네트워크 없이 테스트 가능)

const TZ = 'Asia/Seoul';

// 백엔드에 병원 테이블이 없어서 병원 이름·지역만 여기서 정하고 의사 ID로 연결한다.
// 의사 이름·진료과는 의사 목록 API(GET /api/doctors)에서 받는다. (dump.sql 13, 23번 기준)
export const clinics = [
  { id: 'onyu', name: '온유 정신건강의학과', area: '서울 강남구', doctorIds: ['13'] },
  { id: 'maeum', name: '마음봄 정신건강의학과', area: '서울 마포구', doctorIds: ['23'] },
];

// 의사 목록 API 응답 → 화면의 병원 목록
// clinics에 연결된 의사는 해당 병원에, 나머지는 진료과별 "협력 병원"으로 묶는다.
export function buildHospitals(doctors, clinicList = clinics) {
  const toDoctor = doctor => ({ id: doctor.id, name: doctor.displayName, department: doctor.department });
  const linked = new Set(clinicList.flatMap(clinic => clinic.doctorIds));
  const named = clinicList
    .map(({ doctorIds, ...clinic }) => ({ ...clinic, doctors: doctors.filter(doctor => doctorIds.includes(doctor.id)).map(toDoctor) }))
    .filter(clinic => clinic.doctors.length > 0); // DB에 없는 의사만 연결된 병원은 숨김

  const byDepartment = new Map();
  for (const doctor of doctors.filter(item => !linked.has(item.id))) {
    if (!byDepartment.has(doctor.department)) byDepartment.set(doctor.department, []);
    byDepartment.get(doctor.department).push(toDoctor(doctor));
  }
  const partners = [...byDepartment.keys()]
    .sort((first, second) => first.localeCompare(second, 'ko'))
    .map(department => ({ id: `dept:${department}`, name: `${department} 협력 병원`, area: department, doctors: byDepartment.get(department) }));

  return [...named, ...partners];
}

// 병원명·지역·진료과·의사 이름으로 검색 (공백 무시)
export function searchHospitals(hospitals, query) {
  const keyword = query.replaceAll(' ', '');
  return hospitals.filter(hospital =>
    [hospital.name, hospital.area, ...hospital.doctors.flatMap(doctor => [doctor.name, doctor.department])]
      .join('|').replaceAll(' ', '').includes(keyword));
}

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

export function hospitalOfDoctor(hospitals, doctorId) {
  return hospitals.find(hospital => hospital.doctors.some(doctor => doctor.id === doctorId)) ?? null;
}

// 체크인 이후에는 서버가 예약 변경·취소를 막는다(409).
export const CHECKED_IN = ['checked_in', 'disappeared', 'in_progress'];
export const isCheckedIn = item => CHECKED_IN.includes(item.queueStatus);

// 예약 상태 + 대기 상태 → 화면 상태(active, cancelled, completed, noshow)
export function screenStatus(appointmentStatus, queueStatus) {
  if (appointmentStatus === 'cancelled' || queueStatus === 'cancelled') return 'cancelled';
  if (queueStatus === 'completed') return 'completed';
  if (queueStatus === 'no_show') return 'noshow';
  return 'active';
}

// 서버 예약 객체 → 화면용 예약 (hospitals: buildHospitals 결과)
export function fromApi(appointment, hospitals = []) {
  const { date, time } = splitKst(appointment.scheduledAt);
  const queueStatus = appointment.queueEntry?.status ?? null;
  const status = screenStatus(appointment.status, queueStatus);
  const hospital = hospitalOfDoctor(hospitals, appointment.doctorId);
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
    estimate: null, // 체크인 후 대기 정보 API로 채움
  };
}

// 대기 정보 API(GET /api/appointments/:id/wait)의 waiting → 화면용 예상 진료 정보
export function estimateFromWait(waiting) {
  if (!waiting) return null;
  return {
    start: nowTime(new Date(waiting.estimatedStartTime)),
    delay: Math.max(0, Math.round(waiting.delayMinutes ?? 0)),
    position: waiting.queuePosition,
    ahead: waiting.peopleAhead,
    called: waiting.isCalled === true,
    delayed: waiting.isDelayed === true,
  };
}

// 대기 정보 API 응답을 화면용 예약에 반영 (체크인 이후 상태 변화 포함)
export function applyWait(item, wait) {
  return {
    ...item,
    queueStatus: wait.queueStatus,
    status: screenStatus(wait.appointmentStatus, wait.queueStatus),
    estimate: estimateFromWait(wait.waiting),
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

export function validate(draft, { doctorBooked = [], mine = [], hospitals = [] }, editingId = null, now = new Date()) {
  const hospital = hospitals.find(item => item.id === draft.hospitalId);
  if (!hospital || !hospital.doctors.some(doctor => doctor.id === draft.doctorId)) return '병원과 담당의를 확인해 주세요.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || draft.date < today()) return '오늘 이후 날짜를 선택해 주세요.';
  if (!available(draft, doctorBooked, editingId, now).includes(draft.time)) return '예약 가능한 시간을 선택해 주세요.';
  if (mine.some(item => item.id !== editingId && item.status === 'active' && item.date === draft.date && item.time === draft.time)) return '같은 시간에 다른 예약이 있습니다.';
  return '';
}
