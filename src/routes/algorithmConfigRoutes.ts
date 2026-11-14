import { Router } from "express";
import { prisma } from "../prisma";
import { parseBody, parseId } from "../utils/parsers";

const router = Router();

// GET /api/algorithm-config/:doctorId (설정 조회)
router.get("/algorithm-config/:doctorId", async (req, res) => {
  const doctorId = parseId(req.params.doctorId, "doctorId");

  const config = await prisma.algorithmConfig.findUnique({
    where: { doctorId },
  });

  // DB에 저장된 설정이 없으면 기본값 반환[cite: 3]
  res.json({
    data: config
      ? {
          ...config,
          id: config.id.toString(),
          doctorId: config.doctorId.toString(),
        }
      : {
          doctorId: doctorId.toString(),
          firstVisitTime: 12.0,
          reVisitTime: 8.0,
          prepTime: 1.0,
          alpha: 0.3,
          sampleCount: 10,
          delayThreshold: 10,
          reNotifyThreshold: 5,
          imminentCount: 2,
        },
  });
});

// PUT /api/algorithm-config/:doctorId (설정 수정 및 저장)
router.put("/algorithm-config/:doctorId", async (req, res) => {
  const doctorId = parseId(req.params.doctorId, "doctorId");
  const body = parseBody(req.body);

  const saved = await prisma.algorithmConfig.upsert({
    where: { doctorId },
    update: {
      firstVisitTime: typeof body.firstVisitTime === "number" ? body.firstVisitTime : undefined,
      reVisitTime: typeof body.reVisitTime === "number" ? body.reVisitTime : undefined,
      prepTime: typeof body.prepTime === "number" ? body.prepTime : undefined,
      alpha: typeof body.alpha === "number" ? body.alpha : undefined,
      sampleCount: typeof body.sampleCount === "number" ? body.sampleCount : undefined,
      delayThreshold: typeof body.delayThreshold === "number" ? body.delayThreshold : undefined,
      reNotifyThreshold: typeof body.reNotifyThreshold === "number" ? body.reNotifyThreshold : undefined,
      imminentCount: typeof body.imminentCount === "number" ? body.imminentCount : undefined,
    },
    create: {
      doctorId,
      firstVisitTime: typeof body.firstVisitTime === "number" ? body.firstVisitTime : 12.0,
      reVisitTime: typeof body.reVisitTime === "number" ? body.reVisitTime : 8.0,
      prepTime: typeof body.prepTime === "number" ? body.prepTime : 1.0,
      alpha: typeof body.alpha === "number" ? body.alpha : 0.3,
      sampleCount: typeof body.sampleCount === "number" ? body.sampleCount : 10,
      delayThreshold: typeof body.delayThreshold === "number" ? body.delayThreshold : 10,
      reNotifyThreshold: typeof body.reNotifyThreshold === "number" ? body.reNotifyThreshold : 5,
      imminentCount: typeof body.imminentCount === "number" ? body.imminentCount : 2,
    },
  });

  res.json({
    data: {
      ...saved,
      id: saved.id.toString(),
      doctorId: saved.doctorId.toString(),
    },
  });
});

export default router;