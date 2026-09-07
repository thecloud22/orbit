CREATE TABLE "agent_ir_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"revision_id" text NOT NULL,
	"candidate_number" integer NOT NULL,
	"agent_ir" jsonb NOT NULL,
	"agent_ir_sha256" text NOT NULL,
	"outcome_mapping" jsonb NOT NULL,
	"compiled_from_binding_ids" jsonb NOT NULL,
	"secret_input_ids" jsonb NOT NULL,
	"sandbox_state" text DEFAULT 'not_assessed' NOT NULL,
	"sandbox_note" text,
	"state" text DEFAULT 'compiled' NOT NULL,
	"superseded_by_candidate_id" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "agent_ir_candidates_document_number_unique" UNIQUE("document_id","candidate_number"),
	CONSTRAINT "agent_ir_candidates_state_check" CHECK ("agent_ir_candidates"."state" IN ('compiled', 'approved', 'rejected', 'superseded')),
	CONSTRAINT "agent_ir_candidates_sandbox_state_check" CHECK ("agent_ir_candidates"."sandbox_state" IN ('not_assessed', 'ready', 'cannot_validate')),
	CONSTRAINT "agent_ir_candidates_sha256_check" CHECK ("agent_ir_candidates"."agent_ir_sha256" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "agent_ir_candidates" ADD CONSTRAINT "agent_ir_candidates_document_id_sop_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."sop_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_ir_candidates" ADD CONSTRAINT "agent_ir_candidates_revision_id_sop_graph_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."sop_graph_revisions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_ir_candidates" ADD CONSTRAINT "agent_ir_candidates_superseded_by_candidate_id_agent_ir_candidates_id_fk" FOREIGN KEY ("superseded_by_candidate_id") REFERENCES "public"."agent_ir_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_ir_candidates_document_id_idx" ON "agent_ir_candidates" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "agent_ir_candidates_state_idx" ON "agent_ir_candidates" USING btree ("state");