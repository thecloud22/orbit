CREATE TABLE "sop_clarification_answers" (
	"id" text PRIMARY KEY NOT NULL,
	"revision_id" text NOT NULL,
	"question_id" text NOT NULL,
	"answer" text NOT NULL,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sop_clarification_answers_revision_question_unique" UNIQUE("revision_id","question_id")
);
--> statement-breakpoint
CREATE TABLE "sop_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"source_text" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sop_graph_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"revision_number" integer NOT NULL,
	"graph" jsonb NOT NULL,
	"graph_sha256" text NOT NULL,
	"state" text DEFAULT 'draft' NOT NULL,
	"provenance" jsonb NOT NULL,
	"parent_revision_id" text,
	"superseded_by_revision_id" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sop_graph_revisions_document_id_revision_number_unique" UNIQUE("document_id","revision_number"),
	CONSTRAINT "sop_graph_revisions_state_check" CHECK ("sop_graph_revisions"."state" IN ('draft', 'needs_clarification', 'in_review', 'approved', 'rejected', 'superseded')),
	CONSTRAINT "sop_graph_revisions_graph_sha256_check" CHECK ("sop_graph_revisions"."graph_sha256" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "sop_graph_revisions_revision_number_check" CHECK ("sop_graph_revisions"."revision_number" >= 1),
	CONSTRAINT "sop_graph_revisions_reviewed_at_check" CHECK ("sop_graph_revisions"."state" NOT IN ('approved', 'rejected') OR "sop_graph_revisions"."reviewed_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "sop_clarification_answers" ADD CONSTRAINT "sop_clarification_answers_revision_id_sop_graph_revisions_id_fk" FOREIGN KEY ("revision_id") REFERENCES "public"."sop_graph_revisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_graph_revisions" ADD CONSTRAINT "sop_graph_revisions_document_id_sop_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."sop_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_graph_revisions" ADD CONSTRAINT "sop_graph_revisions_parent_revision_id_sop_graph_revisions_id_fk" FOREIGN KEY ("parent_revision_id") REFERENCES "public"."sop_graph_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sop_graph_revisions" ADD CONSTRAINT "sop_graph_revisions_superseded_by_revision_id_sop_graph_revisions_id_fk" FOREIGN KEY ("superseded_by_revision_id") REFERENCES "public"."sop_graph_revisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sop_clarification_answers_revision_id_idx" ON "sop_clarification_answers" USING btree ("revision_id");--> statement-breakpoint
CREATE INDEX "sop_graph_revisions_document_id_idx" ON "sop_graph_revisions" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "sop_graph_revisions_state_idx" ON "sop_graph_revisions" USING btree ("state");