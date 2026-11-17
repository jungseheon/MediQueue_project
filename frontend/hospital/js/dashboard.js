// 진료실 대기열 대시보드
// 사용 API: GET /api/appointments, GET /api/doctors/:id/queue, GET /api/doctors/:id/stream(SSE),
//          PATCH /api/queue-entries/:id/status, POST /api/queue-entries/:id/(call|disappear|return)

const state = {
  appointments: [],
  doctorId: null,
  queue: [], // GET /api/doctors/:id/queue 의 queue
  generatedAt: null,
  tab: "queue", // queue | today
  showAll: false, // 모바일 "더 보기"
  lastEwma: null, // 진료 완료 응답의 updatedEWMA
  stream: null, // 선택한 의사의 SSE 연결
};

const $ = (id) => document.getElementById(id);
const MOBILE_PREVIEW = 4;

function apptById(id) {
  return state.appointments.find((a) => a.id === id);
}

function doctorAppointments() {
  return state.appointments.filter((a) => a.doctorId === state.doctorId);
}

function currentPatient() {
  return doctorAppointments().find((a) => a.queueEntry && a.queueEntry.status === "in_progress");
}

// 대기열 항목 + 예약 정보 (환자 이름, 호출 시각)
function queueRows() {
  return state.queue.map((q) => {
    const appt = apptById(q.appointmentId);
    return { ...q, appt, calledAt: appt && appt.queueEntry ? appt.queueEntry.calledAt : null };
  });
}

// 데이터 불러오기
async function load() {
  try {
    state.appointments = await Api.getAppointments();
    fillDoctorSelect();
    if (state.doctorId) {
      const data = await Api.getQueue(state.doctorId);
      state.queue = data.queue;
      state.generatedAt = data.generatedAt;
    }
    render();
  } catch (e) {
    alert("데이터를 불러오지 못했습니다: " + e.message);
  }
}

// 선택한 의사의 대기열이 다른 화면에서 바뀌면(진료 시작·완료) 바로 다시 불러온다
function subscribe() {
  if (state.stream) state.stream.close();
  state.stream = state.doctorId ? Api.subscribeQueue(state.doctorId) : null;
  if (!state.stream) return;
  state.stream.onmessage = (e) => {
    const event = JSON.parse(e.data);
    if (event.type !== "QUEUE_UPDATED") return;
    if (event.updatedEWMA != null) state.lastEwma = event.updatedEWMA;
    load();
  };
}

// 의사 목록 API가 없어 예약 목록에 있는 의사들로 진료실 선택지를 만든다
function fillDoctorSelect() {
  const doctors = new Map();
  state.appointments.forEach((a) => doctors.set(a.doctor.id, a.doctor));
  const list = [...doctors.values()].sort((a, b) => Number(a.id) - Number(b.id));

  if (!state.doctorId) {
    const saved = localStorage.getItem("mq.doctorId");
    state.doctorId = doctors.has(saved) ? saved : list[0] ? list[0].id : null;
  }

  $("doctorSelect").innerHTML = list
    .map((d) => `<option value="${d.id}">${escapeHtml(d.department)} · ${escapeHtml(d.displayName)}</option>`)
    .join("");
  $("doctorSelect").value = state.doctorId;
}

// ---------- 화면 그리기 ----------
function render() {
  const now = state.generatedAt ? new Date(state.generatedAt) : new Date();
  $("headDate").textContent = `${fmtDateLabel(dateKey(now))} 진료 · ${fmtTime(now)} 기준`;

  renderCurrent();
  renderStats();
  renderList();
}

function renderCurrent() {
  const cur = currentPatient();
  const rows = queueRows();

  if (cur) {
    $("curName").textContent = `#${cur.id} · ${patientName(cur)}`;
    $("curMeta").textContent = `예약 ${fmtTime(cur.scheduledAt)} · 진료 시작 ${fmtTime(cur.queueEntry.startedAt)}`;
  } else {
    $("curName").textContent = "진료 중인 환자 없음";
    $("curMeta").textContent = "";
  }
  updateElapsed();

  // 버튼 활성화 조건
  $("btnStart").disabled = !!cur || rows.length === 0;
  $("btnComplete").disabled = !cur;
  $("btnCall").disabled = rows.length === 0;
  $("btnDisappear").disabled = !rows.some((r) => r.calledAt);
}

