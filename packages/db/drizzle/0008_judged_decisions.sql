ALTER TABLE "artifact_links" DROP CONSTRAINT "artifact_links_role_check";--> statement-breakpoint
ALTER TABLE "artifacts" DROP CONSTRAINT "artifacts_kind_check";--> statement-breakpoint
ALTER TABLE "run_events" DROP CONSTRAINT "run_events_event_type_check";--> statement-breakpoint
ALTER TABLE "model_usage" ADD COLUMN "run_id" text;--> statement-breakpoint
ALTER TABLE "model_usage" ADD COLUMN "agent_version_id" text;--> statement-breakpoint
ALTER TABLE "model_usage" ADD CONSTRAINT "model_usage_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_usage" ADD CONSTRAINT "model_usage_agent_version_id_agent_versions_id_fk" FOREIGN KEY ("agent_version_id") REFERENCES "public"."agent_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_usage_run_id_idx" ON "model_usage" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "model_usage_agent_version_id_idx" ON "model_usage" USING btree ("agent_version_id");--> statement-breakpoint
ALTER TABLE "artifact_links" ADD CONSTRAINT "artifact_links_role_check" CHECK ("artifact_links"."role" IN ('screenshot_after_action', 'dom_snapshot', 'browser_trace', 'error_context', 'extracted_json', 'decision_input'));--> statement-breakpoint
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_kind_check" CHECK ("artifacts"."kind" IN ('browser_screenshot', 'dom_snapshot', 'browser_trace', 'extracted_json', 'error_context', 'decision_input'));--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_event_type_check" CHECK ("run_events"."event_type" IN ('run.queued', 'run.started', 'run.completed', 'run.failed', 'step.started', 'step.completed', 'step.failed', 'browser.navigation.completed', 'browser.fill.completed', 'browser.click.completed', 'browser.extract.completed', 'assertion.passed', 'assertion.failed', 'decision.requested', 'decision.resolved', 'decision.refused', 'artifact.created'));