// 예약 및 환자 관리 - 예약 목록 + 필터
// 사용 API: GET /api/appointments, GET /api/doctors/:id/queue(예상 시작),
//          PATCH /api/appointments/:id(변경), DELETE /api/appointments/:id(취소)

const PAGE_SIZE = 10;

const state = {
  appointments: [],
  estimates: new Map(), // appointmentId → 대기열 예상 정보
  filter: { date: dateKey(new Date()), range: "day", dept: "", doctor: "", status: "all", search: "" },
  page: 1,
  mobileLimit: PAGE_SIZE,
};

const $ = (id) => document.getElementById(id);

const STATUS_CARDS = [
  { key: "all", label: "전체 예약", chip: "전체" },
  { key: "waiting", label: "대기", chip: "대기" },
  { key: "in_progress", label: "진료 중", chip: "진료 중" },
  { key: "completed", label: "진료 완료", chip: "완료" },
  { key: "cancelled", label: "취소 · 부재", chip: "취소·부재" },
];

// ---------- 데이터 불러오기 ----------
async function load() {
  try {
    state.appointments = await Api.getAppointments();

    // 대기 중인 환자가 있는 의사들의 대기열에서 예상 시작시간을 가져온다
    const doctorIds = new Set(
      state.appointments
        .filter((a) => a.queueEntry && ["checked_in", "disappeared"].includes(a.queueEntry.status))
        .map((a) => a.doctorId),
    );
    state.estimates = new Map();
    for (const id of doctorIds) {
      const data = await Api.getQueue(id);
      data.queue.forEach((q) => state.estimates.set(q.appointmentId, q));
    }
    fillSelects();
    render();
  } catch (e) {
    alert("데이터를 불러오지 못했습니다: " + e.message);
  }
}

// 필터
function inRange(appt) {
  const key = dateKey(appt.scheduledAt);
  const { date, range } = state.filter;
  if (range === "day") return key === date;
  if (range === "month") return key.slice(0, 7) === date.slice(0, 7);
  // week: 선택한 날짜가 속한 주(일~토)
  const start = addDays(date, -keyToDate(date).getUTCDay());
  return key >= start && key <= addDays(start, 6);
}

