import { Router } from "express";
import type { Doctor, Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { ApiError } from "../errors/apiError";
import { parseBody, parseId, parseText } from "../utils/parsers";
import { getAlgorithmSettings } from "../services/queueEstimator";

const router = Router();

function serializeDoctor(doctor: Doctor) {
  return { id: doctor.id.toString(), displayName: doctor.displayName, department: doctor.department };
}

// GET /api/doctors (department로 진료과 필터)
router.get("/", async (req, res) => {
  const where: Prisma.DoctorWhereInput = {};
  if (req.query.department !== undefined) {
    where.department = parseText(req.query.department, "department");
  }

  const doctors = await prisma.doctor.findMany({ where, orderBy: { id: "asc" } });
  res.json({ data: doctors.map(serializeDoctor) });
});

// GET /api/doctors/:id
router.get("/:id", async (req, res) => {
  const id = parseId(req.params.id, "id");
  const doctor = await prisma.doctor.findUnique({ where: { id } });
  if (!doctor) throw new ApiError(404, "Doctor not found");
  res.json({ data: serializeDoctor(doctor) });
});

// GET /api/doctors/:id/service-time-stats
// 초진·재진 EWMA(현재 예상 진료시간)를 조회한다. 아직 완료된 진료가 없어 통계가 없으면
// 대기열 계산과 같은 기준인 알고리즘 설정의 기본시간을 돌려주고 isDefault를 true로 표시한다.
router.get("/:id/service-time-stats", async (req, res) => {
  const id = parseId(req.params.id, "id");
  const doctor = await prisma.doctor.findUnique({ where: { id } });
  if (!doctor) throw new ApiError(404, "Doctor not found");

  const [settings, stats] = await Promise.all([
    getAlgorithmSettings(id),
    prisma.serviceTimeStat.findMany({
      where: { doctorId: id, serviceType: { in: ["FIRST_VISIT", "FOLLOW_UP"] } },
    }),
  ]);

  const toResult = (serviceType: "FIRST_VISIT" | "FOLLOW_UP", defaultMinutes: number) => {
    const stat = stats.find((item) => item.serviceType === serviceType);
    return stat
      ? { ewmaMinutes: Number(stat.ewmaMinutes), sampleCount: stat.sampleCount, updatedAt: stat.updatedAt, isDefault: false }
      : { ewmaMinutes: defaultMinutes, sampleCount: 0, updatedAt: null, isDefault: true };
  };

  res.json({
    data: {
      doctorId: id.toString(),
      firstVisit: toResult("FIRST_VISIT", settings.firstVisitTime),
      followUp: toResult("FOLLOW_UP", settings.reVisitTime),
    },
  });
});

// POST /api/doctors
router.post("/", async (req, res) => {
  const body = parseBody(req.body);
  const doctor = await prisma.doctor.create({
    data: {
      displayName: parseText(body.displayName, "displayName"),
      department: parseText(body.department, "department"),
    },
  });
  res.status(201).json({ data: serializeDoctor(doctor) });
});

// PATCH /api/doctors/:id (보낸 필드만 수정)
router.patch("/:id", async (req, res) => {
  const id = parseId(req.params.id, "id");
  const body = parseBody(req.body);

  const data: Prisma.DoctorUpdateInput = {};
  if (body.displayName !== undefined) data.displayName = parseText(body.displayName, "displayName");
  if (body.department !== undefined) data.department = parseText(body.department, "department");
  if (Object.keys(data).length === 0) {
    throw new ApiError(400, "At least one of displayName, department is required");
  }

  const exists = await prisma.doctor.findUnique({ where: { id } });
  if (!exists) throw new ApiError(404, "Doctor not found");

  const doctor = await prisma.doctor.update({ where: { id }, data });
  res.json({ data: serializeDoctor(doctor) });
});

// DELETE /api/doctors/:id
// 예약 기록이 있는 의사는 지우지 않는다(예약·대기 기록이 의사를 참조하므로 409).
// 예약이 없으면 의사에게만 딸린 알고리즘 설정과 진료시간 통계를 함께 지운다.
router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id, "id");

  const doctor = await prisma.$transaction(async (tx) => {
    const found = await tx.doctor.findUnique({ where: { id } });
    if (!found) throw new ApiError(404, "Doctor not found");

    if ((await tx.appointment.count({ where: { doctorId: id } })) > 0) {
      throw new ApiError(409, "Cannot delete a doctor who has appointments");
    }

    await tx.algorithmConfig.deleteMany({ where: { doctorId: id } });
    await tx.serviceTimeStat.deleteMany({ where: { doctorId: id } });
    return tx.doctor.delete({ where: { id } });
  });

  res.json({ data: serializeDoctor(doctor) });
});

export default router;