function updateElapsed() {
  const cur = currentPatient();
  if (!cur || !cur.queueEntry.startedAt) {
    $("curElapsed").textContent = "--:--";
    return;
  }
  const sec = Math.max(0, Math.floor((Date.now() - new Date(cur.queueEntry.startedAt)) / 1000));
  const mm = String(Math.floor(sec / 60)).padStart(2, "0");
  const ss = String(sec % 60).padStart(2, "0");
  $("curElapsed").textContent = `${mm}:${ss}`;
}

function renderStats() {
  const today = dateKey(new Date());
  const done = doctorAppointments().filter(
    (a) => a.queueEntry && a.queueEntry.status === "completed" && a.queueEntry.completedAt && dateKey(a.queueEntry.completedAt) === today,
  ).length;
  const delays = state.queue.map((q) => q.delayMinutes);
  const avgDelay = delays.length ? Math.round(delays.reduce((s, v) => s + v, 0) / delays.length) : 0;

  $("statWaiting").textContent = `${state.queue.length}명`;
  $("statDone").textContent = `${done}명`;
  $("statEwma").textContent = state.lastEwma != null ? `${state.lastEwma}분` : "—";
  $("statDelay").textContent = `+${avgDelay}분`;
}

function delayCell(minutes) {
  if (minutes == null) return "—";
  if (minutes >= DELAY_ALERT_MINUTES) return `<span class="bold">${delayText(minutes)} · 알림 발송</span>`;
  return delayText(minutes);
}

function actionButtons(status, queueEntryId) {
  if (status === "disappeared")
    return `<button class="btn sm" data-act="call" data-id="${queueEntryId}">호출</button><button class="btn sm" data-act="return" data-id="${queueEntryId}">복귀</button>`;
  if (status === "checked_in") return `<button class="btn sm" data-act="call" data-id="${queueEntryId}">호출</button>`;
  return "";
}

// 목록에 보여줄 행 (실시간 대기 / 오늘 전체)
function listItems() {
  if (state.tab === "queue") {
    return queueRows().map((r, i) => ({
      order: i + 1,
      name: patientName(r.appt),
      apptId: r.appointmentId,
      scheduledAt: r.scheduledAt,
      estimated: r.estimatedStartTime,
      delay: r.delayMinutes,
      arrival: r.status === "disappeared" ? "부재" : r.calledAt ? "도착 · 호출됨" : "도착",
      status: r.status,
      queueEntryId: r.id,
    }));
  }

  // 오늘 전체: 선택한 의사의 오늘 예약 전부
  const today = dateKey(new Date());
  const estimates = new Map(state.queue.map((q) => [q.appointmentId, q]));
  return doctorAppointments()
    .filter((a) => dateKey(a.scheduledAt) === today)
    .map((a) => {
      const st = viewStatus(a);
      const est = estimates.get(a.id);
      return {
        order: a.queueEntry && a.queueEntry.queuePosition ? a.queueEntry.queuePosition : "—",
        name: patientName(a),
        apptId: a.id,
        scheduledAt: a.scheduledAt,
        estimated: est ? est.estimatedStartTime : a.queueEntry && a.queueEntry.startedAt,
        delay: est ? est.delayMinutes : null,
        arrival: st === "booked" ? "미도착" : QUEUE_STATUS_LABEL[st],
        status: st,
        queueEntryId: a.queueEntry && a.queueEntry.id,
      };
    });
}

