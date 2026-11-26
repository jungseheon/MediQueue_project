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

const HOUR = 60 * 60_000;

async function setup() {
  const doctor = await createDoctor("김의사", "내과");
  const patient = await createPatient("이환자");
  return { doctor, patient };
}

describe("POST /api/appointments", () => {
  it("booked 상태로 생성하고 의사·환자 정보를 함께 반환", async () => {
    const { doctor, patient } = await setup();

    const res = await request(app)
      .post("/api/appointments")
      .send({ doctorId: doctor.id.toString(), patientId: Number(patient.id), scheduledAt: "2026-12-01T09:30:00+09:00" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      doctorId: doctor.id.toString(),
      patientId: patient.id.toString(),
      scheduledAt: "2026-12-01T00:30:00.000Z",
      status: "booked",
      doctor: { displayName: "김의사", department: "내과" },
      patient: { displayName: "이환자" },
      queueEntry: null,
    });
  });

  it("필드 누락·잘못된 형식은 400, 없는 의사·환자는 400", async () => {
    const { doctor, patient } = await setup();
    const valid = { doctorId: doctor.id.toString(), patientId: patient.id.toString(), scheduledAt: "2026-12-01T09:30:00+09:00" };

    for (const body of [{}, { ...valid, scheduledAt: "내일" }, { ...valid, doctorId: "0" }, { ...valid, doctorId: "999999" }, { ...valid, patientId: "999999" }]) {
      const res = await request(app).post("/api/appointments").send(body);
      expect(res.status).toBe(400);
    }
    expect(await prisma.appointment.count()).toBe(0);
  });
});

