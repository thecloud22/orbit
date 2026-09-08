CREATE TABLE "binding_recovery_proposals" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"step_id" text NOT NULL,
	"proposed_for_binding_id" text NOT NULL,
	"observed_in_run_id" text,
	"observed_in_agent_version_id" text,
	"state" text DEFAULT 'proposed' NOT NULL,
	"proposed_binding" jsonb NOT NULL,
	"proposed_binding_sha256" text NOT NULL,
	"diagnosis" jsonb NOT NULL,
	"deterministic" boolean DEFAULT true NOT NULL,
	"resulting_binding_id" text,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "binding_recovery_proposals_state_check" CHECK ("binding_recovery_proposals"."state" IN ('proposed', 'accepted', 'dismissed')),
	CONSTRAINT "binding_recovery_proposals_binding_sha256_check" CHECK ("binding_recovery_proposals"."proposed_binding_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "binding_recovery_proposals_resolved_at_check" CHECK ("binding_recovery_proposals"."state" = 'proposed' OR "binding_recovery_proposals"."resolved_at" IS NOT NULL),
	CONSTRAINT "binding_recovery_proposals_resulting_binding_check" CHECK ("binding_recovery_proposals"."state" = 'accepted' OR "binding_recovery_proposals"."resulting_binding_id" IS NULL)
);
--> statement-breakpoint
ALTER TABLE "run_events" DROP CONSTRAINT "run_events_event_type_check";--> statement-breakpoint
ALTER TABLE "sop_documents" ADD COLUMN "recovery_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "binding_recovery_proposals" ADD CONSTRAINT "binding_recovery_proposals_document_id_sop_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."sop_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binding_recovery_proposals" ADD CONSTRAINT "binding_recovery_proposals_proposed_for_binding_id_execution_bindings_id_fk" FOREIGN KEY ("proposed_for_binding_id") REFERENCES "public"."execution_bindings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binding_recovery_proposals" ADD CONSTRAINT "binding_recovery_proposals_observed_in_run_id_runs_id_fk" FOREIGN KEY ("observed_in_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binding_recovery_proposals" ADD CONSTRAINT "binding_recovery_proposals_observed_in_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("observed_in_agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "binding_recovery_proposals" ADD CONSTRAINT "binding_recovery_proposals_resulting_binding_id_execution_bindings_id_fk" FOREIGN KEY ("resulting_binding_id") REFERENCES "public"."execution_bindings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "binding_recovery_proposals_open_per_step_unique" ON "binding_recovery_proposals" USING btree ("document_id","step_id") WHERE state = 'proposed';--> statement-breakpoint
CREATE INDEX "binding_recovery_proposals_document_id_idx" ON "binding_recovery_proposals" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "binding_recovery_proposals_state_idx" ON "binding_recovery_proposals" USING btree ("state");--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_event_type_check" CHECK ("run_events"."event_type" IN ('run.queued', 'run.started', 'run.completed', 'run.failed', 'step.started', 'step.completed', 'step.failed', 'browser.navigation.completed', 'browser.fill.completed', 'browser.click.completed', 'browser.extract.completed', 'assertion.passed', 'assertion.failed', 'decision.requested', 'decision.resolved', 'decision.refused', 'recovery.proposed', 'recovery.declined', 'artifact.created'));