import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../../src/app";
import { prisma } from "../../src/prisma";
import {
  truncateAll,
  createDoctor,
  createPatient,
  createAppointment,
  createQueueEntry,
} from "../helpers";

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// 같은 의사에게 오늘 체크인한 환자 count명
async function checkedInQueue(count: number) {
  const doctor = await createDoctor();
  const scheduledAt = new Date(Date.now() - 60_000);
  const entries = [];
  for (let i = 1; i <= count; i++) {
    const patient = await createPatient(`환자${i}`);
    const appt = await createAppointment(doctor.id, patient.id, scheduledAt);
    entries.push(await createQueueEntry(appt.id, i, "CHECKED_IN"));
  }
  return { doctor, entries };
}

const setStatus = (id: bigint, status: string) =>
  request(app).patch(`/api/queue-entries/${id}/status`).send({ status });

describe("GET /api/doctors/:doctorId/queue", () => {
  it("순번대로 예상 시작 시각을 이어서 계산 (기본 설정: 초진 12분 + 준비 1분)", async () => {
    const { doctor, entries } = await checkedInQueue(2);

    const res = await request(app).get(`/api/doctors/${doctor.id}/queue`);

    expect(res.status).toBe(200);
    const queue = res.body.data.queue;
    expect(queue.map((q: { id: string }) => q.id)).toEqual(entries.map((e) => e.id.toString()));
    expect(queue[0]).toMatchObject({ queuePosition: 1, status: "checked_in", isFirstVisit: true, estimatedWaitMinutes: 0 });
    const gap = new Date(queue[1].estimatedStartTime).getTime() - new Date(queue[0].estimatedStartTime).getTime();
    expect(gap).toBe(13 * 60_000);
  });

  it("없는 의사는 404", async () => {
    expect((await request(app).get("/api/doctors/999999/queue")).status).toBe(404);
  });
});

describe("PATCH /api/queue-entries/:id/status", () => {
  it("진료 시작 → 완료 시 실제 진료시간으로 초진 EWMA 갱신", async () => {
    const { doctor, entries } = await checkedInQueue(2);

    const started = await setStatus(entries[0].id, "in_progress");
    expect(started.status).toBe(200);
    expect(started.body.data.updatedEntry.startedAt).toBeTruthy();

    // 15분 동안 진료한 것으로 시작 시각을 앞당김
    await prisma.queueEntry.update({ where: { id: entries[0].id }, data: { startedAt: new Date(Date.now() - 15 * 60_000) } });

    const completed = await setStatus(entries[0].id, "completed");
    expect(completed.status).toBe(200);
    // EWMA = 0.3 × 15 + 0.7 × 12 = 12.9
    expect(completed.body.data.updatedEWMA).toBe(12.9);
    expect(completed.body.data.recalculatedQueue).toHaveLength(1);

    const stat = await prisma.serviceTimeStat.findUnique({
      where: { doctorId_serviceType: { doctorId: doctor.id, serviceType: "FIRST_VISIT" } },
    });
    expect(Number(stat?.ewmaMinutes)).toBe(12.9);
    expect(stat?.sampleCount).toBe(1);
  });

  it("체크인 상태에서 바로 완료, 같은 의사에게 두 명 진료 시작, 두 번 완료는 409", async () => {
    const { entries } = await checkedInQueue(2);

    expect((await setStatus(entries[0].id, "completed")).status).toBe(409);
    expect((await setStatus(entries[0].id, "in_progress")).status).toBe(200);
    expect((await setStatus(entries[1].id, "in_progress")).status).toBe(409);
    expect((await setStatus(entries[0].id, "completed")).status).toBe(200);
    expect((await setStatus(entries[0].id, "completed")).status).toBe(409);
  });

  it("잘못된 상태는 400, 없는 항목은 404", async () => {
    const { entries } = await checkedInQueue(1);
    expect((await setStatus(entries[0].id, "called")).status).toBe(400);
    expect((await setStatus(999999n, "in_progress")).status).toBe(404);
  });
});

describe("POST /api/queue-entries/:id/call", () => {
  it("대기 중인 환자를 호출하면 호출 시각을 기록하고 안내 문구 반환", async () => {
    const { entries } = await checkedInQueue(1);

    const res = await request(app).post(`/api/queue-entries/${entries[0].id}/call`);

    expect(res.status).toBe(200);
    expect(res.body.data.queueEntry.status).toBe("checked_in");
    expect(res.body.data.callMessage).toBe("환자1님, 내과 (테스트의사 의사실)로 들어오세요.");
    expect((await prisma.queueEntry.findUnique({ where: { id: entries[0].id } }))?.calledAt).not.toBeNull();
  });

  it("진료 중인 환자는 409, 없는 항목은 404", async () => {
    const { entries } = await checkedInQueue(1);
    await setStatus(entries[0].id, "in_progress");

    expect((await request(app).post(`/api/queue-entries/${entries[0].id}/call`)).status).toBe(409);
    expect((await request(app).post("/api/queue-entries/999999/call")).status).toBe(404);
  });
});

describe("POST /api/queue-entries/:id/return", () => {
  it("부재 환자를 대기 상태로 되돌리고 호출 기록을 지움", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient("환자1");
    const appt = await createAppointment(doctor.id, patient.id, new Date());
    const entry = await createQueueEntry(appt.id, 3, "DISAPPEARED", { calledAt: new Date() });

    const res = await request(app).post(`/api/queue-entries/${entry.id}/return`);

    expect(res.status).toBe(200);
    expect(res.body.data.updatedEntry).toMatchObject({ status: "checked_in", queuePosition: 3 });
    expect((await prisma.queueEntry.findUnique({ where: { id: entry.id } }))?.calledAt).toBeNull();
  });

  it("부재 상태가 아니면 409", async () => {
    const { entries } = await checkedInQueue(1);
    expect((await request(app).post(`/api/queue-entries/${entries[0].id}/return`)).status).toBe(409);
  });
});

describe("GET /api/doctors/:id/service-time-stats", () => {
  it("통계가 없으면 알고리즘 설정의 기본시간을 isDefault로 반환", async () => {
    const doctor = await createDoctor();
    await prisma.algorithmConfig.create({ data: { doctorId: doctor.id, firstVisitTime: 15, reVisitTime: 6 } });

    const res = await request(app).get(`/api/doctors/${doctor.id}/service-time-stats`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      doctorId: doctor.id.toString(),
      firstVisit: { ewmaMinutes: 15, sampleCount: 0, updatedAt: null, isDefault: true },
      followUp: { ewmaMinutes: 6, sampleCount: 0, updatedAt: null, isDefault: true },
    });
  });

  it("진료 완료로 쌓인 EWMA를 반환", async () => {
    const doctor = await createDoctor();
    await prisma.serviceTimeStat.create({
      data: { doctorId: doctor.id, serviceType: "FOLLOW_UP", ewmaMinutes: 9.4, sampleCount: 7 },
    });

    const res = await request(app).get(`/api/doctors/${doctor.id}/service-time-stats`);

    expect(res.body.data.followUp).toMatchObject({ ewmaMinutes: 9.4, sampleCount: 7, isDefault: false });
    expect(res.body.data.followUp.updatedAt).toBeTruthy();
    expect(res.body.data.firstVisit).toMatchObject({ ewmaMinutes: 12, isDefault: true });
  });

  it("없는 의사는 404", async () => {
    expect((await request(app).get("/api/doctors/999999/service-time-stats")).status).toBe(404);
  });
});
