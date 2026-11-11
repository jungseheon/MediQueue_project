import { prisma } from "../prisma";

const NO_SHOW_GRACE_PERIOD_MS = 5 * 60 * 1000;

export async function processNoShows(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - NO_SHOW_GRACE_PERIOD_MS);

  return prisma.$executeRaw`
    INSERT INTO "queue_entries" ("appointment_id", "queue_position", "status")
    SELECT appointments.id, 0, 'no_show'::"QueueStatus"
    FROM "appointments" AS appointments
    LEFT JOIN "queue_entries" AS entries
      ON entries.appointment_id = appointments.id
    WHERE appointments.status = 'booked'::"AppointmentStatus"
      AND appointments.scheduled_at <= ${cutoff}
      AND (entries.id IS NULL OR entries.status = 'booked'::"QueueStatus")
    ON CONFLICT ("appointment_id") DO UPDATE
      SET "status" = EXCLUDED."status", "queue_position" = EXCLUDED."queue_position"
      WHERE "queue_entries"."status" = 'booked'::"QueueStatus"
  `;
}
