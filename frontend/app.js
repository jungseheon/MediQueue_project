import { times, today, shiftDate, formatDate, buildHospitals, searchHospitals, fromApi, applyWait, isCheckedIn, available, validate } from './model.mjs';
import { api } from './api.mjs';

// ---------- 상태 ----------
const settingsKey = 'mediqueue-patient-settings';
let settings = { delay: true, soon: true };
try {
  const saved = JSON.parse(localStorage.getItem(settingsKey));
  if (typeof saved?.delay === 'boolean' && typeof saved?.soon === 'boolean') settings = saved;
} catch { /* 저장소를 못 쓰면 기본값 */ }

let hospitals = [];                                                  // 의사 목록 API로 만든 병원 목록
let patient = null;                                                  // 시연용 환자 정보
let appointments = [];
let load = { status: 'loading', error: '' };                       // 의사·환자·내 예약 불러오기 상태
let slots = { doctorId: null, status: 'idle', error: '', items: [] }; // 선택한 의사의 예약 현황
let busy = false;                                                    // 예약·변경·취소 요청 중
let draft = { hospitalId: null, doctorId: null, date: today(), time: '' }; // 의사 목록을 받은 뒤 첫 병원으로 채움
let editingId = null;
let query = '';
let tab = 'today';

const main = document.querySelector('main');
const dialog = document.querySelector('dialog');

// ---------- 공통 ----------
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const byTime = (first, second) => `${first.date}${first.time}`.localeCompare(`${second.date}${second.time}`);
const upcoming = () => appointments.filter(item => item.status === 'active' && item.date >= today()).sort(byTime);
const hospitalOf = id => hospitals.find(hospital => hospital.id === id);
const doctorName = (hospital, id) => hospital?.doctors.find(doctor => doctor.id === id)?.name ?? '';
const button = (text, action, id = '', primary = false, disabled = false) =>
  `<button class="${primary ? 'primary' : ''}" data-action="${action}" data-id="${escapeHtml(id)}" ${disabled ? 'disabled' : ''}>${text}</button>`;

let noticeTimer;
function notify(message) {
  const notice = document.querySelector('#notice');
  notice.textContent = '';
  clearTimeout(noticeTimer);
  requestAnimationFrame(() => { notice.textContent = message; });
  noticeTimer = setTimeout(() => { notice.textContent = ''; }, 3000);
}

function saveSettings() {
  try { localStorage.setItem(settingsKey, JSON.stringify(settings)); } catch { notify('설정을 저장할 수 없어 이번 화면에서만 유지됩니다.'); }
}

// ---------- 서버 통신 ----------
// 선택한 병원·담당의가 목록에 없으면 첫 병원의 첫 담당의로 맞춘다.
function syncDraft() {
  const hospital = hospitalOf(draft.hospitalId);
  if (hospital?.doctors.some(doctor => doctor.id === draft.doctorId)) return;
  const first = hospital ?? hospitals[0];
  draft = { ...draft, hospitalId: first?.id ?? null, doctorId: first?.doctors[0]?.id ?? null, time: '' };
}

// 의사 목록, 환자 정보, 내 예약을 불러온다.
// quiet: 자동 갱신용. 로딩 표시 없이 바꾸고, 실패하면 기존 화면을 유지한다.
async function loadAppointments({ quiet = false } = {}) {
  if (!quiet) {
    load = { status: 'loading', error: '' };
    render();
  }
  try {
    const [doctors, me, mine] = await Promise.all([api.doctors(), api.patient(), api.myAppointments()]);
    hospitals = buildHospitals(doctors);
    patient = me;
    syncDraft();
    appointments = await attachEstimates(mine.map(item => fromApi(item, hospitals)));
    load = { status: 'ready', error: '' };
  } catch (error) {
    if (quiet) return;
    load = { status: 'error', error: error.message };
  }
  render();
}

