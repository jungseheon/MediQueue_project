import app from "./app";
import { prisma } from "./prisma";
import { processNoShows } from "./services/noShowProcessor";

const port = Number(process.env.PORT ?? 3000);

function runNoShows() {
  void processNoShows().catch((error: unknown) => {
    console.error("Failed to process appointment no-shows", error);
  });
}

const noShowTimer = setInterval(runNoShows, 30_000);
runNoShows();

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
