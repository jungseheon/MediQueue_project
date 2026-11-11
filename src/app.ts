import "dotenv/config";
import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { ApiError } from "./errors/apiError";
import appointmentRoutes from "./routes/appointmentRoutes";
import queueRoutes from "./routes/queueRoutes";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Health Check
app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.status(200).json({ status: "ok", database: "ok" });
  } catch {
    res.status(503).json({ status: "error", database: "unavailable" });
  }
});

// API Routes
app.use("/api/appointments", appointmentRoutes);
app.use("/api", queueRoutes);

// Global Error Handler
const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ApiError) {
    res.status(error.status).json({ error: error.message });
    return;
  }

  // express.json()이 던지는 본문 파싱 오류(잘못된 JSON, 너무 큰 본문 등)
  if (
    typeof error === "object" &&
    error !== null &&
    "type" in error &&
    typeof error.status === "number" &&
    error.status >= 400 &&
    error.status < 500
  ) {
    res.status(error.status).json({ error: "Invalid request body" });
    return;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2003") {
      res.status(400).json({ error: "doctorId or patientId does not exist" });
      return;
    }
    if (error.code === "P2025") {
      res.status(404).json({ error: "Record not found" });
      return;
    }
  }

  console.error(error);
  res.status(500).json({ error: "Internal server error" });
};

app.use(errorHandler);

export default app;
