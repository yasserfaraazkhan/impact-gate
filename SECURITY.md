# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | Yes               |
| < 1.0   | No                |

## Reporting a Vulnerability

If you discover a security vulnerability in impact-gate, please report it responsibly.

**Do NOT open a public GitHub issue for security vulnerabilities.**

Instead, please use [GitHub Security Advisories](https://github.com/yasserfaraazkhan/impact-gate/security/advisories/new) to report the vulnerability, or email security concerns to the repository maintainer with:

1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

We will acknowledge receipt within 48 hours and provide a detailed response within 7 days.

## Security Measures

This project implements several security measures:

- **Path validation** — prevents directory traversal in MCP server
- **Glob pattern validation** — blocks access to sensitive files (.env, .pem, .key)
- **Rate limiting** — 100 requests/minute on MCP server
- **Write restrictions** — MCP server can only write test specs and .e2e-ai-agents/ files
- **Error sanitization** — internal details are not leaked in error messages
- **API key protection** — keys are never logged or included in artifacts