// 오늘 체크인한 예약은 환자용 대기 정보 API로 순번·예상 진료 시각을 가져온다.
// 한 건이 실패해도 나머지는 표시한다(실패한 건은 '계산 중').
async function attachEstimates(list) {
  const targets = list.filter(item => item.status === 'active' && item.date === today() && isCheckedIn(item));
  const results = await Promise.allSettled(targets.map(item => api.wait(item.id)));
  const waits = new Map(targets.map((item, index) => [item.id, results[index]]));
  return list.map(item => {
    const result = waits.get(item.id);
    return result?.status === 'fulfilled' ? applyWait(item, result.value) : item;
  });
}

// 진료 진행에 따라 예상 시각이 바뀌므로 30초마다 다시 불러온다.
// 예약 화면에서 입력 중이거나 확인 창이 열려 있으면 화면이 바뀌지 않도록 건너뛴다.
const REFRESH_MS = 30_000;
setInterval(() => {
  const page = location.hash.slice(1) || 'home';
  if (document.hidden || busy || dialog.open || page === 'search' || load.status !== 'ready') return;
  loadAppointments({ quiet: true });
}, REFRESH_MS);

async function loadSlots(force = false) {
  const doctorId = draft.doctorId;
  if (!doctorId) return;
  if (!force && slots.doctorId === doctorId) return; // 오류는 '다시 시도'로만 재요청
  slots = { doctorId, status: 'loading', error: '', items: [] };
  render();
  try {
    const items = (await api.doctorBooked(doctorId)).map(item => fromApi(item, hospitals));
    if (draft.doctorId === doctorId) slots = { doctorId, status: 'ready', error: '', items };
  } catch (error) {
    if (draft.doctorId === doctorId) slots = { doctorId, status: 'error', error: error.message, items: [] };
  }
  render();
}

// ---------- 화면 조각 ----------
function details(item) {
  const hospital = hospitalOf(item.hospitalId);
  const name = item.hospitalName ?? hospital?.name;
  const doctor = item.doctor || doctorName(hospital, item.doctorId);
  return `<dl><dt>병원명</dt><dd>${escapeHtml(name)}</dd><dt>진료일</dt><dd>${formatDate(item.date)}</dd><dt>진료시간</dt><dd>${item.time || '시간을 선택해 주세요'}</dd><dt>담당의</dt><dd>${escapeHtml(doctor)}</dd></dl>`;
}

function empty(text) {
  return `<section class="card empty"><p>${text}</p><a class="button primary" href="#search">병원 검색 · 예약</a></section>`;
}

function loadingCard(text = '예약 정보를 불러오는 중입니다…') {
  return `<section class="card state" aria-busy="true"><span class="spinner" aria-hidden="true"></span><p>${text}</p></section>`;
}

function errorCard(message, action = 'retry') {
  return `<section class="card state error" role="alert"><p><b>정보를 불러오지 못했습니다.</b></p><p class="muted">${escapeHtml(message)}</p>${button('다시 시도', action, '', true)}</section>`;
}

function estimateText(item) {
  if (item.estimate) return { start: item.estimate.start, delay: `${item.estimate.delay}분` };
  return { start: isCheckedIn(item) ? '계산 중' : '체크인 후', delay: '—' };
}

function queueNote(item) {
  if (item.queueStatus === 'in_progress') return '<p><b>진료 중입니다.</b></p>';
  if (isCheckedIn(item)) {
    const estimate = item.estimate;
    const position = estimate ? ` · 대기 ${estimate.position}번 · 내 앞 ${estimate.ahead}명` : '';
    let notice = '';
    if (item.queueStatus === 'disappeared') notice = '<p><b>호출 때 자리에 없어 순서가 뒤로 미뤄졌습니다.</b> 접수처에 도착을 알려 주세요.</p>';
    else if (estimate?.called) notice = '<p><b>진료실에서 호출했습니다.</b> 진료실 앞으로 와 주세요.</p>';
    return `${notice}<p><b>체크인 완료${position}</b> · 체크인 후에는 예약을 변경하거나 취소할 수 없습니다.</p>`;
  }
  if (item.date === today()) return '<p class="muted">병원 도착 후 체크인하면 예상 진료 시각이 표시됩니다.</p>';
  return '';
}