function renderList() {
  const items = listItems();
  const title = state.tab === "queue" ? "실시간 대기 환자" : "오늘 전체 환자";
  $("listTitle").textContent = window.innerWidth <= 768 ? `${title} (${items.length})` : `${title} 목록`;

  // PC 표
  $("tableBody").innerHTML = items.length
    ? items
        .map(
          (it) => `<tr>
        <td>${it.order}</td>
        <td>#${it.apptId} · ${escapeHtml(it.name)}</td>
        <td>${fmtTime(it.scheduledAt)}</td>
        <td>${fmtTime(it.estimated)}</td>
        <td>${delayCell(it.delay)}</td>
        <td>${it.arrival}</td>
        <td class="right">${actionButtons(it.status, it.queueEntryId)}</td>
      </tr>`,
        )
        .join("")
    : `<tr><td colspan="7" class="empty">대기 중인 환자가 없습니다.</td></tr>`;

  // 모바일 카드
  const visible = state.showAll ? items : items.slice(0, MOBILE_PREVIEW);
  let html = visible
    .map(
      (it) => `<div class="m-item"><div class="row">
        <span class="num">${it.order}</span>
        <div style="flex:1">
          <div class="title">#${it.apptId} · ${escapeHtml(it.name)}</div>
          <div class="desc">예약 ${fmtTime(it.scheduledAt)} → 예상 ${fmtTime(it.estimated)} · ${
            it.delay >= DELAY_ALERT_MINUTES ? `<b>${delayText(it.delay)} 알림</b>` : it.delay != null ? delayText(it.delay) : ""
          } · ${it.arrival}</div>
        </div>
        ${actionButtons(it.status, it.queueEntryId)}
      </div></div>`,
    )
    .join("");
  if (!items.length) html = `<div class="empty">대기 중인 환자가 없습니다.</div>`;
  if (!state.showAll && items.length > MOBILE_PREVIEW) {
    html += `<button class="btn more-btn" id="moreBtn">${items.length - MOBILE_PREVIEW}명 더 보기</button>`;
  }
  $("mobileList").innerHTML = html;
}

// 상태 변경 버튼
async function run(action) {
  try {
    await action();
  } catch (e) {
    alert(e.message);
  }
  await load();
}

// 진료 시작: 호출된 환자가 있으면 그 환자, 없으면 대기 1번
$("btnStart").onclick = () =>
  run(async () => {
    const rows = queueRows();
    const target = rows.find((r) => r.calledAt) || rows[0];
    await Api.setQueueStatus(target.id, "in_progress");
  });

// 진료 완료: EWMA 갱신 + 남은 대기자 예상시간 재계산(백엔드)
$("btnComplete").onclick = () =>
  run(async () => {
    const cur = currentPatient();
    const result = await Api.setQueueStatus(cur.queueEntry.id, "completed");
    if (result.updatedEWMA != null) state.lastEwma = result.updatedEWMA;
  });

// 다음 환자 호출: 아직 호출하지 않은 첫 대기 환자
$("btnCall").onclick = () =>
  run(async () => {
    const rows = queueRows();
    const target = rows.find((r) => r.status === "checked_in" && !r.calledAt) || rows[0];
    const result = await Api.call(target.id);
    alert(result.callMessage);
  });

// 부재 처리: 호출된 환자 중 첫 번째 (기본 2칸 뒤로)
$("btnDisappear").onclick = () =>
  run(async () => {
    const target = queueRows().find((r) => r.calledAt);
    if (!confirm(`${patientName(target.appt)} 환자를 부재 처리할까요? (순번 2칸 뒤로)`)) return;
    const result = await Api.disappear(target.id);
    alert(result.message);
  });

// 목록의 호출 / 복귀 버튼
document.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (btn) {
    const id = btn.dataset.id;
    if (btn.dataset.act === "call") run(async () => alert((await Api.call(id)).callMessage));
    if (btn.dataset.act === "return") run(async () => alert((await Api.returnToQueue(id)).message));
  }
  if (e.target.id === "moreBtn") {
    state.showAll = true;
    renderList();
  }
});

// 탭 전환
document.querySelectorAll("[data-tab]").forEach((btn) => {
  btn.onclick = () => {
    state.tab = btn.dataset.tab;
    document.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b === btn));
    renderList();
  };
});

// 진료실 변경
$("doctorSelect").onchange = (e) => {
  state.doctorId = e.target.value;
  state.lastEwma = null;
  state.showAll = false;
  localStorage.setItem("mq.doctorId", state.doctorId);
  subscribe();
  load();
};

window.addEventListener("resize", renderList);
setInterval(updateElapsed, 1000);
// 호출·부재·복귀·체크인은 아직 SSE 이벤트가 없으므로 30초마다 함께 갱신한다
setInterval(load, 30000);
load().then(subscribe);
