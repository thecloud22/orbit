CREATE TABLE "model_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"document_id" text,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"input_tokens" integer NOT NULL,
	"output_tokens" integer NOT NULL,
	"estimated_cost_micro_usd" bigint NOT NULL,
	"attempt" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_usage_input_tokens_check" CHECK ("model_usage"."input_tokens" >= 0),
	CONSTRAINT "model_usage_output_tokens_check" CHECK ("model_usage"."output_tokens" >= 0),
	CONSTRAINT "model_usage_cost_check" CHECK ("model_usage"."estimated_cost_micro_usd" >= 0),
	CONSTRAINT "model_usage_attempt_check" CHECK ("model_usage"."attempt" >= 1)
);
--> statement-breakpoint
ALTER TABLE "model_usage" ADD CONSTRAINT "model_usage_document_id_sop_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."sop_documents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "model_usage_request_id_idx" ON "model_usage" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "model_usage_document_id_idx" ON "model_usage" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "model_usage_created_at_idx" ON "model_usage" USING btree ("created_at");