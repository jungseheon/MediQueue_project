-- CreateTable
CREATE TABLE "algorithm_configs" (
    "id" BIGSERIAL NOT NULL,
    "doctor_id" BIGINT NOT NULL,
    "first_visit_time" DOUBLE PRECISION NOT NULL DEFAULT 12.0,
    "re_visit_time" DOUBLE PRECISION NOT NULL DEFAULT 8.0,
    "prep_time" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "alpha" DOUBLE PRECISION NOT NULL DEFAULT 0.3,
    "sample_count" INTEGER NOT NULL DEFAULT 10,
    "delay_threshold" INTEGER NOT NULL DEFAULT 10,
    "re_notify_threshold" INTEGER NOT NULL DEFAULT 5,
    "imminent_count" INTEGER NOT NULL DEFAULT 2,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "algorithm_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "algorithm_configs_doctor_id_key" ON "algorithm_configs"("doctor_id");

-- AddForeignKey
ALTER TABLE "algorithm_configs" ADD CONSTRAINT "algorithm_configs_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "doctors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
