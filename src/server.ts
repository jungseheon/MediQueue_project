import "dotenv/config";
import app from "./app";
import { prisma } from "./prisma";
import { processNoShows } from "./services/noShowProcessor";

const port = Number(process.env.PORT ?? 3000);
const noShowTimer = setInterval(() => {
  void processNoShows().catch((error: unknown) => {
    console.error("Failed to process appointment no-shows", error);
  });
}, 30_000);

void processNoShows().catch((error: unknown) => {
  console.error("Failed to process appointment no-shows", error);
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`MediQueue API listening on port ${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    clearInterval(noShowTimer);
    server.close(() => {
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  });
}
