BEGIN;

CREATE TABLE service_time_stats_legacy (
    doctor_id bigint NOT NULL,
    service_type text NOT NULL,
    ewma_minutes numeric(6, 2) NOT NULL,
    sample_count integer NOT NULL,
    updated_at timestamptz NOT NULL,
    PRIMARY KEY (doctor_id, service_type)
);

INSERT INTO service_time_stats_legacy
    (doctor_id, service_type, ewma_minutes, sample_count, updated_at)
SELECT doctor_id, service_type, ewma_minutes, sample_count, updated_at
FROM service_time_stats
WHERE service_type NOT IN ('초진', '재진', '검사')
ON CONFLICT (doctor_id, service_type) DO NOTHING;

DELETE FROM service_time_stats
WHERE service_type NOT IN ('초진', '재진', '검사');

CREATE TYPE "ServiceType" AS ENUM ('초진', '재진', '검사');

ALTER TABLE service_time_stats
    ALTER COLUMN service_type TYPE "ServiceType"
    USING service_type::"ServiceType";

CREATE TABLE queue_entry_status_legacy (
    queue_entry_id bigint PRIMARY KEY,
    status text NOT NULL
);

INSERT INTO queue_entry_status_legacy (queue_entry_id, status)
SELECT id, status::text
FROM queue_entries
WHERE status::text = 'called';

ALTER TABLE queue_entries
    ADD COLUMN called_at timestamptz;

ALTER TABLE queue_entries
    ALTER COLUMN status TYPE text
    USING status::text;

DROP TYPE "QueueStatus";

CREATE TYPE "QueueStatus" AS ENUM (
    'booked',
    'checked_in',
    'cancelled',
    'disappeared',
    'inprogress',
    'completed',
    'no_show'
);

UPDATE queue_entries
SET status = CASE status
    WHEN 'called' THEN 'checked_in'
    WHEN 'in_progress' THEN 'inprogress'
    ELSE status
END;

ALTER TABLE queue_entries
    ALTER COLUMN status TYPE "QueueStatus"
    USING status::"QueueStatus";

COMMIT;
