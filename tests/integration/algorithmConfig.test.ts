import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../../src/app";
import { prisma } from "../../src/prisma";
import { truncateAll, createDoctor } from "../helpers";

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("GET /api/algorithm-config/:doctorId", () => {
  it("저장된 설정이 없으면 기본값 반환", async () => {
    const doctor = await createDoctor();

    const res = await request(app).get(`/api/algorithm-config/${doctor.id}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      doctorId: doctor.id.toString(),
      firstVisitTime: 12,
      reVisitTime: 8,
      prepTime: 1,
      alpha: 0.3,
      delayThreshold: 10,
    });
    expect(res.body.data.id).toBeUndefined();
  });

  it("없는 의사는 404", async () => {
    const res = await request(app).get("/api/algorithm-config/999999");
    expect(res.status).toBe(404);
  });
});

describe("PUT /api/algorithm-config/:doctorId", () => {
  it("처음 저장하면 보낸 필드 외에는 기본값으로 생성", async () => {
    const doctor = await createDoctor();

    const res = await request(app)
      .put(`/api/algorithm-config/${doctor.id}`)
      .send({ alpha: 0.4, delayThreshold: 15 });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      doctorId: doctor.id.toString(),
      alpha: 0.4,
      delayThreshold: 15,
      firstVisitTime: 12,
      reVisitTime: 8,
    });
    expect(res.body.data.id).toBeDefined();
  });

  it("이미 있으면 보낸 필드만 수정", async () => {
    const doctor = await createDoctor();
    await request(app).put(`/api/algorithm-config/${doctor.id}`).send({ alpha: 0.4 });

    const res = await request(app)
      .put(`/api/algorithm-config/${doctor.id}`)
      .send({ prepTime: 2 });

    expect(res.status).toBe(200);
    expect(res.body.data.alpha).toBe(0.4);
    expect(res.body.data.prepTime).toBe(2);
  });

  it("범위를 벗어나거나 숫자가 아닌 값은 400", async () => {
    const doctor = await createDoctor();

    for (const body of [{ alpha: 0 }, { alpha: 1.5 }, { delayThreshold: 2.5 }, { firstVisitTime: "12" }]) {
      const res = await request(app).put(`/api/algorithm-config/${doctor.id}`).send(body);
      expect(res.status).toBe(400);
    }
    expect(await prisma.algorithmConfig.count()).toBe(0);
  });

  it("없는 의사는 404", async () => {
    const res = await request(app).put("/api/algorithm-config/999999").send({ alpha: 0.4 });
    expect(res.status).toBe(404);
  });
});
