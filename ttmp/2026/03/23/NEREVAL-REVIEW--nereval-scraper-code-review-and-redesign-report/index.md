---
Title: Nereval scraper code review and redesign report
Ticket: NEREVAL-REVIEW
Status: review
Topics:
    - nereval
    - scraping
    - sqlite
    - queue
    - proxy
DocType: index
Intent: long-term
Owners: []
RelatedFiles: []
ExternalSources: []
Summary: "Ticket for the evidence-backed code review, architecture analysis, and redesign plan for the current nereval scraper."
LastUpdated: 2026-03-23T00:25:39.896955304-04:00
WhatFor: "Explain the current nereval scraper/app system, capture key correctness and complexity findings, and provide a pragmatic redesign plan."
WhenToUse: "Use when onboarding to nereval, reviewing its queue/cache/retry behavior, or planning the next refactor."
---

# Nereval scraper code review and redesign report

## Overview

This ticket contains a fresh review of the current `nereval/` scraper implementation. It is intentionally separate from the earlier NEREVAL tickets because the deliverable here is a code review and redesign report for the code as it exists now, with a strong onboarding focus for a new intern.

The main outputs are:

- a detailed design/code-review document that explains the scraper end to end,
- a second design document that lays out the target Go backend plus React/Redux frontend rewrite with WebSocket progress,
- a chronological diary of how the evidence was gathered and how the deliverable was produced,
- ticket bookkeeping for validation and delivery.

## Key Links

- Review/design doc: `design-doc/01-nereval-scraper-architecture-review-and-redesign-guide.md`
- Go/React redesign doc: `design-doc/02-go-backend-and-react-redux-frontend-redesign-with-websocket-progress.md`
- Diary: `reference/01-investigation-diary.md`
- Main code under review: `nereval/`

## Status

Current status: **review**

## Topics

- nereval
- scraping
- sqlite
- queue
- proxy

## Tasks

See [tasks.md](./tasks.md) for the current task list.

## Changelog

See [changelog.md](./changelog.md) for recent changes and decisions.

## Structure

- design-doc/ - Architecture and design documents
- reference/ - Prompt packs, API contracts, context summaries
- playbooks/ - Command sequences and test procedures
- scripts/ - Temporary code and tooling
- various/ - Working notes and research
- archive/ - Deprecated or reference-only artifacts
