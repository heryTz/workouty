CREATE TABLE "exercise_rest_prefs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	"user_id" uuid NOT NULL,
	"exercise_id" uuid NOT NULL,
	"rest_seconds" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "exercise_rest_prefs" ADD CONSTRAINT "exercise_rest_prefs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exercise_rest_prefs" ADD CONSTRAINT "exercise_rest_prefs_exercise_id_exercises_id_fk" FOREIGN KEY ("exercise_id") REFERENCES "public"."exercises"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "exercise_rest_prefs_user_exercise_uq" ON "exercise_rest_prefs" USING btree ("user_id","exercise_id") WHERE "exercise_rest_prefs"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "exercise_rest_prefs_user_id_idx" ON "exercise_rest_prefs" USING btree ("user_id");