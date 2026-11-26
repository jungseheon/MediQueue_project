// 예측 알고리즘 설정
// 사용 API: GET /api/appointments(모니터링용 진료 기록),
//          GET /api/algorithm-config/:doctorId(설정 조회), PUT /api/algorithm-config/:doctorId(설정 저장)

const state = {
  appointments: [],
  doctorId: null,
  saved: { ...DEFAULT_ALGORITHM_CONFIG }, // 서버에 저장된 설정
  period: "today", // today | week
};

const $ = (id) => document.getElementById(id);
const form = $("configForm");
const FIELDS = Object.keys(DEFAULT_ALGORITHM_CONFIG);

// ---------- 데이터 불러오기 ----------
async function load() {
  try {
    state.appointments = await Api.getAppointments();
    fillDoctorSelect();
    if (state.doctorId) {
      const config = await Api.getConfig(state.doctorId);
      state.saved = { ...DEFAULT_ALGORITHM_CONFIG, ...config };
      fillForm(state.saved);
    }
    renderMonitor();
  } catch (e) {
    alert("데이터를 불러오지 못했습니다: " + e.message);
  }
}

// 대시보드와 같은 방식으로 예약 목록의 의사들로 진료실 선택지를 만든다
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

// ---------- 설정 폼 ----------
function fillForm(config) {
  // 저장된 값이 선택지에 없으면 추가 (예: 최근 15명)
  const select = form.elements.sampleCount;
  if (![...select.options].some((o) => Number(o.value) === config.sampleCount)) {
    select.add(new Option(`최근 ${config.sampleCount}명`, config.sampleCount));
  }
  FIELDS.forEach((f) => (form.elements[f].value = config[f]));
  syncAlpha(config.alpha);
}

function readForm() {
  return Object.fromEntries(FIELDS.map((f) => [f, Number(form.elements[f].value)]));
}

// 슬라이더 ↔ 직접 입력 값 맞추기
function syncAlpha(value) {
  $("alphaRange").value = value;
  form.elements.alpha.value = value;
  $("alphaValue").textContent = Number(value).toFixed(2);
}
$("alphaRange").oninput = (e) => syncAlpha(e.target.value);
form.elements.alpha.oninput = (e) => {
  $("alphaRange").value = e.target.value;
  $("alphaValue").textContent = Number(e.target.value).toFixed(2);
};

// 저장: 백엔드가 범위를 다시 검사하고, 잘못된 값이면 오류 메시지를 보여준다
form.onsubmit = async (e) => {
  e.preventDefault();
  try {
    const saved = await Api.saveConfig(state.doctorId, readForm());
    state.saved = { ...DEFAULT_ALGORITHM_CONFIG, ...saved };
    fillForm(state.saved);
    renderMonitor();
    alert("저장되었습니다. 이후 대기시간 계산에 적용됩니다.");
  } catch (err) {
    alert("저장하지 못했습니다: " + err.message);
  }
};

// 초기화: 폼만 기본값으로 바꾸고, 저장을 눌러야 적용된다
$("btnReset").onclick = () => {
  fillForm(DEFAULT_ALGORITHM_CONFIG);
  alert("기본값으로 바꿨습니다. 저장을 눌러야 적용됩니다.");
};

// ---------- 모니터링 ----------
// 선택한 의사의 기간 내 완료된 진료 (완료 시각 순)
function completedVisits() {
  const today = dateKey(new Date());
  const from = state.period === "today" ? today : addDays(today, -6);
  return state.appointments
    .filter(
      (a) =>
        a.doctorId === state.doctorId &&
        a.queueEntry &&
        a.queueEntry.status === "completed" &&
        a.queueEntry.startedAt &&
        a.queueEntry.completedAt &&
        dateKey(a.queueEntry.completedAt) >= from,
    )
    .sort((a, b) => new Date(a.queueEntry.completedAt) - new Date(b.queueEntry.completedAt));
}

function renderMonitor() {
  const cfg = state.saved;
  const tAvg = (cfg.firstVisitTime + cfg.reVisitTime) / 2;
  const visits = completedVisits();

  // 예측 오차: 초진/재진 기본시간과 실제 진료시간 차이의 평균
  const errors = visits.map((a) => {
    const expected = isFirstVisit(a, state.appointments) ? cfg.firstVisitTime : cfg.reVisitTime;
    return Math.abs(serviceMinutes(a.queueEntry) - expected);
  });
  const last = visits[visits.length - 1];

  $("monitorTitle").textContent = window.innerWidth <= 768 ? `모니터링 · ${state.period === "today" ? "오늘" : "최근 7일"}` : "모니터링";
  $("mAvg").textContent = `${tAvg.toFixed(1)}분`;
  $("mEwma").textContent = "—"; // EWMA 조회 API가 아직 없음
  $("mLast").textContent = last ? `${Math.round(serviceMinutes(last.queueEntry))}분` : "—";
  $("mError").textContent = errors.length ? `±${(errors.reduce((s, v) => s + v, 0) / errors.length).toFixed(1)}분` : "—";

  renderChart(visits, tAvg);
}

// 환자별 실제 진료시간 막대 + Tavg 점선 (SVG)
function renderChart(visits, tAvg) {
  if (!visits.length) {
    $("chart").innerHTML = `<div class="empty">기간 내 완료된 진료가 없습니다.</div>`;
    return;
  }
  const W = 600, H = 200, pad = 24;
  const values = visits.map((a) => serviceMinutes(a.queueEntry));
  const max = Math.max(tAvg, ...values) * 1.2;
  const y = (v) => H - pad - (v / max) * (H - pad * 2);
  const slot = (W - pad * 2) / values.length;
  const barW = Math.min(40, slot * 0.6);

  const bars = values
    .map((v, i) => {
      const x = pad + slot * i + (slot - barW) / 2;
      return `<rect x="${x}" y="${y(v)}" width="${barW}" height="${H - pad - y(v)}" fill="#bbb" />
        <text x="${x + barW / 2}" y="${y(v) - 4}" font-size="11" text-anchor="middle">${Math.round(v)}</text>`;
    })
    .join("");
  $("chart").innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="환자별 실제 진료시간">
    <line x1="${pad}" y1="${H - pad}" x2="${W - pad}" y2="${H - pad}" stroke="#999" />
    ${bars}
    <line x1="${pad}" y1="${y(tAvg)}" x2="${W - pad}" y2="${y(tAvg)}" stroke="#1a1a1a" stroke-dasharray="5 4" />
    <text x="${W - pad}" y="${y(tAvg) - 4}" font-size="11" text-anchor="end">Tavg ${tAvg.toFixed(1)}분</text>
  </svg>`;
}

document.querySelectorAll("[data-period]").forEach((btn) => {
  btn.onclick = () => {
    state.period = btn.dataset.period;
    document.querySelectorAll("[data-period]").forEach((b) => b.classList.toggle("active", b === btn));
    renderMonitor();
  };
});

// 진료실 변경 (대시보드와 같은 선택을 공유)
$("doctorSelect").onchange = (e) => {
  state.doctorId = e.target.value;
  localStorage.setItem("mq.doctorId", state.doctorId);
  load();
};

load();
