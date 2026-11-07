CREATE TYPE "AppointmentStatus" AS ENUM ('booked', 'cancelled');

CREATE TYPE "QueueStatus" AS ENUM (
    'booked',
    'checked_in',
    'called',
    'in_progress',
    'completed',
    'no_show',
    'cancelled'
);

CREATE TABLE "doctors" (
    "id" BIGSERIAL NOT NULL,
    "display_name" TEXT NOT NULL,
    "department" TEXT NOT NULL,
    CONSTRAINT "doctors_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "patients" (
    "id" BIGSERIAL NOT NULL,
    "display_name" TEXT NOT NULL,
    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "appointments" (
    "id" BIGSERIAL NOT NULL,
    "doctor_id" BIGINT NOT NULL,
    "patient_id" BIGINT NOT NULL,
    "scheduled_at" TIMESTAMPTZ NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'booked',
    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "queue_entries" (
    "id" BIGSERIAL NOT NULL,
    "appointment_id" BIGINT NOT NULL,
    "queue_position" INTEGER NOT NULL,
    "status" "QueueStatus" NOT NULL,
    "checked_in_at" TIMESTAMPTZ,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    CONSTRAINT "queue_entries_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "service_time_stats" (
    "doctor_id" BIGINT NOT NULL,
    "service_type" TEXT NOT NULL,
    "ewma_minutes" DECIMAL(6,2) NOT NULL,
    "sample_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "service_time_stats_pkey" PRIMARY KEY ("doctor_id", "service_type")
);

CREATE UNIQUE INDEX "queue_entries_appointment_id_key"
    ON "queue_entries"("appointment_id");

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_doctor_id_fkey"
    FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "appointments"
    ADD CONSTRAINT "appointments_patient_id_fkey"
    FOREIGN KEY ("patient_id") REFERENCES "patients"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "queue_entries"
    ADD CONSTRAINT "queue_entries_appointment_id_fkey"
    FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "service_time_stats"
    ADD CONSTRAINT "service_time_stats_doctor_id_fkey"
    FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
