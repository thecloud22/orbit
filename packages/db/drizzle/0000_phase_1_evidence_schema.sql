CREATE TABLE "agent_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_id" text NOT NULL,
	"version" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"schema_version" text NOT NULL,
	"lifecycle_status" text NOT NULL,
	"trust_tier" text NOT NULL,
	"source_sop_id" text NOT NULL,
	"source_sop_version" text NOT NULL,
	"agent_ir" jsonb NOT NULL,
	"ir_sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "agent_versions_agent_id_version_unique" UNIQUE("agent_id","version"),
	CONSTRAINT "agent_versions_lifecycle_status_check" CHECK ("agent_versions"."lifecycle_status" IN ('draft', 'published', 'archived')),
	CONSTRAINT "agent_versions_trust_tier_check" CHECK ("agent_versions"."trust_tier" IN ('observe', 'recommend', 'prepare', 'execute_bounded', 'high_impact', 'autonomous_recovery')),
	CONSTRAINT "agent_versions_ir_sha256_check" CHECK ("agent_versions"."ir_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "artifact_links" (
	"id" text PRIMARY KEY NOT NULL,
	"artifact_id" text NOT NULL,
	"role" text NOT NULL,
	"run_id" text,
	"run_step_id" text,
	"run_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifact_links_target_unique" UNIQUE NULLS NOT DISTINCT("artifact_id","role","run_id","run_step_id","run_event_id"),
	CONSTRAINT "artifact_links_role_check" CHECK ("artifact_links"."role" IN ('screenshot_after_action', 'dom_snapshot', 'browser_trace', 'error_context', 'extracted_json')),
	CONSTRAINT "artifact_links_exactly_one_target_check" CHECK (num_nonnulls("artifact_links"."run_id", "artifact_links"."run_step_id", "artifact_links"."run_event_id") = 1)
);
--> statement-breakpoint
CREATE TABLE "artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"run_step_id" text,
	"kind" text NOT NULL,
	"content_type" text NOT NULL,
	"storage_key" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"sha256" text NOT NULL,
	"sensitivity" text DEFAULT 'internal' NOT NULL,
	"redaction_version" text,
	"retention_expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "artifacts_storage_key_unique" UNIQUE("storage_key"),
	CONSTRAINT "artifacts_kind_check" CHECK ("artifacts"."kind" IN ('browser_screenshot', 'dom_snapshot', 'browser_trace', 'extracted_json', 'error_context')),
	CONSTRAINT "artifacts_sensitivity_check" CHECK ("artifacts"."sensitivity" IN ('internal', 'sensitive', 'restricted')),
	CONSTRAINT "artifacts_size_bytes_check" CHECK ("artifacts"."size_bytes" >= 0),
	CONSTRAINT "artifacts_sha256_check" CHECK ("artifacts"."sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "artifacts_storage_key_check" CHECK (length("artifacts"."storage_key") > 0)
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"run_step_id" text,
	"agent_version_id" text NOT NULL,
	"agent_step_id" text,
	"attempt" smallint,
	"schema_version" text DEFAULT '0.1' NOT NULL,
	"event_type" text NOT NULL,
	"sequence" integer NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_events_run_id_sequence_unique" UNIQUE("run_id","sequence"),
	CONSTRAINT "run_events_event_type_check" CHECK ("run_events"."event_type" IN ('run.queued', 'run.started', 'run.completed', 'run.failed', 'step.started', 'step.completed', 'step.failed', 'browser.navigation.completed', 'browser.fill.completed', 'browser.click.completed', 'browser.extract.completed', 'assertion.passed', 'assertion.failed', 'artifact.created')),
	CONSTRAINT "run_events_sequence_check" CHECK ("run_events"."sequence" >= 1),
	CONSTRAINT "run_events_attempt_check" CHECK ("run_events"."attempt" IS NULL OR "run_events"."attempt" >= 1)
);
--> statement-breakpoint
CREATE TABLE "run_steps" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"agent_step_id" text NOT NULL,
	"step_type" text NOT NULL,
	"sequence" integer NOT NULL,
	"attempt" smallint DEFAULT 1 NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"output" jsonb,
	"error" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "run_steps_run_id_sequence_unique" UNIQUE("run_id","sequence"),
	CONSTRAINT "run_steps_run_id_agent_step_id_attempt_unique" UNIQUE("run_id","agent_step_id","attempt"),
	CONSTRAINT "run_steps_status_check" CHECK ("run_steps"."status" IN ('pending', 'running', 'succeeded', 'failed')),
	CONSTRAINT "run_steps_sequence_check" CHECK ("run_steps"."sequence" >= 1),
	CONSTRAINT "run_steps_attempt_check" CHECK ("run_steps"."attempt" >= 1)
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_version_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"business_outcome" text DEFAULT 'none' NOT NULL,
	"trigger" jsonb NOT NULL,
	"inputs" jsonb NOT NULL,
	"outputs" jsonb,
	"error" jsonb,
	"next_step_sequence" integer DEFAULT 1 NOT NULL,
	"next_event_sequence" integer DEFAULT 1 NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "runs_status_check" CHECK ("runs"."status" IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
	CONSTRAINT "runs_business_outcome_check" CHECK ("runs"."business_outcome" IN ('request_found', 'request_not_found', 'none')),
	CONSTRAINT "runs_terminal_finished_at_check" CHECK ("runs"."status" IN ('queued', 'running') OR "runs"."finished_at" IS NOT NULL),
	CONSTRAINT "runs_next_step_sequence_check" CHECK ("runs"."next_step_sequence" >= 1),
	CONSTRAINT "runs_next_event_sequence_check" CHECK ("runs"."next_event_sequence" >= 1)
);
--> statement-breakpoint
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_links" ADD CONSTRAINT "artifact_links_artifact_id_artifacts_id_fk" FOREIGN KEY ("artifact_id") REFERENCES "public"."artifacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_links" ADD CONSTRAINT "artifact_links_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_links" ADD CONSTRAINT "artifact_links_run_step_id_run_steps_id_fk" FOREIGN KEY ("run_step_id") REFERENCES "public"."run_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifact_links" ADD CONSTRAINT "artifact_links_run_event_id_run_events_id_fk" FOREIGN KEY ("run_event_id") REFERENCES "public"."run_events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_run_step_id_run_steps_id_fk" FOREIGN KEY ("run_step_id") REFERENCES "public"."run_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_step_id_run_steps_id_fk" FOREIGN KEY ("run_step_id") REFERENCES "public"."run_steps"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_steps" ADD CONSTRAINT "run_steps_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_versions_agent_id_idx" ON "agent_versions" USING btree ("agent_id");--> statement-breakpoint
CREATE INDEX "agent_versions_lifecycle_status_idx" ON "agent_versions" USING btree ("lifecycle_status");--> statement-breakpoint
CREATE INDEX "artifact_links_artifact_id_idx" ON "artifact_links" USING btree ("artifact_id");--> statement-breakpoint
CREATE INDEX "artifact_links_run_id_idx" ON "artifact_links" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "artifact_links_run_step_id_idx" ON "artifact_links" USING btree ("run_step_id");--> statement-breakpoint
CREATE INDEX "artifact_links_run_event_id_idx" ON "artifact_links" USING btree ("run_event_id");--> statement-breakpoint
CREATE INDEX "artifacts_run_id_idx" ON "artifacts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "artifacts_run_id_kind_idx" ON "artifacts" USING btree ("run_id","kind");--> statement-breakpoint
CREATE INDEX "artifacts_run_step_id_idx" ON "artifacts" USING btree ("run_step_id");--> statement-breakpoint
CREATE INDEX "run_events_run_id_event_type_idx" ON "run_events" USING btree ("run_id","event_type");--> statement-breakpoint
CREATE INDEX "run_events_run_step_id_idx" ON "run_events" USING btree ("run_step_id");--> statement-breakpoint
CREATE INDEX "run_steps_run_id_sequence_idx" ON "run_steps" USING btree ("run_id","sequence");--> statement-breakpoint
CREATE INDEX "runs_agent_version_id_idx" ON "runs" USING btree ("agent_version_id");--> statement-breakpoint
CREATE INDEX "runs_status_idx" ON "runs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "runs_queued_at_idx" ON "runs" USING btree ("queued_at");