function matchesSearch(appt) {
  const q = state.filter.search.trim().replace(/^#/, "");
  if (!q) return true;
  return appt.patient.displayName.includes(q) || appt.id === q;
}

// 상태 필터를 뺀 나머지 조건 (상태별 건수 계산용)
function baseFiltered() {
  const f = state.filter;
  return state.appointments.filter(
    (a) => inRange(a) && (!f.dept || a.doctor.department === f.dept) && (!f.doctor || a.doctorId === f.doctor) && matchesSearch(a),
  );
}

function inStatus(appt, key) {
  return key === "all" || STATUS_GROUPS[key].includes(viewStatus(appt));
}

function filtered() {
  return baseFiltered().filter((a) => inStatus(a, state.filter.status));
}

function fillSelects() {
  const depts = [...new Set(state.appointments.map((a) => a.doctor.department))].sort();
  const deptHtml = `<option value="">전체</option>` + depts.map((d) => `<option>${escapeHtml(d)}</option>`).join("");
  $("fDept").innerHTML = deptHtml;
  $("mDept").innerHTML = deptHtml.replace(">전체<", ">진료과 전체<");

  const doctors = new Map();
  state.appointments
    .filter((a) => !state.filter.dept || a.doctor.department === state.filter.dept)
    .forEach((a) => doctors.set(a.doctorId, a.doctor));
  const docHtml =
    `<option value="">전체</option>` +
    [...doctors.values()].map((d) => `<option value="${d.id}">${escapeHtml(d.displayName)}</option>`).join("");
  $("fDoctor").innerHTML = docHtml;
  $("mDoctor").innerHTML = docHtml.replace(">전체<", ">담당의 전체<");

  if (state.filter.doctor && !doctors.has(state.filter.doctor)) state.filter.doctor = "";
  syncControls();
}

// PC/모바일 필터 입력값을 state와 맞춘다
function syncControls() {
  const f = state.filter;
  $("fDate").value = f.date;
  $("fDept").value = $("mDept").value = f.dept;
  $("fDoctor").value = $("mDoctor").value = f.doctor;
  $("fStatus").value = f.status;
  if (document.activeElement !== $("fSearch")) $("fSearch").value = f.search;
  if (document.activeElement !== $("mSearch")) $("mSearch").value = f.search;
  document.querySelectorAll("[data-range]").forEach((b) => b.classList.toggle("active", b.dataset.range === f.range));
}

function setFilter(changes) {
  Object.assign(state.filter, changes);
  state.page = 1;
  state.mobileLimit = PAGE_SIZE;
  if ("dept" in changes) fillSelects();
  syncControls();
  render();
}

// ---------- 표시용 값 ----------
function estimatedStart(appt) {
  const est = state.estimates.get(appt.id);
  if (est) return fmtTime(est.estimatedStartTime);
  if (appt.queueEntry && appt.queueEntry.startedAt) return fmtTime(appt.queueEntry.startedAt);
  return "—";
}

function statusText(appt) {
  const st = viewStatus(appt);
  const est = state.estimates.get(appt.id);
  if ((st === "checked_in" || st === "disappeared") && est) {
    const base = `대기 ${appt.queueEntry.queuePosition} · ${st === "disappeared" ? "부재" : "도착"}`;
    return est.delayMinutes >= DELAY_ALERT_MINUTES
      ? `<span class="bold">대기 ${appt.queueEntry.queuePosition} · 지연 +${est.delayMinutes}분</span>`
      : base;
  }
  if (st === "in_progress") return `<span class="bold">진료 중</span>`;
  return QUEUE_STATUS_LABEL[st];
}

// 체크인 전(예약·노쇼) 예약만 변경/취소 가능
function canEdit(appt) {
  return appt.status !== "cancelled" && (!appt.queueEntry || ["booked", "no_show"].includes(appt.queueEntry.status));
}

function manageButtons(appt) {
  return canEdit(appt)
    ? `<button class="btn sm" data-act="edit" data-id="${appt.id}">변경</button><button class="btn sm" data-act="cancel" data-id="${appt.id}">취소</button>`
    : `<button class="btn sm" data-act="detail" data-id="${appt.id}">상세</button>`;
}

// 화면
function render() {
  const base = baseFiltered();
  const list = filtered();
  const f = state.filter;

  // 상태별 건수 (PC 카드 / 모바일 칩)
  const counts = Object.fromEntries(STATUS_CARDS.map((c) => [c.key, base.filter((a) => inStatus(a, c.key)).length]));
  $("statCards").innerHTML = STATUS_CARDS.map(
    (c) => `<div class="card stat clickable ${f.status === c.key ? "selected" : ""}" data-status="${c.key}">
      <div class="label">${c.label}</div><div class="value">${counts[c.key]}</div></div>`,
  ).join("");
  $("chipRow").innerHTML = STATUS_CARDS.map(
    (c) => `<button class="${f.status === c.key ? "active" : ""}" data-status="${c.key}">${c.chip} ${counts[c.key]}</button>`,
  ).join("");

  // 모바일 주간 날짜 선택
  const weekStart = addDays(f.date, -keyToDate(f.date).getUTCDay());
  $("weekStrip").innerHTML = [0, 1, 2, 3, 4, 5, 6]
    .map((i) => {
      const key = addDays(weekStart, i);
      return `<button class="${key === f.date && f.range === "day" ? "active" : ""}" data-day="${key}">${weekdayOf(key)}<b>${Number(key.slice(8))}</b></button>`;
    })
    .join("");

  const rangeLabel = { day: fmtDateLabel(f.date), week: `${fmtDateLabel(weekStart)} 주간`, month: `${Number(f.date.slice(5, 7))}월` }[f.range];
  $("listTitle").textContent = `${rangeLabel} 예약 목록`;

  // PC 표 + 페이지
  const pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
  state.page = Math.min(state.page, pages);
  const pageItems = list.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
  $("tableBody").innerHTML = pageItems.length
    ? pageItems
        .map(
          (a) => `<tr class="${viewStatus(a) === "in_progress" ? "highlight" : ""}">
        <td>#${a.id}</td>
        <td>${escapeHtml(a.patient.displayName)}</td>
        <td>${escapeHtml(a.doctor.department)} · ${escapeHtml(a.doctor.displayName)}</td>
        <td>${f.range === "day" ? "" : fmtDateLabel(dateKey(a.scheduledAt)) + " "}${fmtTime(a.scheduledAt)}</td>
        <td>${estimatedStart(a)}</td>
        <td>${statusText(a)}</td>
        <td class="right">${manageButtons(a)}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="7" class="empty">조건에 맞는 예약이 없습니다.</td></tr>`;

  const from = list.length ? (state.page - 1) * PAGE_SIZE + 1 : 0;
  $("pager").innerHTML = `<span>${list.length}건 중 ${from}–${from + pageItems.length - (list.length ? 1 : 0)}</span>
    <div class="pages">${Array.from({ length: pages }, (_, i) => `<button class="btn sm ${i + 1 === state.page ? "primary" : ""}" data-page="${i + 1}">${i + 1}</button>`).join("")}</div>`;

  // 모바일 카드
  const mItems = list.slice(0, state.mobileLimit);
  let html = mItems
    .map((a) => {
      const st = viewStatus(a);
      const est = estimatedStart(a);
      return `<div class="m-item">
        <div class="row">
          <span class="title">${fmtTime(a.scheduledAt)} · ${escapeHtml(a.patient.displayName)}</span>
          <span class="badge ${st === "in_progress" ? "strong" : ""}">${statusText(a)}</span>
        </div>
        <div class="desc">#${a.id} · ${escapeHtml(a.doctor.department)} ${escapeHtml(a.doctor.displayName)}${est !== "—" ? ` · 예상 ${est}` : ""}</div>
        ${canEdit(a) ? `<div class="btns">${manageButtons(a)}</div>` : ""}
      </div>`;
    })
    .join("");
  if (!list.length) html = `<div class="empty">조건에 맞는 예약이 없습니다.</div>`;
  if (list.length > state.mobileLimit) html += `<button class="btn more-btn" id="moreBtn">더 보기</button>`;
  $("mobileList").innerHTML = html;
}

// ---------- 관리 버튼 ----------
async function onEdit(appt) {
  const cur = `${dateKey(appt.scheduledAt)} ${fmtTime(appt.scheduledAt)}`;
  const input = prompt("변경할 예약 일시를 입력하세요 (YYYY-MM-DD HH:MM)", cur);
  if (!input || input === cur) return;
  const m = input.trim().match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})$/);
  if (!m) return alert("형식이 올바르지 않습니다. 예: 2026-11-12 14:30");
  await Api.updateAppointment(appt.id, { scheduledAt: `${m[1]}T${m[2]}:00+09:00` });
}

