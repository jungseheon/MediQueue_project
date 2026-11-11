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

// 테스트용 의사·환자·예약·대기 항목을 한번에 생성하는 헬퍼
async function setupQueue(
  entries: Array<{
    position: number;
    called?: boolean; // calledAt 여부
    disappearCount?: number;
  }>,
) {
  const doctor = await createDoctor();
  const appointedAt = new Date(Date.now() - 60_000); // 1분 전 예약 (오늘 KST)

  const items = await Promise.all(
    entries.map(async (e, i) => {
      const patient = await createPatient(`환자${i + 1}`);
      const appt = await createAppointment(doctor.id, patient.id, appointedAt);
      const entry = await createQueueEntry(appt.id, e.position, "CHECKED_IN", {
        calledAt: e.called ? new Date() : undefined,
        disappearCount: e.disappearCount ?? 0,
      });
      return { patient, appt, entry };
    }),
  );

  return { doctor, items };
}

describe("POST /api/queue-entries/:id/disappear", () => {
  it("호출된 환자가 뒤에 2명 있을 때 순번이 2칸 뒤로 밀림", async () => {
    // 초기: 1(called)→1번, 2번, 3번
    // 기대: called→3번, 2→1번, 3→2번
    const { items } = await setupQueue([
      { position: 1, called: true },
      { position: 2 },
      { position: 3 },
    ]);
    const targetId = items[0].entry.id.toString();

    const res = await request(app)
      .post(`/api/queue-entries/${targetId}/disappear`)
      .send({ delayPositions: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data.updatedEntry.queuePosition).toBe(3);
    expect(res.body.data.updatedEntry.status).toBe("disappeared");

    // 뒤 환자들의 순번도 확인
    const [e2, e3] = await Promise.all([
      prisma.queueEntry.findUnique({ where: { id: items[1].entry.id } }),
      prisma.queueEntry.findUnique({ where: { id: items[2].entry.id } }),
    ]);
    expect(e2?.queuePosition).toBe(1);
    expect(e3?.queuePosition).toBe(2);
  });

  it("대기열 마지막 환자는 순번 유지, 상태만 disappeared로 변경", async () => {
    const { items } = await setupQueue([
      { position: 1, called: true },
    ]);
    const targetId = items[0].entry.id.toString();

    const res = await request(app)
      .post(`/api/queue-entries/${targetId}/disappear`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.updatedEntry.queuePosition).toBe(1);
    expect(res.body.data.updatedEntry.status).toBe("disappeared");
  });

  it("calledAt이 없으면 409 Conflict", async () => {
    const { items } = await setupQueue([
      { position: 1, called: false }, // 호출 안 됨
    ]);
    const targetId = items[0].entry.id.toString();

    const res = await request(app)
      .post(`/api/queue-entries/${targetId}/disappear`)
      .send({});

    expect(res.status).toBe(409);
  });

  it("순번이 불연속일 때도 정확히 N칸 뒤로 이동", async () => {
    // 초기: 1(called)→2번, 2→10번, 3→20번
    // delayPositions=2 기대: called→20번, 2→2번(1의 원래), 3→10번(2의 원래)
    const { items } = await setupQueue([
      { position: 2, called: true },
      { position: 10 },
      { position: 20 },
    ]);
    const targetId = items[0].entry.id.toString();

    const res = await request(app)
      .post(`/api/queue-entries/${targetId}/disappear`)
      .send({ delayPositions: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data.updatedEntry.queuePosition).toBe(20);

    const [e2, e3] = await Promise.all([
      prisma.queueEntry.findUnique({ where: { id: items[1].entry.id } }),
      prisma.queueEntry.findUnique({ where: { id: items[2].entry.id } }),
    ]);
    expect(e2?.queuePosition).toBe(2);
    expect(e3?.queuePosition).toBe(10);
  });

  it("delayPositions보다 뒤 환자 수가 적으면 있는 만큼만 미룸", async () => {
    // 뒤에 1명밖에 없는데 delayPositions=5
    const { items } = await setupQueue([
      { position: 1, called: true },
      { position: 2 },
    ]);
    const targetId = items[0].entry.id.toString();

    const res = await request(app)
      .post(`/api/queue-entries/${targetId}/disappear`)
      .send({ delayPositions: 5 });

    expect(res.status).toBe(200);
    // 실제로 1칸만 밀림: target→2번, 뒤 환자→1번
    expect(res.body.data.updatedEntry.queuePosition).toBe(2);
  });

  it("disappearCount가 응답에 포함됨", async () => {
    const { items } = await setupQueue([{ position: 1, called: true }]);
    const targetId = items[0].entry.id.toString();

    const res = await request(app)
      .post(`/api/queue-entries/${targetId}/disappear`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.updatedEntry.disappearCount).toBe(1);
  });

  it("3회째 disappear → no_show로 전환, 순번 조정 없음", async () => {
    // 2회 이미 부재 처리된 항목으로 직접 생성
    const { items } = await setupQueue([
      { position: 2, called: true, disappearCount: 2 },
      { position: 5 }, // 뒤에 환자가 있지만 순번 조정 없어야 함
    ]);
    const targetId = items[0].entry.id.toString();

    const res = await request(app)
      .post(`/api/queue-entries/${targetId}/disappear`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.data.updatedEntry.status).toBe("no_show");
    expect(res.body.data.updatedEntry.disappearCount).toBe(3);

    // 뒤 환자 순번은 그대로여야 함
    const e2 = await prisma.queueEntry.findUnique({ where: { id: items[1].entry.id } });
    expect(e2?.queuePosition).toBe(5);
  });

  it("delayPositions가 범위 밖(0)이면 400", async () => {
    const { items } = await setupQueue([{ position: 1, called: true }]);
    const targetId = items[0].entry.id.toString();

    const res = await request(app)
      .post(`/api/queue-entries/${targetId}/disappear`)
      .send({ delayPositions: 0 });

    expect(res.status).toBe(400);
  });

  it("존재하지 않는 ID → 404", async () => {
    const res = await request(app)
      .post("/api/queue-entries/99999/disappear")
      .send({});

    expect(res.status).toBe(404);
  });
});