function appointmentCard(item) {
  const { start } = estimateText(item);
  return `<section class="card featured"><h2>${escapeHtml(item.hospitalName)}</h2><p>${escapeHtml(item.doctor)} 의사 · ${escapeHtml(item.department)}</p><span class="badge">${isCheckedIn(item) ? '진료 대기' : '예약 확정'}</span><div class="metrics"><div>예약 시각<strong>${item.time}</strong></div><div>예상 진료<strong>${start}</strong></div></div>${item.estimate?.delay ? `<p><b>예약보다 ${item.estimate.delay}분 지연 예상</b></p>` : ''}${queueNote(item)}<p class="muted">예상 시각은 진료 상황에 따라 달라질 수 있습니다.</p><div class="actions">${button('진료 예정 보기', 'view', item.id, true)}${isCheckedIn(item) ? '' : button('예약 변경 · 취소', 'view', item.id)}</div></section>`;
}

// 홈의 '최근 알림' (알림 설정의 진료 시각 변경·진료 임박 스위치를 따른다)
function homeAlert(item) {
  const estimate = item?.estimate;
  if (!estimate) return '<p class="muted">새로운 알림이 없습니다.</p>';
  const row = (title, text) => `<div class="row"><b>${title}</b><span>${text}</span></div>`;
  if (estimate.called && settings.soon) return row('진료실 호출', '진료실 앞으로 와 주세요.');
  if (estimate.ahead === 0 && settings.soon) return row('진료 임박', `곧 진료 순서입니다. 예상 진료 시각은 ${estimate.start}입니다.`);
  if (estimate.delayed && settings.delay) return row('진료 지연 안내', `예약보다 ${estimate.delay}분 늦은 ${estimate.start}에 진료할 예정입니다.`);
  return row('진료 예정 시각 안내', `예상 진료 시각은 ${estimate.start}입니다.`);
}

// ---------- 화면 ----------
function home() {
  const greeting = patient ? `${escapeHtml(patient.displayName)}님 · ` : '';
  const dateLine = `<p class="muted">${greeting}${new Date().toLocaleDateString('ko-KR', { dateStyle: 'full', timeZone: 'Asia/Seoul' })}</p><h1>오늘의 예약</h1>`;
  if (load.status === 'loading') return dateLine + loadingCard();
  if (load.status === 'error') return dateLine + errorCard(load.error);
  const item = upcoming().find(value => value.date === today());
  const next = upcoming().find(value => value.date > today());
  const alert = homeAlert(item);
  const nextRow = next
    ? `<div class="row"><b>${formatDate(next.date)} ${next.time}</b><span>${escapeHtml(next.hospitalName)} · ${escapeHtml(next.doctor)}</span>${button('상세 보기', 'view', next.id)}</div>`
    : '<p class="muted">예정된 예약이 없습니다.</p>';
  return `${dateLine}${item ? appointmentCard(item) : empty('오늘 예정된 진료가 없습니다.')}<section class="card"><h2>최근 알림</h2>${alert}</section><section class="card"><div class="row"><h2>다음 예약</h2><a class="button" href="#appointments">전체 예약</a></div>${nextRow}</section>`;
}

