# Incident email content Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send actionable Vietnamese SNS emails describing the actual event and linking to its private evidence image.

**Architecture:** The user selected SNS with detailed text and an image link. Enrich only a verified REAL email claim after the normal owner, recipient and rate checks. Read metadata for that event/camera/owner and sign one available snapshot using the application's storage adapter. Keep jobs/outcomes free of image URLs and keep DRY_RUN delivery generic. Missing images or signing failures must not suppress the incident alert.

**Tech Stack:** NestJS/TypeScript, PostgreSQL, existing S3/MinIO storage adapter, SNS, Jest integration tests.

**Spec:** User request and explicit choice on 2026-11-22: retain SNS; include event type, severity, detection time, camera, zone and a private image link. No SES or HTML email.

## Tasks

- [x] Add failing formatter and PostgreSQL claim tests for Vietnamese metadata, correct snapshot selection, recipient isolation, expiry/failure handling and PII-free DRY_RUN.
- [x] Add `notification-email.ts` for rendering and evidence lookup; inject optional storage into `NotificationCloudService` and pass email options through `claimNotification`. Do not modify the job/outcome contract.
- [x] Run notification coverage above 90% for lines and branches, typecheck, lint, formatting and secret checks. Preserve earlier changes. The user authorized small logical commits after reviewing the email; do not push.
- [ ] Recreate Dev backend, verify scoped callback, inspect stale jobs with sending disabled, then enable controlled real testing with the existing verified household A recipient. Verify a new app event, provider result, detailed email and image opening with the user. Record exactly what passed.

## Acceptance record

The user approved the alert format on 2026-11-22. Runtime preview and S3 image GET passed; a separate confirmation of opening a newly delivered image link is not recorded. Staging/Production deployment remains outside this change.
