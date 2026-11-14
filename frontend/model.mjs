export const hospitals = [
  { id: 'on you', name: '온유 정신건강의학과', area: '서울 강남구', doctors: ['김○○', '이○○'] },
  { id: 'maeum', name: '마음봄 정신건강의학과', area: '서울 마포구', doctors: ['박○○', '최○○'] },
  { id: 'hangyeol', name: '한결 정신건강의학과', area: '서울 서초구', doctors: ['정○○'] }
];
export const times = ['13:30', '14:00', '14:30', '15:00', '15:30'];
export function today() { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }); }
export function shiftDate(value, amount) { const date = new Date(`${value}T12:00:00+09:00`); date.setUTCDate(date.getUTCDate() + amount); return date.toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }); }
export function formatDate(value) { return new Date(`${value}T12:00:00+09:00`).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }); }
export function seed() { return [{ id: 'demo-today', hospitalId: hospitals[0].id, doctor: '김○○', type: '재진', date: today(), time: '14:30', status: 'active', delay: 15 }, { id: 'demo-next', hospitalId: hospitals[0].id, doctor: '김○○', type: '재진', date: shiftDate(today(), 5), time: '15:30', status: 'active', delay: 0 }, { id: 'demo-past', hospitalId: hospitals[1].id, doctor: '박○○', type: '초진', date: shiftDate(today(), -7), time: '14:00', status: 'completed', delay: 0 }]; }
export function isAppointment(value) { return value && typeof value.id === 'string' && hospitals.some(hospital => hospital.id === value.hospitalId && hospital.doctors.includes(value.doctor)) && ['초진', '재진'].includes(value.type) && /^\d{4}-\d{2}-\d{2}$/.test(value.date) && times.includes(value.time) && ['active', 'completed', 'cancelled'].includes(value.status) && Number.isFinite(value.delay) && value.delay >= 0; }
export function available(draft, appointments, editingId) { return times.filter(time => time !== '15:00' && !appointments.some(item => item.id !== editingId && item.status === 'active' && item.hospitalId === draft.hospitalId && item.doctor === draft.doctor && item.date === draft.date && item.time === time)); }
export function validate(draft, appointments, editingId) {
  const hospital = hospitals.find(item => item.id === draft.hospitalId);
  if (!hospital || !hospital.doctors.includes(draft.doctor) || !['초진', '재진'].includes(draft.type)) return '병원과 담당의, 진료 유형을 확인해 주세요.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || draft.date < today()) return '오늘 이후 날짜를 선택해 주세요.';
  if (!available(draft, appointments, editingId).includes(draft.time)) return '예약 가능한 시간을 선택해 주세요.';
  if (appointments.some(item => item.id !== editingId && item.status === 'active' && item.date === draft.date && item.time === draft.time)) return '같은 시간에 다른 예약이 있습니다.';
  return '';
}
export function estimate(item) { const [hours, minutes] = item.time.split(':').map(Number); const total = hours * 60 + minutes + item.delay; return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }
