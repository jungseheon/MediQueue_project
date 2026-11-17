import { Router } from "express";
import type { AlgorithmConfig } from "@prisma/client";
import { prisma } from "../prisma";
import { ApiError } from "../errors/apiError";
import { parseBody, parseId } from "../utils/parsers";
import { DEFAULT_ALGORITHM_CONFIG, type AlgorithmSettings } from "../services/queueEstimator";

const router = Router();

// 설정 필드별 허용 범위 (integer: 정수만 허용, minExclusive: min 초과여야 함)
const FIELD_RULES: Record<
  keyof AlgorithmSettings,
  { min: number; max: number; integer?: boolean; minExclusive?: boolean }
> = {
  firstVisitTime: { min: 0, max: 240, minExclusive: true },
  reVisitTime: { min: 0, max: 240, minExclusive: true },
  prepTime: { min: 0, max: 60 },
  alpha: { min: 0, max: 1, minExclusive: true },
  sampleCount: { min: 1, max: 1000, integer: true },
  delayThreshold: { min: 0, max: 240, integer: true },
  reNotifyThreshold: { min: 1, max: 240, integer: true },
  imminentCount: { min: 0, max: 100, integer: true },
};

function parseSettings(body: Record<string, unknown>): Partial<AlgorithmSettings> {
  const settings: Partial<AlgorithmSettings> = {};
  for (const field of Object.keys(FIELD_RULES) as (keyof AlgorithmSettings)[]) {
    if (!Object.hasOwn(body, field)) continue;
    const rule = FIELD_RULES[field];
    const value = body[field];
    const valid =
      typeof value === "number" &&
      Number.isFinite(value) &&
      (!rule.integer || Number.isInteger(value)) &&
      (rule.minExclusive ? value > rule.min : value >= rule.min) &&
      value <= rule.max;
    if (!valid) {
      // 예: "alpha must be a number in (0, 1]"
      const range = `${rule.minExclusive ? "(" : "["}${rule.min}, ${rule.max}]`;
      throw new ApiError(400, `${field} must be ${rule.integer ? "an integer" : "a number"} in ${range}`);
    }
    settings[field] = value;
  }
  return settings;
}

function serializeConfig(config: AlgorithmConfig) {
  return { ...config, id: config.id.toString(), doctorId: config.doctorId.toString() };
}

async function ensureDoctorExists(doctorId: bigint) {
  const doctor = await prisma.doctor.findUnique({ where: { id: doctorId }, select: { id: true } });
  if (!doctor) throw new ApiError(404, "Doctor not found");
}

// GET /api/algorithm-config/:doctorId (설정 조회)
router.get("/algorithm-config/:doctorId", async (req, res) => {
  const doctorId = parseId(req.params.doctorId, "doctorId");
  await ensureDoctorExists(doctorId);

  const config = await prisma.algorithmConfig.findUnique({ where: { doctorId } });

  // 저장된 설정이 없으면 기본값 반환
  res.json({
    data: config
      ? serializeConfig(config)
      : { doctorId: doctorId.toString(), ...DEFAULT_ALGORITHM_CONFIG },
  });
});

// PUT /api/algorithm-config/:doctorId (보낸 필드만 수정, 설정이 없으면 기본값으로 생성)
router.put("/algorithm-config/:doctorId", async (req, res) => {
  const doctorId = parseId(req.params.doctorId, "doctorId");
  const settings = parseSettings(parseBody(req.body));
  await ensureDoctorExists(doctorId);

  const saved = await prisma.algorithmConfig.upsert({
    where: { doctorId },
    update: settings,
    create: { doctorId, ...DEFAULT_ALGORITHM_CONFIG, ...settings },
  });

  res.json({ data: serializeConfig(saved) });
});

export default router;