describe("GET /api/appointments", () => {
  it("의사·환자·상태로 필터하고 예약 시각 순으로 정렬", async () => {
    const { doctor, patient } = await setup();
    const otherDoctor = await createDoctor("박의사", "외과");
    const later = await createAppointment(doctor.id, patient.id, new Date(Date.now() + 2 * HOUR));
    const earlier = await createAppointment(doctor.id, patient.id, new Date(Date.now() + HOUR));
    await createAppointment(otherDoctor.id, patient.id, new Date(Date.now() + HOUR));
    await prisma.appointment.update({ where: { id: later.id }, data: { status: "CANCELLED" } });

    const byDoctor = await request(app).get("/api/appointments").query({ doctorId: doctor.id.toString() });
    expect(byDoctor.body.data.map((a: { id: string }) => a.id)).toEqual([earlier.id.toString(), later.id.toString()]);

    const booked = await request(app).get("/api/appointments").query({ doctorId: doctor.id.toString(), status: "booked" });
    expect(booked.body.data).toHaveLength(1);

    const byPatient = await request(app).get("/api/appointments").query({ patientId: patient.id.toString() });
    expect(byPatient.body.data).toHaveLength(3);

    expect((await request(app).get("/api/appointments").query({ status: "done" })).status).toBe(400);
    expect((await request(app).get("/api/appointments").query({ doctorId: "abc" })).status).toBe(400);
  });

  it("상세 조회, 없는 예약은 404", async () => {
    const { doctor, patient } = await setup();
    const appt = await createAppointment(doctor.id, patient.id, new Date(Date.now() + HOUR));

    const res = await request(app).get(`/api/appointments/${appt.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(appt.id.toString());
    expect((await request(app).get("/api/appointments/999999")).status).toBe(404);
  });
});

describe("PATCH /api/appointments/:id", () => {
  it("보낸 필드만 수정, 수정할 필드가 없으면 400", async () => {
    const { doctor, patient } = await setup();
    const appt = await createAppointment(doctor.id, patient.id, new Date(Date.now() + HOUR));

    const res = await request(app).patch(`/api/appointments/${appt.id}`).send({ scheduledAt: "2026-12-02T10:00:00+09:00" });
    expect(res.status).toBe(200);
    expect(res.body.data.scheduledAt).toBe("2026-12-02T01:00:00.000Z");
    expect(res.body.data.doctorId).toBe(doctor.id.toString());

    expect((await request(app).patch(`/api/appointments/${appt.id}`).send({})).status).toBe(400);
    expect((await request(app).patch("/api/appointments/999999").send({ scheduledAt: "2026-12-02T10:00:00+09:00" })).status).toBe(404);
  });

  it("취소된 예약은 되살리거나 변경할 수 없음", async () => {
    const { doctor, patient } = await setup();
    const appt = await createAppointment(doctor.id, patient.id, new Date(Date.now() + HOUR));
    await request(app).delete(`/api/appointments/${appt.id}`);

    expect((await request(app).patch(`/api/appointments/${appt.id}`).send({ status: "booked" })).status).toBe(409);
    expect((await request(app).patch(`/api/appointments/${appt.id}`).send({ scheduledAt: "2026-12-02T10:00:00+09:00" })).status).toBe(409);
  });

  it("체크인 이후에는 변경할 수 없음", async () => {
    const { doctor, patient } = await setup();
    const appt = await createAppointment(doctor.id, patient.id, new Date());
    await createQueueEntry(appt.id, 1, "CHECKED_IN");

    const res = await request(app).patch(`/api/appointments/${appt.id}`).send({ scheduledAt: "2026-12-02T10:00:00+09:00" });
    expect(res.status).toBe(409);
  });

  it("노쇼된 예약을 다른 시각으로 바꾸면 대기 항목이 booked로 돌아감", async () => {
    const { doctor, patient } = await setup();
    const appt = await createAppointment(doctor.id, patient.id, new Date(Date.now() - HOUR));
    await createQueueEntry(appt.id, 0, "NO_SHOW");

    const res = await request(app)
      .patch(`/api/appointments/${appt.id}`)
      .send({ scheduledAt: new Date(Date.now() + 24 * HOUR).toISOString() });

    expect(res.status).toBe(200);
    expect(res.body.data.queueEntry.status).toBe("booked");
  });
});

describe("DELETE /api/appointments/:id", () => {
  it("삭제하지 않고 cancelled로 바꾸며 대기 항목도 취소", async () => {
    const { doctor, patient } = await setup();
    const appt = await createAppointment(doctor.id, patient.id, new Date(Date.now() + HOUR));
    await createQueueEntry(appt.id, 0, "BOOKED");

    const res = await request(app).delete(`/api/appointments/${appt.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("cancelled");
    expect(res.body.data.queueEntry.status).toBe("cancelled");
    expect(await prisma.appointment.count()).toBe(1);
  });

  it("체크인한 예약은 409, 없는 예약은 404", async () => {
    const { doctor, patient } = await setup();
    const appt = await createAppointment(doctor.id, patient.id, new Date());
    await createQueueEntry(appt.id, 1, "CHECKED_IN");

    expect((await request(app).delete(`/api/appointments/${appt.id}`)).status).toBe(409);
    expect((await request(app).delete("/api/appointments/999999")).status).toBe(404);
  });
});

describe("POST /api/appointments/:id/check-in", () => {
  it("의사별로 당일 순번을 1번부터 차례로 발급", async () => {
    const { doctor, patient } = await setup();
    const second = await createPatient("최환자");
    const a1 = await createAppointment(doctor.id, patient.id, new Date());
    const a2 = await createAppointment(doctor.id, second.id, new Date());

    const r1 = await request(app).post(`/api/appointments/${a1.id}/check-in`);
    const r2 = await request(app).post(`/api/appointments/${a2.id}/check-in`);

    expect(r1.status).toBe(200);
    expect(r1.body.data.queueEntry).toMatchObject({ queuePosition: 1, status: "checked_in" });
    expect(r1.body.data.queueEntry.checkedInAt).toBeTruthy();
    expect(r2.body.data.queueEntry.queuePosition).toBe(2);
  });

  it("다른 의사의 순번은 따로 매김", async () => {
    const { doctor, patient } = await setup();
    const otherDoctor = await createDoctor("박의사", "외과");
    await request(app).post(`/api/appointments/${(await createAppointment(doctor.id, patient.id, new Date())).id}/check-in`);

    const res = await request(app).post(`/api/appointments/${(await createAppointment(otherDoctor.id, patient.id, new Date())).id}/check-in`);
    expect(res.body.data.queueEntry.queuePosition).toBe(1);
  });

  it("중복·취소·다른 날 예약은 409, 없는 예약은 404", async () => {
    const { doctor, patient } = await setup();
    const today = await createAppointment(doctor.id, patient.id, new Date());
    const tomorrow = await createAppointment(doctor.id, patient.id, new Date(Date.now() + 24 * HOUR));
    const cancelled = await createAppointment(doctor.id, patient.id, new Date());
    await request(app).delete(`/api/appointments/${cancelled.id}`);

    expect((await request(app).post(`/api/appointments/${today.id}/check-in`)).status).toBe(200);
    expect((await request(app).post(`/api/appointments/${today.id}/check-in`)).status).toBe(409);
    expect((await request(app).post(`/api/appointments/${tomorrow.id}/check-in`)).status).toBe(409);
    expect((await request(app).post(`/api/appointments/${cancelled.id}/check-in`)).status).toBe(409);
    expect((await request(app).post("/api/appointments/999999/check-in")).status).toBe(404);
  });

  it("예약 시각 5분이 지나 노쇼 처리된 예약은 409", async () => {
    const { doctor, patient } = await setup();
    const late = await createAppointment(doctor.id, patient.id, new Date(Date.now() - 6 * 60_000));

    const res = await request(app).post(`/api/appointments/${late.id}/check-in`);
    expect(res.status).toBe(409);
    expect((await prisma.queueEntry.findUnique({ where: { appointmentId: late.id } }))?.status).toBe("NO_SHOW");
  });
});