function timeChoices() {
  if (slots.status === 'loading' || slots.status === 'idle') return '<p class="muted" aria-busy="true"><span class="spinner small" aria-hidden="true"></span> 예약 가능한 시간을 확인하는 중입니다…</p>';
  if (slots.status === 'error') return `<div class="inline-error" role="alert"><p>${escapeHtml(slots.error)}</p>${button('다시 시도', 'retry-slots')}</div>`;
  const open = available(draft, slots.items, editingId);
  if (!open.includes(draft.time)) draft.time = '';
  const pastLabel = time => draft.date === today() && !open.includes(time) && !slots.items.some(item => item.status === 'active' && item.date === draft.date && item.time === time && item.id !== editingId);
  return `<div class="choices">${times.map(time => {
    const ok = open.includes(time);
    return `<button data-action="time" data-id="${time}" class="${draft.time === time ? 'primary' : ''}" aria-pressed="${draft.time === time}" ${ok ? '' : 'disabled'}>${time}${ok ? '' : `<small>${pastLabel(time) ? '지남' : '마감'}</small>`}</button>`;
  }).join('')}</div>`;
}

function search() {
  const title = '<h1>병원 검색 · 예약</h1><p class="muted">병원·진료과 사전 예약</p>';
  if (load.status === 'loading') return title + loadingCard('병원과 의사 정보를 불러오는 중입니다…');
  if (load.status === 'error') return title + errorCard(load.error);
  const hospital = hospitalOf(draft.hospitalId);
  if (!hospital) return title + '<section class="card empty"><p>예약할 수 있는 의사가 없습니다.</p></section>';
  const results = searchHospitals(hospitals, query);
  const dates = Array.from({ length: 5 }, (_, index) => shiftDate(today(), index));
  return `${title}<div class="columns"><section class="card"><h2>병원 검색</h2><form id="search-form" class="search-form"><input id="query" aria-label="병원명, 지역, 진료과 또는 의사 이름" placeholder="병원명, 지역, 진료과 또는 의사 이름"><button class="primary">검색</button></form><p>검색 결과 ${results.length}개</p><div class="results">${results.map(item => `<button class="hospital ${item.id === draft.hospitalId ? 'selected' : ''}" data-action="hospital" data-id="${escapeHtml(item.id)}" aria-pressed="${item.id === draft.hospitalId}"><b>${escapeHtml(item.name)}</b><span>${escapeHtml(item.area)} · 의사 ${item.doctors.length}명</span><i aria-hidden="true">›</i></button>`).join('') || '<p class="empty">검색 결과가 없습니다. 다른 병원명, 지역, 진료과를 입력해 주세요.</p>'}</div></section><section class="card"><h2>${escapeHtml(hospital.name)} ${editingId ? '예약 변경' : '예약'}</h2><p class="muted">${escapeHtml(hospital.area)}</p><label class="field">담당의 선택<select id="doctor">${hospital.doctors.map(doctor => `<option value="${escapeHtml(doctor.id)}" ${doctor.id === draft.doctorId ? 'selected' : ''}>${escapeHtml(doctor.name)} (${escapeHtml(doctor.department)})</option>`).join('')}</select></label><label class="field">날짜 선택<input type="date" id="date" min="${today()}" value="${draft.date}"></label><div class="choices">${dates.map(date => `<button data-action="date" data-id="${date}" class="${draft.date === date ? 'primary' : ''}" aria-pressed="${draft.date === date}">${formatDate(date)}</button>`).join('')}</div><h3>시간 선택</h3>${timeChoices()}<h3>선택한 예약 정보</h3>${details({ ...draft, hospitalName: hospital.name })}${button('예약 내용 확인', 'review', '', true, slots.status !== 'ready')}${editingId ? button('변경 그만하기', 'stop-edit') : ''}</section></div>`;
}

function statusBadge(item) {
  if (item.status === 'cancelled') return '예약 취소';
  if (item.status === 'completed') return '진료 완료';
  if (item.status === 'noshow') return '미방문';
  return '지난 예약';
}

