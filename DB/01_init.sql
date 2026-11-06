CREATE TYPE "AppointmentStatus" AS ENUM ('booked', 'cancelled');
CREATE TYPE "QueueStatus" AS ENUM (
    'booked', 'checked_in', 'cancelled', 'disappeared',
    'inprogress', 'completed', 'no_show'
);
CREATE TYPE "ServiceType" AS ENUM ('초진', '재진', '검사');

CREATE TABLE doctors (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    display_name TEXT NOT NULL,
    department TEXT NOT NULL
);

CREATE TABLE patients (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    display_name TEXT NOT NULL
);

CREATE TABLE appointments (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    doctor_id BIGINT NOT NULL REFERENCES doctors(id),
    patient_id BIGINT NOT NULL REFERENCES patients(id),
    scheduled_at TIMESTAMPTZ NOT NULL,
    status "AppointmentStatus" NOT NULL DEFAULT 'booked'
);

CREATE TABLE queue_entries (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    appointment_id BIGINT NOT NULL UNIQUE REFERENCES appointments(id),
    queue_position INTEGER NOT NULL,
    status "QueueStatus" NOT NULL,
    checked_in_at TIMESTAMPTZ,
    called_at TIMESTAMPTZ,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE TABLE service_time_stats (
    doctor_id BIGINT NOT NULL REFERENCES doctors(id),
    service_type "ServiceType" NOT NULL,
    ewma_minutes NUMERIC(6, 2) NOT NULL,
    sample_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (doctor_id, service_type)
);