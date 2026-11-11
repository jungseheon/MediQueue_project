import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { prisma } from "../../src/prisma";
import { processNoShows } from "../../src/services/noShowProcessor";
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

describe("processNoShows", () => {
  it("5분 이상 지난 booked 예약 → queue entry가 no_show로 변경됨", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient("환자A");
    const appt = await createAppointment(
      doctor.id,
      patient.id,
      new Date(Date.now() - 10 * 60_000), // 10분 전 예약
    );
    await createQueueEntry(appt.id, 0, "BOOKED");

    await processNoShows(new Date());

    const entry = await prisma.queueEntry.findUnique({ where: { appointmentId: appt.id } });
    expect(entry?.status).toBe("NO_SHOW");
  });

  it("5분 미만인 booked 예약 → no_show로 변경되지 않음", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient("환자A");
    const appt = await createAppointment(
      doctor.id,
      patient.id,
      new Date(Date.now() - 3 * 60_000), // 3분 전 예약
    );
    await createQueueEntry(appt.id, 0, "BOOKED");

    await processNoShows(new Date());

    const entry = await prisma.queueEntry.findUnique({ where: { appointmentId: appt.id } });
    expect(entry?.status).toBe("BOOKED");
  });

  it("이미 checked_in인 환자는 no_show로 변경되지 않음", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient("환자A");
    const appt = await createAppointment(
      doctor.id,
      patient.id,
      new Date(Date.now() - 10 * 60_000),
    );
    await createQueueEntry(appt.id, 1, "CHECKED_IN");

    await processNoShows(new Date());

    const entry = await prisma.queueEntry.findUnique({ where: { appointmentId: appt.id } });
    expect(entry?.status).toBe("CHECKED_IN");
  });

  it("queue entry가 없는 예약 → position=0 인 no_show 항목 자동 생성", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient("환자A");
    const appt = await createAppointment(
      doctor.id,
      patient.id,
      new Date(Date.now() - 10 * 60_000),
    );
    // queue entry를 만들지 않음

    await processNoShows(new Date());

    const entry = await prisma.queueEntry.findUnique({ where: { appointmentId: appt.id } });
    expect(entry).not.toBeNull();
    expect(entry?.status).toBe("NO_SHOW");
    expect(entry?.queuePosition).toBe(0);
  });

  it("여러 예약 혼재 시 조건에 맞는 것만 no_show 처리", async () => {
    const doctor = await createDoctor();
    const [p1, p2, p3] = await Promise.all([
      createPatient("환자A"),
      createPatient("환자B"),
      createPatient("환자C"),
    ]);

    const [appt1, appt2, appt3] = await Promise.all([
      createAppointment(doctor.id, p1.id, new Date(Date.now() - 10 * 60_000)), // 10분 전 → no_show 대상
      createAppointment(doctor.id, p2.id, new Date(Date.now() - 3 * 60_000)),  // 3분 전 → 유지
      createAppointment(doctor.id, p3.id, new Date(Date.now() - 10 * 60_000)), // 10분 전이지만 checked_in
    ]);

    await Promise.all([
      createQueueEntry(appt1.id, 0, "BOOKED"),
      createQueueEntry(appt2.id, 0, "BOOKED"),
      createQueueEntry(appt3.id, 1, "CHECKED_IN"),
    ]);

    await processNoShows(new Date());

    const [e1, e2, e3] = await Promise.all([
      prisma.queueEntry.findUnique({ where: { appointmentId: appt1.id } }),
      prisma.queueEntry.findUnique({ where: { appointmentId: appt2.id } }),
      prisma.queueEntry.findUnique({ where: { appointmentId: appt3.id } }),
    ]);

    expect(e1?.status).toBe("NO_SHOW");
    expect(e2?.status).toBe("BOOKED");
    expect(e3?.status).toBe("CHECKED_IN");
  });

  it("이미 no_show인 항목은 중복 처리되지 않음(幂等)", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient("환자A");
    const appt = await createAppointment(
      doctor.id,
      patient.id,
      new Date(Date.now() - 10 * 60_000),
    );
    await createQueueEntry(appt.id, 0, "NO_SHOW");

    const count = await processNoShows(new Date());
    expect(count).toBe(0); // 변경된 행 없음
  });
});
