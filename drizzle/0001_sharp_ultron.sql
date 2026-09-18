CREATE TYPE "public"."donation_source" AS ENUM('stripe', 'import');--> statement-breakpoint
ALTER TABLE "donations" ADD COLUMN "source" "donation_source" DEFAULT 'stripe' NOT NULL;--> statement-breakpoint
ALTER TABLE "participant_invites" ADD COLUMN "participant_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "is_placeholder" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "participant_invites" ADD CONSTRAINT "participant_invites_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;