async function onCancel(appt) {
  if (!confirm(`#${appt.id} ${appt.patient.displayName} 환자의 예약을 취소할까요?`)) return;
  await Api.cancelAppointment(appt.id);
}

function onDetail(appt) {
  const q = appt.queueEntry;
  alert(
    [
      `예약번호: #${appt.id}`,
      `환자: ${appt.patient.displayName}`,
      `진료과 · 담당의: ${appt.doctor.department} · ${appt.doctor.displayName}`,
      `예약 일시: ${dateKey(appt.scheduledAt)} ${fmtTime(appt.scheduledAt)}`,
      `상태: ${QUEUE_STATUS_LABEL[viewStatus(appt)]}`,
      q ? `도착 ${fmtTime(q.checkedInAt)} / 시작 ${fmtTime(q.startedAt)} / 완료 ${fmtTime(q.completedAt)}` : "",
    ].join("\n"),
  );
}

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-act],[data-status],[data-page],[data-day],[data-range],#moreBtn");
  if (!el) return;

  if (el.dataset.status) return setFilter({ status: el.dataset.status });
  if (el.dataset.range) return setFilter({ range: el.dataset.range });
  if (el.dataset.day) return setFilter({ date: el.dataset.day, range: "day" });
  if (el.dataset.page) {
    state.page = Number(el.dataset.page);
    return render();
  }
  if (el.id === "moreBtn") {
    state.mobileLimit += PAGE_SIZE;
    return render();
  }

  const appt = state.appointments.find((a) => a.id === el.dataset.id);
  if (el.dataset.act === "detail") return onDetail(appt);
  try {
    if (el.dataset.act === "edit") await onEdit(appt);
    if (el.dataset.act === "cancel") await onCancel(appt);
  } catch (err) {
    alert(err.message);
  }
  load();
});

// 필터 입력 (PC / 모바일 공용)
$("fDate").onchange = (e) => e.target.value && setFilter({ date: e.target.value });
$("fDept").onchange = $("mDept").onchange = (e) => setFilter({ dept: e.target.value });
$("fDoctor").onchange = $("mDoctor").onchange = (e) => setFilter({ doctor: e.target.value });
$("fStatus").onchange = (e) => setFilter({ status: e.target.value });
$("fSearch").oninput = $("mSearch").oninput = (e) => setFilter({ search: e.target.value });

load();
