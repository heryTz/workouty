ALTER TABLE "sets" ALTER COLUMN "reps" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sets" ALTER COLUMN "weight_kg" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "load_type" text DEFAULT 'external' NOT NULL;--> statement-breakpoint
ALTER TABLE "exercises" ADD COLUMN "measure" text DEFAULT 'reps' NOT NULL;--> statement-breakpoint
ALTER TABLE "sets" ADD COLUMN "duration_seconds" integer;--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_load_type_ck" CHECK ("exercises"."load_type" IN ('external', 'bodyweight'));--> statement-breakpoint
ALTER TABLE "exercises" ADD CONSTRAINT "exercises_measure_ck" CHECK ("exercises"."measure" IN ('reps', 'duration'));--> statement-breakpoint
ALTER TABLE "sets" ADD CONSTRAINT "sets_measure_present_ck" CHECK ("sets"."reps" IS NOT NULL OR "sets"."duration_seconds" IS NOT NULL);