function appointmentSection(item) {
  if (item.status !== 'active' || item.date < today()) {
    return `<section class="card"><h2>${formatDate(item.date)} · ${escapeHtml(item.hospitalName)}</h2>${details(item)}<span class="badge">${statusBadge(item)}</span></section>`;
  }
  const { start, delay } = estimateText(item);
  const locked = isCheckedIn(item);
  const actions = locked ? '' : `<div class="actions">${item.hospitalId ? button('예약 변경', 'edit', item.id, true, busy) : ''}${button('예약 취소', 'cancel', item.id, false, busy)}</div>`;
  return `<section class="card ${tab === 'today' ? 'featured' : ''}"><h2>${formatDate(item.date)} · ${escapeHtml(item.hospitalName)}</h2><div class="metrics appointment-metrics"><div>예상 진료 시각<strong class="large">${start}</strong></div><div>예약 시간<strong>${item.time}</strong></div><div>예상 지연<strong>${delay}</strong></div></div>${queueNote(item)}<div class="columns"><section><h3>예상 시각 안내</h3><p>진료 상황에 따라 예상 시각이 달라질 수 있습니다.</p></section><section><h3>예약 정보</h3>${details(item)}${actions}</section></div></section>`;
}

function myAppointments() {
  const tabs = `<div class="page-head"><h1>내 예약 · 진료 예정</h1>${button('새로고침', 'retry', '', false, load.status === 'loading')}</div><div class="tabs" role="group" aria-label="예약 분류">${[['today', '오늘의 진료'], ['next', '예정된 예약'], ['past', '지난 진료 · 취소']].map(([id, label]) => `<button data-action="tab" data-id="${id}" class="${tab === id ? 'primary' : ''}" aria-pressed="${tab === id}">${label}</button>`).join('')}</div>`;
  const settingsCard = `<section class="card"><h2>알림 설정</h2><p class="muted">시연용 설정이며 실제 알림은 전송되지 않습니다.</p>${[['delay', '진료 시각 변경'], ['soon', '진료 임박']].map(([id, label]) => `<label class="row">${label}<input type="checkbox" role="switch" data-setting="${id}" ${settings[id] ? 'checked' : ''}></label>`).join('')}</section>`;
  if (load.status === 'loading') return tabs + loadingCard() + settingsCard;
  if (load.status === 'error') return tabs + errorCard(load.error) + settingsCard;
  const list = appointments.filter(item => tab === 'past'
    ? item.status !== 'active' || item.date < today()
    : item.status === 'active' && (tab === 'today' ? item.date === today() : item.date > today())).sort(byTime);
  if (tab === 'past') list.reverse();
  return tabs + (list.map(appointmentSection).join('') || empty('해당하는 예약 내역이 없습니다.')) + settingsCard;
}

