import { hospitals, times, today, shiftDate, formatDate, fromApi, estimateFromQueue, isCheckedIn, available, validate } from './model.mjs';
import { api } from './api.mjs';

// ---------- 상태 ----------
const settingsKey = 'mediqueue-patient-settings';
let settings = { delay: true, soon: true };
try {
  const saved = JSON.parse(localStorage.getItem(settingsKey));
  if (typeof saved?.delay === 'boolean' && typeof saved?.soon === 'boolean') settings = saved;
} catch { /* 저장소를 못 쓰면 기본값 */ }

let appointments = [];
let load = { status: 'loading', error: '' };                       // 내 예약 불러오기 상태
let slots = { doctorId: null, status: 'idle', error: '', items: [] }; // 선택한 의사의 예약 현황
let busy = false;                                                    // 예약·변경·취소 요청 중
let draft = { hospitalId: hospitals[0].id, doctorId: hospitals[0].doctors[0].id, date: today(), time: '' };
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
async function loadAppointments() {
  load = { status: 'loading', error: '' };
  render();
  try {
    appointments = (await api.myAppointments()).map(fromApi);
    await attachEstimates();
    load = { status: 'ready', error: '' };
  } catch (error) {
    load = { status: 'error', error: error.message };
  }
  render();
}

// 오늘 체크인한 예약은 대기열 API에서 예상 진료 시각을 가져온다.
async function attachEstimates() {
  const targets = appointments.filter(item => item.status === 'active' && item.date === today() && isCheckedIn(item));
  const doctorIds = [...new Set(targets.map(item => item.doctorId))];
  const results = await Promise.allSettled(doctorIds.map(id => api.queue(id)));
  results.forEach((result, index) => {
    if (result.status !== 'fulfilled') return;
    for (const item of targets.filter(target => target.doctorId === doctorIds[index])) {
      item.estimate = estimateFromQueue(result.value.queue.find(entry => entry.appointmentId === item.id));
    }
  });
}

async function loadSlots(force = false) {
  const doctorId = draft.doctorId;
  if (!force && slots.doctorId === doctorId) return; // 오류는 '다시 시도'로만 재요청
  slots = { doctorId, status: 'loading', error: '', items: [] };
  render();
  try {
    const items = (await api.doctorBooked(doctorId)).map(fromApi);
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
  if (isCheckedIn(item)) return `<p><b>체크인 완료${item.estimate ? ` · 대기 ${item.estimate.position}번` : ''}</b> · 체크인 후에는 예약을 변경하거나 취소할 수 없습니다.</p>`;
  if (item.date === today()) return '<p class="muted">병원 도착 후 체크인하면 예상 진료 시각이 표시됩니다.</p>';
  return '';
}

function appointmentCard(item) {
  const { start } = estimateText(item);
  return `<section class="card featured"><h2>${escapeHtml(item.hospitalName)}</h2><p>${escapeHtml(item.doctor)} 의사 · ${escapeHtml(item.department)}</p><span class="badge">${isCheckedIn(item) ? '진료 대기' : '예약 확정'}</span><div class="metrics"><div>예약 시각<strong>${item.time}</strong></div><div>예상 진료<strong>${start}</strong></div></div>${item.estimate ? `<p><b>예약보다 ${item.estimate.delay}분 지연 예상</b></p>` : ''}${queueNote(item)}<p class="muted">예상 시각은 진료 상황에 따라 달라질 수 있습니다.</p><div class="actions">${button('진료 예정 보기', 'view', item.id, true)}${isCheckedIn(item) ? '' : button('예약 변경 · 취소', 'view', item.id)}</div></section>`;
}

// ---------- 화면 ----------
function home() {
  const dateLine = `<p class="muted">${new Date().toLocaleDateString('ko-KR', { dateStyle: 'full', timeZone: 'Asia/Seoul' })}</p><h1>오늘의 예약</h1>`;
  if (load.status === 'loading') return dateLine + loadingCard();
  if (load.status === 'error') return dateLine + errorCard(load.error);
  const item = upcoming().find(value => value.date === today());
  const next = upcoming().find(value => value.date > today());
  const alert = item?.estimate
    ? `<div class="row"><b>진료 예정 시각 안내</b><span>예상 진료 시각은 ${item.estimate.start}입니다.</span></div>`
    : '<p class="muted">새로운 알림이 없습니다.</p>';
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
  const results = hospitals.filter(item => `${item.name} ${item.area}`.replaceAll(' ', '').includes(query.replaceAll(' ', '')));
  const hospital = hospitalOf(draft.hospitalId);
  const dates = Array.from({ length: 5 }, (_, index) => shiftDate(today(), index));
  return `<h1>병원 검색 · 예약</h1><p class="muted">정신건강의학과 사전 예약</p><div class="columns"><section class="card"><h2>병원 검색</h2><form id="search-form" class="search-form"><input id="query" aria-label="병원명 또는 지역" placeholder="병원명 또는 지역을 입력하세요."><button class="primary">검색</button></form><p>검색 결과 ${results.length}개</p><div class="results">${results.map(item => `<button class="hospital ${item.id === draft.hospitalId ? 'selected' : ''}" data-action="hospital" data-id="${item.id}" aria-pressed="${item.id === draft.hospitalId}"><b>${item.name}</b><span>${item.area}</span><i aria-hidden="true">›</i></button>`).join('') || '<p class="empty">검색 결과가 없습니다. 다른 병원명이나 지역을 입력해 주세요.</p>'}</div></section><section class="card"><h2>${hospital.name} ${editingId ? '예약 변경' : '예약'}</h2><p class="muted">${hospital.area}</p><label class="field">담당의 선택<select id="doctor">${hospital.doctors.map(doctor => `<option value="${doctor.id}" ${doctor.id === draft.doctorId ? 'selected' : ''}>${doctor.name}</option>`).join('')}</select></label><label class="field">날짜 선택<input type="date" id="date" min="${today()}" value="${draft.date}"></label><div class="choices">${dates.map(date => `<button data-action="date" data-id="${date}" class="${draft.date === date ? 'primary' : ''}" aria-pressed="${draft.date === date}">${formatDate(date)}</button>`).join('')}</div><h3>시간 선택</h3>${timeChoices()}<h3>선택한 예약 정보</h3>${details({ ...draft, hospitalName: hospital.name })}${button('예약 내용 확인', 'review', '', true, slots.status !== 'ready')}${editingId ? button('변경 그만하기', 'stop-edit') : ''}</section></div>`;
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
  const error = validate(draft, { doctorBooked: slots.items, mine: appointments }, editingId);
  if (error) { showDialog(reviewDialog(error)); return; }
  busy = true;
  showDialog(reviewDialog());
  const wasEditing = editingId;
  try {
    const saved = fromApi(wasEditing ? await api.update(wasEditing, draft) : await api.create(draft));
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
      editingId = id;
      draft = { hospitalId: item.hospitalId, doctorId: item.doctorId, date: item.date < today() ? today() : item.date, time: item.time };
      if (location.hash === '#search') render(true); else location.hash = 'search';
      return;
    case 'stop-edit': editingId = null; draft.time = ''; break;
    case 'review': {
      const error = validate(draft, { doctorBooked: slots.items, mine: appointments }, editingId);
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
