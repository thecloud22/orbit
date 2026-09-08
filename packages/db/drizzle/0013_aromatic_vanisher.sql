CREATE TABLE "api_systems" (
	"id" text PRIMARY KEY NOT NULL,
	"catalog_id" text NOT NULL,
	"name" text NOT NULL,
	"spec_text" text NOT NULL,
	"auth_scheme" text DEFAULT 'none' NOT NULL,
	"credential_ref" text,
	"auth_header_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_systems_catalog_id_unique" UNIQUE("catalog_id"),
	CONSTRAINT "api_systems_auth_scheme_check" CHECK ("api_systems"."auth_scheme" IN ('none', 'bearer', 'basic'))
);