function render(focus = false) {
  const page = location.hash.slice(1) || 'home';
  main.innerHTML = page === 'search' ? search() : page === 'appointments' ? myAppointments() : home();
  const input = document.querySelector('#query');
  if (input) input.value = query;
  document.querySelectorAll('nav a').forEach(link => {
    if (link.hash === `#${page}`) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (page === 'search') loadSlots();
  if (focus) { main.focus(); window.scrollTo(0, 0); }
}

// ---------- 확인 창 ----------
function showDialog(content) {
  dialog.innerHTML = content;
  if (!dialog.open) dialog.showModal();
}

function reviewDialog(error = '') {
  const confirmText = busy ? '처리 중…' : editingId ? '변경 확정' : '예약 확정';
  return `<h2>예약 내용을 확인해 주세요</h2>${details({ ...draft, hospitalName: hospitalOf(draft.hospitalId).name })}${error ? `<p class="inline-error" role="alert">${escapeHtml(error)}</p>` : ''}<div class="actions">${button('돌아가기', 'close', '', false, busy)}${button(confirmText, 'confirm', '', true, busy)}</div>`;
}

function cancelDialog(item, error = '') {
  return `<h2>예약을 취소할까요?</h2>${details(item)}${error ? `<p class="inline-error" role="alert">${escapeHtml(error)}</p>` : ''}<div class="actions">${button('유지하기', 'close', '', false, busy)}${button(busy ? '처리 중…' : '예약 취소 확정', 'cancel-confirm', item.id, true, busy)}</div>`;
}

dialog.addEventListener('cancel', event => { if (busy) event.preventDefault(); }); // 요청 중 Escape로 닫기 방지

function goAppointments(item) {
  tab = item.date === today() ? 'today' : 'next';
  if (location.hash === '#appointments') render(true);
  else location.hash = 'appointments';
}

// ---------- 예약·변경·취소 ----------
async function confirmBooking() {
  const error = validate(draft, { doctorBooked: slots.items, mine: appointments, hospitals }, editingId);
  if (error) { showDialog(reviewDialog(error)); return; }
  busy = true;
  showDialog(reviewDialog());
  const wasEditing = editingId;
  try {
    const saved = fromApi(wasEditing ? await api.update(wasEditing, draft) : await api.create(draft), hospitals);
    busy = false;
    editingId = null;
    draft.time = '';
    dialog.close();
    notify(wasEditing ? '예약이 변경되었습니다.' : '예약이 확정되었습니다.');
    goAppointments(saved);
    loadSlots(true);
    await loadAppointments();
  } catch (requestError) {
    busy = false;
    showDialog(reviewDialog(requestError.message));
    if (requestError.status === 409 || requestError.status === 404) loadAppointments();
  }
}

async function confirmCancel(item) {
  busy = true;
  showDialog(cancelDialog(item));
  try {
    await api.cancel(item.id);
    busy = false;
    if (editingId === item.id) { editingId = null; draft.time = ''; }
    dialog.close();
    notify('예약이 취소되었습니다.');
    slots.doctorId = null; // 다음에 예약 화면을 열면 다시 조회
    await loadAppointments();
  } catch (requestError) {
    busy = false;
    showDialog(cancelDialog(item, requestError.message));
    if (requestError.status === 409 || requestError.status === 404) loadAppointments();
  }
}

// ---------- 이벤트 ----------
document.addEventListener('submit', event => {
  if (event.target.id !== 'search-form') return;
  event.preventDefault();
  query = document.querySelector('#query').value.trim();
  render();
});

document.addEventListener('change', event => {
  const target = event.target;
  if (target.dataset.setting) { settings[target.dataset.setting] = target.checked; saveSettings(); return; }
  if (target.id === 'date') { draft.date = target.value || today(); draft.time = ''; render(); }
  if (target.id === 'doctor') { draft.doctorId = target.value; draft.time = ''; render(); }
});

document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const { action, id } = target.dataset;
  const item = appointments.find(value => value.id === id);
  switch (action) {
    case 'hospital': {
      const hospital = hospitalOf(id);
      if (!hospital) return;
      draft.hospitalId = id;
      draft.doctorId = hospital.doctors[0].id;
      draft.time = '';
      break;
    }
    case 'date': draft.date = id; draft.time = ''; break;
    case 'time': draft.time = id; break;
    case 'tab': tab = id; break;
    case 'retry': loadAppointments(); return;
    case 'retry-slots': loadSlots(true); return;
    case 'view': if (item) goAppointments(item); return;
    case 'edit':
      if (!item?.hospitalId) return;
      editingId = id;
      draft = { hospitalId: item.hospitalId, doctorId: item.doctorId, date: item.date < today() ? today() : item.date, time: item.time };
      if (location.hash === '#search') render(true); else location.hash = 'search';
      return;
    case 'stop-edit': editingId = null; draft.time = ''; syncDraft(); break;
    case 'review': {
      const error = validate(draft, { doctorBooked: slots.items, mine: appointments, hospitals }, editingId);
      if (error) { notify(error); return; }
      showDialog(reviewDialog());
      return;
    }
    case 'close': dialog.close(); return;
    case 'confirm': confirmBooking(); return;
    case 'cancel': showDialog(cancelDialog(item)); return;
    case 'cancel-confirm': confirmCancel(item); return;
    default: return;
  }
  render();
});

window.addEventListener('hashchange', () => render(true));
loadAppointments();
