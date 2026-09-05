# Orbit Phase 1 Security Baseline

**Status:** Active Phase 1 baseline

**Purpose:** Define security constraints for the local deterministic proof loop and ensure the first implementation does not establish unsafe patterns.

## Scope

Phase 1 is a local, read-only, synthetic-data demo. It is not a production security certification or authorization to connect to customer systems.

## Mandatory controls

### Target isolation

- Browser automation may navigate to `localhost` only.
- The only target is Orbit's controlled demo portal.
- Do not add arbitrary URL execution.
- Do not add external browser targets, production systems, or third-party SaaS systems.

### Data safety

- Use only synthetic request data such as `SR-1001`.
- Do not use customer, employee, financial, health, or regulated data.
- Do not upload production documents.
- Do not store secrets in database fixtures, Agent IR, SOPs, logs, events, screenshots, DOM snapshots, traces, or source control.

### Credentials

- Phase 1 uses no credentials.
- Do not simulate secret handling by hard-coding fake credentials into production-style interfaces.
- Preserve future secret-reference boundaries, but do not implement a real secret manager yet.

### Execution safety

- Workflow is read-only.
- Demo portal must not change data.
- Do not implement generic arbitrary code steps.
- Do not use `eval`, `Function`, arbitrary shell commands, or dynamically generated executable code.
- Use restricted variable interpolation only.
- Do not use browser coordinate actions.

### Artifact handling

- Artifact bytes are stored outside PostgreSQL.
- Local artifact directories are gitignored.
- Artifacts are not served directly from a public static directory.
- Do not log raw trace paths or artifact contents indiscriminately.
- Create metadata fields that can later support sensitivity labels and access checks.

### Browser worker

- Browser worker is a separate process from API.
- Use an isolated Playwright context for each run.
- Enforce browser domain allowlist before navigation.
- Apply timeouts and close browser contexts after runs.
- Capture only the artifacts required by Phase 1.

### Logging and errors

- Use structured logs.
- Never log secrets or arbitrary raw page content by default.
- Return safe errors through the API.
- Preserve typed error classification and safe diagnostic context.

## Threats intentionally deferred

These need design hooks but are not fully implemented in Phase 1:

- Multi-tenant isolation
- SSO and RBAC
- Secret manager/Vault integration
- PII redaction and artifact access authorization
- MFA/CAPTCHA support
- Network egress policies beyond localhost restriction
- Audit log for user/security operations
- Data retention/legal hold
- Prompt injection defenses for runtime LLMs
- High-impact action policy and approval controls

## Security readiness gate for Phase 2+

Before connecting any real external system or accepting real SOP documents, reassess:

- Authentication and authorization
- Secret management
- Artifact access controls and redaction
- Tenant/data isolation
- Target system authorization and terms
- Browser worker network isolation
- Audit logging
- Threat model and privacy review
