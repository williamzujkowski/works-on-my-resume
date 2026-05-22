---
name: Avery Quinn
role: Senior Platform Engineer
location: Portland, OR
email: avery.quinn@example.com
phone: +1 (503) 555-0142
links:
  - label: LinkedIn
    url: https://www.linkedin.com/in/avery-quinn-example
  - label: GitHub
    url: https://github.com/avery-quinn-example
  - label: Website
    url: https://avery-quinn.example.com
---

## Summary

Platform engineer with **eight years** turning brittle deploy pipelines into
boring, reliable infrastructure. I care about developer experience, build
systems, and the unglamorous reliability work that makes everything else fast.
I like _small interfaces_, fast feedback loops, and documentation that ages
well — and I am comfortable owning a system end to end, from the on-call pager
to the architecture review.

> "Make it work, make it boring, then go home on time."

## Selected Impact

- **Cut median CI time from 19 minutes to 4.** Introduced remote build caching
  and test sharding across 140 services, reclaiming an estimated 600
  engineer-hours per month.
- **Took deploy frequency from weekly to on-demand.** Replaced a hand-rolled
  release script with a progressive-delivery pipeline; change-failure rate
  dropped by half over two quarters.
- **Wrote the golden-path service template** now used by every new backend at
  the company — observability, security scanning, and CI wired in by default.
- **Led the migration off a single shared database** to per-service stores
  with zero customer-facing downtime across a six-month rollout.

## Experience

### Senior Platform Engineer — Northwind Logistics

_Mar 2021 – Present · Portland, OR (remote)_

Own the internal build-and-deploy platform used by roughly 120 engineers.

- Designed the remote caching layer that cut CI times by 4x; the cache key
  derivation lives in a small, well-tested `cache-key` library.
- Run the platform on-call rotation and the quarterly reliability review.
- Drove adoption of the golden-path template across **34 of 36** active teams.
- Mentored three engineers; two have since been promoted to senior.

Rollout of the progressive-delivery pipeline followed a deliberate order:

1. Shadow deploys against production traffic, with no user impact.
2. Automated canary analysis gating every promotion on real metrics.
3. One-click rollback wired to the same health signals as the canary.
4. Self-service onboarding so teams adopt it without a platform ticket.

### Infrastructure Engineer — Cobalt Maps

_Jun 2018 – Feb 2021 · Seattle, WA_

- Built the Kubernetes-based deploy tooling for a 40-person engineering org.
- Introduced infrastructure-as-code with `terraform`, eliminating a class of
  config-drift incidents that had caused three outages the prior year.
- Created an on-call runbook program that cut mean time to recovery by 35%.
- Partnered with security to ship secret rotation as a platform default.

### Software Engineer — Driftwood Software

_Aug 2016 – May 2018 · Seattle, WA_

- Shipped features across a Ruby and TypeScript web application.
- Volunteered for the build-tooling rotation — and discovered a calling.

## Skills

A pragmatic toolkit, weighted toward the parts of the stack I have shipped and
operated in production:

| Area           | Tools                              | Depth      |
| -------------- | ---------------------------------- | ---------- |
| Languages      | Go, TypeScript, Python, Bash       | Expert     |
| Orchestration  | Kubernetes, Nomad, Docker          | Expert     |
| Cloud          | AWS, GCP, Cloudflare               | Proficient |
| CI/CD          | GitHub Actions, Buildkite, Argo    | Expert     |
| Infrastructure | Terraform, Pulumi, Packer          | Proficient |
| Observability  | Prometheus, Grafana, OpenTelemetry | Proficient |

**Working style:** documentation-first, small reversible changes, and
blameless postmortems. I would rather ship a boring fix today than an elegant
one next quarter.

## Education

### B.S. Computer Science — University of Oregon

_2012 – 2016 · Eugene, OR_

- Minor in Technical Writing; teaching assistant for the operating-systems
  course for three terms.
- Capstone: a distributed key-value store with tunable consistency.

## Selected Writing

- [_Caching is a contract_](https://avery-quinn.example.com/caching-contract) —
  on why build caches fail quietly and how to make them fail loudly.
- [_The on-call rotation is a product_](https://avery-quinn.example.com/oncall) —
  treating reliability work as something with users.

---

_References available on request. This is a fictional sample resume shipped
with Works on My Resume to demonstrate the renderer across themes._
