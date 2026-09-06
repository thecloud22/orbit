CREATE TABLE "execution_bindings" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"step_id" text NOT NULL,
	"binding_number" integer NOT NULL,
	"binding" jsonb NOT NULL,
	"binding_sha256" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"captured_against_revision_id" text,
	"parent_binding_id" text,
	"superseded_by_binding_id" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "execution_bindings_document_step_number_unique" UNIQUE("document_id","step_id","binding_number"),
	CONSTRAINT "execution_bindings_state_check" CHECK ("execution_bindings"."state" IN ('draft', 'needs_review', 'approved', 'rejected', 'superseded')),
	CONSTRAINT "execution_bindings_binding_sha256_check" CHECK ("execution_bindings"."binding_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "execution_bindings_binding_number_check" CHECK ("execution_bindings"."binding_number" >= 1),
	CONSTRAINT "execution_bindings_reviewed_at_check" CHECK ("execution_bindings"."state" NOT IN ('approved', 'rejected') OR "execution_bindings"."reviewed_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "execution_bindings" ADD CONSTRAINT "execution_bindings_document_id_sop_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."sop_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_bindings" ADD CONSTRAINT "execution_bindings_captured_against_revision_id_sop_graph_revisions_id_fk" FOREIGN KEY ("captured_against_revision_id") REFERENCES "public"."sop_graph_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_bindings" ADD CONSTRAINT "execution_bindings_parent_binding_id_execution_bindings_id_fk" FOREIGN KEY ("parent_binding_id") REFERENCES "public"."execution_bindings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_bindings" ADD CONSTRAINT "execution_bindings_superseded_by_binding_id_execution_bindings_id_fk" FOREIGN KEY ("superseded_by_binding_id") REFERENCES "public"."execution_bindings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "execution_bindings_document_id_idx" ON "execution_bindings" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "execution_bindings_state_idx" ON "execution_bindings" USING btree ("state");