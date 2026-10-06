# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report vulnerabilities privately through GitHub's **private vulnerability
reporting** on this repository: open the **Security** tab and choose
**Report a vulnerability**. Include:

- a description of the issue and its potential impact,
- steps to reproduce (a minimal proof of concept is ideal),
- any suggested fix.

Reports are acknowledged as soon as practical. Please allow reasonable time
for a fix before any public disclosure.

## Scope

This repository is a source snapshot published for review. In scope:

- vulnerabilities in the code in this repository (authentication and
  authorization, tenant isolation, injection, SSRF, sensitive-data exposure),
- secrets or personal data accidentally present in the repository.

Out of scope: denial-of-service testing, social engineering, and testing
against any live deployment or third-party service.

## Security controls in the codebase

- Helmet with a nonce-based CSP on the API; security headers and CSP on the
  web app (`frontend/lib/security-headers.ts`)
- Configuration-only CORS allowlist (no built-in production origins)
- Platform-admin privilege held only in the database (`users.platform_admin`),
  never derived from an email address
- Fail-closed configuration: required secrets have no defaults; production
  boot fails without `JWT_SECRET`, `DATA_ENCRYPTION_KEY` and `API_KEY_PEPPER`
- Input validation (class-validator, whitelist + forbidNonWhitelisted)
- Application-level AES-256-GCM encryption for sensitive fields
- Row-level-security policies for tenant isolation (see `backend-node/docs/security/rls-architecture.md`)
- Audit logging interceptor, PII scrubbing for error reporting
- CI: secret scanning (gitleaks), blocking dependency audit, Dependabot
