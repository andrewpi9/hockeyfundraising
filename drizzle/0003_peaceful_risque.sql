ALTER TYPE "public"."share_medium" ADD VALUE 'family';--> statement-breakpoint
CREATE TABLE "participant_helpers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"name_ciphertext" text NOT NULL,
	"email_ciphertext" text NOT NULL,
	"email_blind_index" text NOT NULL,
	"relationship" text,
	"share_link_id" uuid,
	"kit_sent_at" timestamp with time zone,
	"kit_send_count" integer DEFAULT 0 NOT NULL,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "participant_helpers" ADD CONSTRAINT "participant_helpers_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participant_helpers" ADD CONSTRAINT "participant_helpers_share_link_id_share_links_id_fk" FOREIGN KEY ("share_link_id") REFERENCES "public"."share_links"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "participant_helpers_participant_idx" ON "participant_helpers" USING btree ("participant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "participant_helpers_participant_email_idx" ON "participant_helpers" USING btree ("participant_id","email_blind_index");