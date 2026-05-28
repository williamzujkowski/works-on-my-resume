---
name: Priya Salgado
role: Software Engineer — Backend
location: Toronto, ON
email: priya.salgado@example.com
phone: +1 (416) 555-0118
links:
  - label: GitHub
    url: https://github.com/priya-salgado-example
  - label: LinkedIn
    url: https://www.linkedin.com/in/priya-salgado-example
---

## Summary

Backend engineer with four years building reliable APIs and data
pipelines for fintech and logistics products. Comfortable owning a
service from design doc through on-call.

## Experience

### Software Engineer II — Beacon Settlements

_Jul 2023 – Present · Toronto, ON (hybrid)_

Own the payouts service that moves money between merchant balances and
external banks.

- Redesigned the idempotency layer; **duplicate-payout incidents went
  from 7 in 2023 to 0 in the past 12 months.**
- Migrated 240 GB of ledger history from a single Postgres instance to
  per-region shards with zero customer-visible downtime.
- Reduced p99 payout-initiation latency from **820 ms to 190 ms** by
  collapsing two synchronous fan-outs into a queued worker.
- Wrote the on-call runbook the team now uses for every payout-related
  page; mean time to acknowledgement dropped to under 4 minutes.
- Mentored a new-grad engineer through their first quarter; they shipped
  a card-issuance feature on time and now own it solo.

### Software Engineer — Cartograph Freight

_Aug 2021 – Jun 2023 · Toronto, ON_

Backend engineer on the route-planning team for a mid-market freight broker.

- Built the carrier-rate API consumed by every shipper integration; it
  has served **\>120 million requests** at a 99.97% success rate.
- Replaced a hand-rolled job scheduler with a queue-backed worker pool,
  cutting overnight plan-recompute time from 3 hours to 22 minutes.
- Wrote the internal "how we paginate" guideline after a customer-facing
  cursor bug; every new endpoint since has followed it.

### Junior Software Engineer — Cartograph Freight

_Jan 2021 – Jul 2021 · Toronto, ON_

- Promoted to Software Engineer after a strong first two quarters.
- Owned a refactor of the dispatch dashboard's data-loading layer.

## Skills

| Area           | Tools                                           |
| -------------- | ----------------------------------------------- |
| Languages      | Go, TypeScript, Python, SQL                     |
| Datastores     | PostgreSQL, Redis, ClickHouse                   |
| Infrastructure | AWS (ECS, RDS, SQS), Terraform, GitHub Actions  |
| Observability  | OpenTelemetry, Prometheus, Grafana, Sentry      |
| Practices      | Design docs, code review, blameless postmortems |

## Projects

### postmortem-bot

_Go, GitHub App · personal project_

A GitHub App that turns a tagged incident channel transcript into a
postmortem draft. Internal version saw adoption across three teams at
Beacon Settlements; the public version has **180 stars** on GitHub.

## Education

### B.A.Sc. Computer Engineering — University of Waterloo

_2016 – 2020 · Waterloo, ON_
