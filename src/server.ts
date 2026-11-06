import "dotenv/config";
import app from "./app";
import { prisma } from "./prisma";

const port = Number(process.env.PORT ?? 3000);

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`MediQueue API listening on port ${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  });
}
