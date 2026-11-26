import { Router } from "express";
import type { Patient, Prisma } from "@prisma/client";
import { prisma } from "../prisma";
import { ApiError } from "../errors/apiError";
import { parseBody, parseId, parseText } from "../utils/parsers";

const router = Router();

function serializePatient(patient: Patient) {
  return { id: patient.id.toString(), displayName: patient.displayName };
}

// GET /api/patients (name이 이름에 포함된 환자만)
router.get("/", async (req, res) => {
  const where: Prisma.PatientWhereInput = {};
  if (req.query.name !== undefined) {
    where.displayName = { contains: parseText(req.query.name, "name") };
  }

  const patients = await prisma.patient.findMany({ where, orderBy: { id: "asc" } });
  res.json({ data: patients.map(serializePatient) });
});

// GET /api/patients/:id
router.get("/:id", async (req, res) => {
  const id = parseId(req.params.id, "id");
  const patient = await prisma.patient.findUnique({ where: { id } });
  if (!patient) throw new ApiError(404, "Patient not found");
  res.json({ data: serializePatient(patient) });
});

// POST /api/patients
router.post("/", async (req, res) => {
  const body = parseBody(req.body);
  const patient = await prisma.patient.create({
    data: { displayName: parseText(body.displayName, "displayName") },
  });
  res.status(201).json({ data: serializePatient(patient) });
});

// PATCH /api/patients/:id
router.patch("/:id", async (req, res) => {
  const id = parseId(req.params.id, "id");
  const body = parseBody(req.body);
  const displayName = parseText(body.displayName, "displayName");

  const exists = await prisma.patient.findUnique({ where: { id } });
  if (!exists) throw new ApiError(404, "Patient not found");

  const patient = await prisma.patient.update({ where: { id }, data: { displayName } });
  res.json({ data: serializePatient(patient) });
});

// DELETE /api/patients/:id
// 예약 기록이 있는 환자는 지우지 않는다(409). 진료 이력이 초진/재진 판단에 쓰이기 때문이다.
router.delete("/:id", async (req, res) => {
  const id = parseId(req.params.id, "id");

  const patient = await prisma.$transaction(async (tx) => {
    const found = await tx.patient.findUnique({ where: { id } });
    if (!found) throw new ApiError(404, "Patient not found");

    if ((await tx.appointment.count({ where: { patientId: id } })) > 0) {
      throw new ApiError(409, "Cannot delete a patient who has appointments");
    }
    return tx.patient.delete({ where: { id } });
  });

  res.json({ data: serializePatient(patient) });
});

export default router;
