import { hospitals, times, today, shiftDate, formatDate, seed, isAppointment, available, validate, estimate } from './model.mjs';

const storageKey = 'mediqueue-patient-v1';
let appointments = seed();
let settings = { delay: true, soon: true };
let storageWarning = false;
try {
  const saved = JSON.parse(localStorage.getItem(storageKey));
  if (saved && Array.isArray(saved.appointments) && saved.appointments.every(isAppointment)) {
    appointments = saved.appointments;
    if (typeof saved.settings?.delay === 'boolean' && typeof saved.settings?.soon === 'boolean') settings = saved.settings;
  }
} catch { storageWarning = true; }
let draft = { hospitalId: hospitals[0].id, doctor: hospitals[0].doctors[0], type: '재진', date: today(), time: '' };
let editingId = null;
let query = '';
let tab = 'today';
const main = document.querySelector('main');
const dialog = document.querySelector('dialog');
const hospitalOf = item => hospitals.find(hospital => hospital.id === item.hospitalId);
const active = () => appointments.filter(item => item.status === 'active' && item.date >= today()).sort((first, second) => `${first.date}${first.time}`.localeCompare(`${second.date}${second.time}`));
const button = (text, action, id = '', primary = false) => `<button class="${primary ? 'primary' : ''}" data-action="${action}" data-id="${id}">${text}</button>`;
function notify(message) { document.querySelector('#notice').textContent = message; }
function persist() { try { localStorage.setItem(storageKey, JSON.stringify({ appointments, settings })); return true; } catch { notify('저장 공간을 사용할 수 없어 이번 화면에서만 유지됩니다.'); return false; } }
function details(item) { return `<dl><dt>병원명</dt><dd>${hospitalOf(item).name}</dd><dt>진료일</dt><dd>${formatDate(item.date)}</dd><dt>진료시간</dt><dd>${item.time || '시간을 선택해 주세요'}</dd><dt>진료 유형</dt><dd>${item.type}</dd><dt>담당의</dt><dd>${item.doctor}</dd></dl>`; }
function empty(text) { return `<section class="card empty"><p>${text}</p><a class="button primary" href="#search">병원 검색 · 예약</a></section>`; }
function appointmentCard(item) {
  return `<section class="card featured"><h2>${hospitalOf(item).name}</h2><p>${item.doctor} 의사 · ${item.type}</p><span class="badge">${item.date === today() ? '진료 대기' : '예약 확정'}</span><div class="metrics"><div>예약 시각<strong>${item.time}</strong></div><div>예상 진료<strong>${estimate(item)}</strong></div></div><p><b>예약보다 ${item.delay}분 지연 예상</b></p><p class="muted">시연용 예상 시간입니다. 진료 상황에 따라 달라질 수 있습니다.</p><div class="actions">${button('진료 예정 보기', 'view', item.id, true)}${button('예약 변경 · 취소', 'view', item.id)}</div></section>`;
}
function home() {
  const item = active().find(value => value.date === today());
  const next = active().find(value => value.date > today());
  return `<p class="muted">${new Date().toLocaleDateString('ko-KR', { dateStyle: 'full', timeZone: 'Asia/Seoul' })}</p><h1>오늘의 예약</h1>${item ? appointmentCard(item) : empty('오늘 예정된 진료가 없습니다.')}<section class="card"><h2>최근 알림</h2>${item ? `<div class="row"><b>진료 예정 시각 안내</b><span>예상 진료 시각은 ${estimate(item)}입니다. (시연 데이터)</span></div>` : '<p class="muted">새로운 알림이 없습니다.</p>'}</section><section class="card"><div class="row"><h2>다음 예약</h2><a class="button" href="#appointments">전체 예약</a></div>${next ? `<div class="row"><b>${formatDate(next.date)} ${next.time}</b><span>${hospitalOf(next).name} · ${next.type}</span>${button('상세 보기', 'view', next.id)}</div>` : '<p class="muted">예정된 예약이 없습니다.</p>'}</section>`;
}
function search() {
  const results = hospitals.filter(item => `${item.name} ${item.area}`.replaceAll(' ', '').includes(query.replaceAll(' ', '')));
  const hospital = hospitalOf(draft);
  const slots = available(draft, appointments, editingId);
  if (!slots.includes(draft.time)) draft.time = '';
  return `<h1>병원 검색 · 예약</h1><p class="muted">정신건강의학과 사전 예약</p><div class="columns"><section class="card"><h2>병원 검색</h2><form id="search-form" class="search-form"><input id="query" aria-label="병원명 또는 지역" placeholder="병원명 또는 지역을 입력하세요."><button class="primary">검색</button></form><p>검색 결과 ${results.length}개</p><div class="results">${results.map(item => `<button class="hospital ${item.id === draft.hospitalId ? 'selected' : ''}" data-action="hospital" data-id="${item.id}" aria-pressed="${item.id === draft.hospitalId}"><b>${item.name}</b><span>${item.area}</span><i aria-hidden="true">›</i></button>`).join('') || '<p class="empty">검색 결과가 없습니다. 다른 병원명이나 지역을 입력해 주세요.</p>'}</div></section><section class="card"><h2>${hospital.name} ${editingId ? '예약 변경' : '예약'}</h2><p class="muted">${hospital.area}</p><fieldset><legend>진료 유형</legend>${['초진', '재진'].map(type => `<label class="radio"><input type="radio" name="type" value="${type}" ${type === draft.type ? 'checked' : ''}> ${type}</label>`).join('')}</fieldset><label class="field">담당의 선택<select id="doctor">${hospital.doctors.map(doctor => `<option ${doctor === draft.doctor ? 'selected' : ''}>${doctor}</option>`).join('')}</select></label><label class="field">날짜 선택<input type="date" id="date" min="${today()}" value="${draft.date}"></label><div class="choices">${Array.from({ length: 5 }, (_, index) => shiftDate(draft.date, index)).map(date => `<button data-action="date" data-id="${date}" class="${draft.date === date ? 'primary' : ''}" aria-pressed="${draft.date === date}">${formatDate(date)}</button>`).join('')}</div><h3>시간 선택</h3><div class="choices">${times.map(time => `<button data-action="time" data-id="${time}" class="${draft.time === time ? 'primary' : ''}" aria-pressed="${draft.time === time}" ${slots.includes(time) ? '' : 'disabled'}>${time}${slots.includes(time) ? '' : '<small>마감</small>'}</button>`).join('')}</div><h3>선택한 예약 정보</h3>${details(draft)}${button('예약 내용 확인', 'review', '', true)}${editingId ? button('변경 그만하기', 'stop-edit') : ''}</section></div>`;
}
function myAppointments() {
  const list = appointments.filter(item => tab === 'past' ? item.status !== 'active' || item.date < today() : item.status === 'active' && (tab === 'today' ? item.date === today() : item.date > today())).sort((first, second) => `${first.date}${first.time}`.localeCompare(`${second.date}${second.time}`));
  return `<h1>내 예약 · 진료 예정</h1><div class="tabs" role="group" aria-label="예약 분류">${[['today', '오늘의 진료'], ['next', '예정된 예약'], ['past', '지난 진료 · 취소']].map(([id, label]) => `<button data-action="tab" data-id="${id}" class="${tab === id ? 'primary' : ''}" aria-pressed="${tab === id}">${label}</button>`).join('')}</div>${list.map(item => `<section class="card ${tab === 'today' ? 'featured' : ''}"><h2>${formatDate(item.date)} · ${hospitalOf(item).name} · ${item.type}</h2>${item.status === 'active' && item.date >= today() ? `<div class="metrics appointment-metrics"><div>예상 진료 시각<strong class="large">${estimate(item)}</strong></div><div>예약 시간<strong>${item.time}</strong></div><div>예상 지연<strong>${item.delay}분</strong></div></div><p class="muted">시연용 데이터 · 실제 진료 상태와 연동되지 않습니다.</p><div class="columns"><section><h3>예상 시각 안내</h3><p>진료 상황에 따라 예상 시각이 달라질 수 있습니다.</p></section><section><h3>예약 정보</h3>${details(item)}<div class="actions">${button('예약 변경', 'edit', item.id, true)}${button('예약 취소', 'cancel', item.id)}</div></section></div>` : `${details(item)}<span class="badge">${item.status === 'cancelled' ? '예약 취소' : '진료 완료'}</span>`}</section>`).join('') || empty('해당하는 예약 내역이 없습니다.')}<section class="card"><h2>알림 설정</h2><p class="muted">시연용 설정이며 실제 알림은 전송되지 않습니다.</p>${[['delay', '진료 시각 변경'], ['soon', '진료 임박']].map(([id, label]) => `<label class="row">${label}<input type="checkbox" role="switch" data-setting="${id}" ${settings[id] ? 'checked' : ''}></label>`).join('')}</section>`;
}
function render(focus = false) {
  const page = location.hash.slice(1) || 'home';
  main.innerHTML = page === 'search' ? search() : page === 'appointments' ? myAppointments() : home();
  const input = document.querySelector('#query');
  if (input) input.value = query;
  document.querySelectorAll('nav a').forEach(link => { if (link.hash === `#${page}`) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current'); });
  if (focus) { main.focus(); window.scrollTo(0, 0); }
}
function showDialog(content) { dialog.innerHTML = content; dialog.showModal(); }
function goAppointments(item) { tab = item.date === today() ? 'today' : 'next'; location.hash = 'appointments'; render(true); }
document.addEventListener('submit', event => { if (event.target.id === 'search-form') { event.preventDefault(); query = document.querySelector('#query').value.trim(); render(); } });
document.addEventListener('change', event => {
  const target = event.target;
  if (target.dataset.setting) { settings[target.dataset.setting] = target.checked; persist(); return; }
  if (target.id === 'date') { draft.date = target.value || today(); draft.time = ''; render(); }
  if (target.id === 'doctor') { draft.doctor = target.value; draft.time = ''; render(); }
  if (target.name === 'type') { draft.type = target.value; render(); }
});
document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { action, id } = target.dataset;
  const item = appointments.find(value => value.id === id);
  if (action === 'hospital') { const hospital = hospitals.find(value => value.id === id); draft.hospitalId = id; draft.doctor = hospital.doctors[0]; draft.time = ''; }
  if (action === 'date') { draft.date = id; draft.time = ''; }
  if (action === 'time') draft.time = id;
  if (action === 'tab') tab = id;
  if (action === 'view') { goAppointments(item); return; }
  if (action === 'edit') { editingId = id; draft = { ...item }; location.hash = 'search'; render(true); return; }
  if (action === 'stop-edit') { editingId = null; draft.time = ''; }
  if (action === 'review') {
    const error = validate(draft, appointments, editingId);
    if (error) { notify(error); return; }
    showDialog(`<h2>예약 내용을 확인해 주세요</h2>${details(draft)}<p class="muted">시연용 예약이며 실제 병원으로 전송되지 않습니다.</p><div class="actions">${button('돌아가기', 'close')}${button(editingId ? '변경 확정' : '예약 확정', 'confirm', '', true)}</div>`); return;
  }
  if (action === 'close') { dialog.close(); return; }
  if (action === 'confirm') {
    const error = validate(draft, appointments, editingId);
    if (error) { dialog.close(); notify(error); return; }
    const booked = { ...draft, id: editingId || crypto.randomUUID(), status: 'active', delay: 0 };
    appointments = editingId ? appointments.map(value => value.id === editingId ? booked : value) : [...appointments, booked];
    editingId = null; draft.time = ''; dialog.close(); const saved = persist(); goAppointments(booked); if (saved) notify('예약이 확정되었습니다. (시연용)'); return;
  }
  if (action === 'cancel') { showDialog(`<h2>예약을 취소할까요?</h2>${details(item)}<div class="actions">${button('유지하기', 'close')}${button('예약 취소 확정', 'cancel-confirm', id, true)}</div>`); return; }
  if (action === 'cancel-confirm') { item.status = 'cancelled'; dialog.close(); const saved = persist(); if (saved) notify('예약이 취소되었습니다.'); }
  render();
});
window.addEventListener('hashchange', () => render(true));
render();
if (storageWarning) notify('저장된 정보를 읽지 못해 시연 데이터를 표시합니다.');
