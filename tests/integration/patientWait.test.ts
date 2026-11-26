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

describe("GET /api/appointments/:id/wait", () => {
  it("대기 중이면 앞 인원과 예상 시간을 본인 것만 반환", async () => {
    const doctor = await createDoctor();
    const scheduledAt = new Date(Date.now() - 60_000);
    const ids = [];
    for (let i = 1; i <= 3; i++) {
      const patient = await createPatient(`환자${i}`);
      const appt = await createAppointment(doctor.id, patient.id, scheduledAt);
      await createQueueEntry(appt.id, i, "CHECKED_IN", { calledAt: i === 3 ? new Date() : undefined });
      ids.push(appt.id.toString());
    }

    const res = await request(app).get(`/api/appointments/${ids[2]}/wait`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      appointmentId: ids[2],
      doctor: { id: doctor.id.toString(), department: "내과" },
      appointmentStatus: "booked",
      queueStatus: "checked_in",
    });
    // 기본 설정(초진 12분 + 준비 1분)으로 앞의 2명이 끝나야 시작
    expect(res.body.data.waiting).toMatchObject({
      queuePosition: 3,
      peopleAhead: 2,
      isCalled: true,
      estimatedWaitMinutes: 26,
    });
    expect(res.body.data.waiting.delayMinutes).toBeGreaterThanOrEqual(26);
    expect(res.body.data.waiting.isDelayed).toBe(true);
    // 다른 환자의 정보는 응답에 없어야 함
    expect(JSON.stringify(res.body)).not.toContain("환자1");
    expect(res.body.data.queue).toBeUndefined();

    const first = await request(app).get(`/api/appointments/${ids[0]}/wait`);
    expect(first.body.data.waiting).toMatchObject({ peopleAhead: 0, estimatedWaitMinutes: 0, isCalled: false });
  });

  it("체크인 전이면 waiting은 null", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient("이환자");
    const appt = await createAppointment(doctor.id, patient.id, new Date(Date.now() + 60 * 60_000));

    const res = await request(app).get(`/api/appointments/${appt.id}/wait`);
    expect(res.status).toBe(200);
    expect(res.body.data.queueStatus).toBeNull();
    expect(res.body.data.waiting).toBeNull();
  });

  it("진료 중·완료 등 대기 상태가 아니면 waiting은 null", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient("이환자");
    const appt = await createAppointment(doctor.id, patient.id);
    await createQueueEntry(appt.id, 1, "IN_PROGRESS");

    const res = await request(app).get(`/api/appointments/${appt.id}/wait`);
    expect(res.body.data.queueStatus).toBe("in_progress");
    expect(res.body.data.waiting).toBeNull();
  });

  it("없는 예약은 404, 잘못된 ID는 400", async () => {
    expect((await request(app).get("/api/appointments/999999/wait")).status).toBe(404);
    expect((await request(app).get("/api/appointments/abc/wait")).status).toBe(400);
  });
});
