-- Extends the artifact kind and role vocabularies for the terminal and API
-- surfaces (ADR-037).
--
-- Written by hand because drizzle-kit does not detect a changed CHECK
-- constraint: `db:generate` reported "no schema changes" while the constraint
-- still listed only the six browser-era kinds. The symptom was a run that made
-- its API call successfully and then failed persisting the evidence, which is
-- an expensive way to find out.

ALTER TABLE "artifacts" DROP CONSTRAINT IF EXISTS "artifacts_kind_check";
ALTER TABLE "artifacts" ADD CONSTRAINT "artifacts_kind_check" CHECK ("kind" IN (
  'browser_screenshot',
  'dom_snapshot',
  'browser_trace',
  'extracted_json',
  'error_context',
  'decision_input',
  'terminal_screen',
  'api_exchange'
));

ALTER TABLE "artifact_links" DROP CONSTRAINT IF EXISTS "artifact_links_role_check";
ALTER TABLE "artifact_links" ADD CONSTRAINT "artifact_links_role_check" CHECK ("role" IN (
  'screenshot_after_action',
  'dom_snapshot',
  'browser_trace',
  'error_context',
  'extracted_json',
  'decision_input',
  'screen_after_action',
  'api_exchange'
));
