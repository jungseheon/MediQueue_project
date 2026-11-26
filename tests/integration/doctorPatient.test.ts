import { describe, it, expect, beforeEach, afterAll } from "vitest";
import request from "supertest";
import app from "../../src/app";
import { prisma } from "../../src/prisma";
import { truncateAll, createDoctor, createPatient, createAppointment } from "../helpers";

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("의사 API", () => {
  it("생성 후 목록·상세 조회, 진료과 필터", async () => {
    const created = await request(app)
      .post("/api/doctors")
      .send({ displayName: "  김의사 ", department: "내과" });
    expect(created.status).toBe(201);
    expect(created.body.data).toEqual({ id: expect.any(String), displayName: "김의사", department: "내과" });

    await createDoctor("박의사", "정형외과");

    const list = await request(app).get("/api/doctors");
    expect(list.body.data.map((d: { displayName: string }) => d.displayName)).toEqual(["김의사", "박의사"]);

    const filtered = await request(app).get("/api/doctors").query({ department: "정형외과" });
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].displayName).toBe("박의사");

    const detail = await request(app).get(`/api/doctors/${created.body.data.id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.department).toBe("내과");
  });

  it("필수 값이 없거나 비어 있으면 400", async () => {
    for (const body of [{}, { displayName: "김의사" }, { displayName: " ", department: "내과" }, { displayName: 1, department: "내과" }]) {
      const res = await request(app).post("/api/doctors").send(body);
      expect(res.status).toBe(400);
    }
    expect(await prisma.doctor.count()).toBe(0);
  });

  it("보낸 필드만 수정, 수정할 필드가 없으면 400, 없는 의사는 404", async () => {
    const doctor = await createDoctor("김의사", "내과");

    const res = await request(app).patch(`/api/doctors/${doctor.id}`).send({ department: "가정의학과" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ displayName: "김의사", department: "가정의학과" });

    expect((await request(app).patch(`/api/doctors/${doctor.id}`).send({})).status).toBe(400);
    expect((await request(app).patch("/api/doctors/999999").send({ department: "내과" })).status).toBe(404);
    expect((await request(app).get("/api/doctors/999999")).status).toBe(404);
  });

  it("예약이 없으면 알고리즘 설정과 통계까지 삭제", async () => {
    const doctor = await createDoctor();
    await prisma.algorithmConfig.create({ data: { doctorId: doctor.id } });
    await prisma.serviceTimeStat.create({
      data: { doctorId: doctor.id, serviceType: "FIRST_VISIT", ewmaMinutes: 12 },
    });

    const res = await request(app).delete(`/api/doctors/${doctor.id}`);
    expect(res.status).toBe(200);
    expect(await prisma.doctor.count()).toBe(0);
    expect(await prisma.algorithmConfig.count()).toBe(0);
    expect(await prisma.serviceTimeStat.count()).toBe(0);
  });

  it("예약이 있는 의사는 삭제하지 않고 409", async () => {
    const doctor = await createDoctor();
    const patient = await createPatient("이환자");
    await createAppointment(doctor.id, patient.id);

    const res = await request(app).delete(`/api/doctors/${doctor.id}`);
    expect(res.status).toBe(409);
    expect(await prisma.doctor.count()).toBe(1);
  });
});

describe("환자 API", () => {
  it("생성 후 목록·상세 조회, 이름 검색", async () => {
    const created = await request(app).post("/api/patients").send({ displayName: "이환자" });
    expect(created.status).toBe(201);
    expect(created.body.data).toEqual({ id: expect.any(String), displayName: "이환자" });

    await createPatient("최환자");

    const list = await request(app).get("/api/patients");
    expect(list.body.data).toHaveLength(2);

    const searched = await request(app).get("/api/patients").query({ name: "최" });
    expect(searched.body.data).toEqual([{ id: expect.any(String), displayName: "최환자" }]);

    const detail = await request(app).get(`/api/patients/${created.body.data.id}`);
    expect(detail.body.data.displayName).toBe("이환자");
  });

  it("이름 검증과 404", async () => {
    expect((await request(app).post("/api/patients").send({ displayName: "" })).status).toBe(400);
    expect((await request(app).post("/api/patients").send({ displayName: "가".repeat(51) })).status).toBe(400);
    expect((await request(app).get("/api/patients/abc")).status).toBe(400);
    expect((await request(app).get("/api/patients/999999")).status).toBe(404);
    expect((await request(app).patch("/api/patients/999999").send({ displayName: "새이름" })).status).toBe(404);
  });

  it("이름 수정", async () => {
    const patient = await createPatient("이환자");
    const res = await request(app).patch(`/api/patients/${patient.id}`).send({ displayName: "이수정" });
    expect(res.status).toBe(200);
    expect(res.body.data.displayName).toBe("이수정");
  });

  it("예약이 없으면 삭제, 있으면 409", async () => {
    const doctor = await createDoctor();
    const free = await createPatient("예약없음");
    const booked = await createPatient("예약있음");
    await createAppointment(doctor.id, booked.id);

    expect((await request(app).delete(`/api/patients/${free.id}`)).status).toBe(200);
    expect((await request(app).delete(`/api/patients/${booked.id}`)).status).toBe(409);
    expect(await prisma.patient.count()).toBe(1);
  });
});
