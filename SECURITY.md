# Security Policy

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 3.x     | yes                |
| < 3.0   | no                 |

## Reporting a Vulnerability

If you discover a security vulnerability in CosmoRisk, please report it responsibly.

### How to Report

1. **DO NOT** create a public GitHub issue for security vulnerabilities
2. Send an email to: **spacegumus@gmail.com**
3. Include the following information:
   - Description of the vulnerability
   - Steps to reproduce
   - Potential impact
   - Suggested fix (if any)

### What to Expect

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Resolution**: Depends on severity (critical: 24-48h, high: 7 days, medium: 30 days)

### Disclosure Policy

- We follow responsible disclosure practices
- We will credit researchers who report valid vulnerabilities (unless anonymity is requested)
- Please allow us reasonable time to fix the issue before public disclosure

## Security Measures

This application:
- Needs no API keys; talks only to ssd-api.jpl.nasa.gov over HTTPS
- Runs the interface under a strict Content Security Policy and escapes all external text
- Does not collect or transmit personal data
- Uses HTTPS for all API communications
- Runs in a sandboxed Tauri environment

## Contact

- Security issues: spacegumus@gmail.com
- General inquiries: [spacegumus.com.tr](https://spacegumus.com.tr)

---

*Last updated: 18.12.2025*
