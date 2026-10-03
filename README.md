# ZipKit MCP Server

**Hosted endpoint:** https://zipkit-mcp.scy1he02.workers.dev
Thailand tax, visa & expat-money tools exposed as an MCP (Model Context Protocol) server for AI agents.

## Access and monetization status

- **Free tools:** tax calculator, remittance checker, residency counter
- **Premium-gated tools:** remittance review checklist (tax estimates unavailable) + Thai expert knowledge base
- Premium access checks one shared `x-zipkit-key` against the deployment's `ZIPKIT_PREMIUM_KEY` secret
- This repository does not implement subscription verification, Stripe checkout/webhooks, per-customer key issuance or revocation, multiple user keys per plan, or tier-specific usage quotas. A pricing page or shared-key gate alone does not establish those capabilities; paid fulfillment needs separate verification
- MCPize's [monetization guide](https://mcpize.com/docs/monetization) states an **80% default revenue share**. Its [terms](https://mcpize.com/terms) reserve the **85% Founding Member share** for servers monetized before June 10, 2026. No qualifying activation is established by this repository

## Processing and privacy

MCP requests send tool arguments to the hosted Cloudflare Worker, which parses
the request and runs the tool handlers remotely. Browser-local processing
descriptions for separate website tools do not apply to this MCP endpoint.
`wrangler.toml` enables Worker observability; the deployed logging and retention
settings are not established here.

## Tools

| Tool | Tier | What it does |
|---|---|---|
| thai_tax_calculator | Free | Official 0–35% progressive brackets w/ breakdown |
| remittance_tax_checker | Free | Review checklist; always NEEDS_REVIEW |
| residency_day_counter | Free | 180-day threshold evaluation from stay pairs |
| remittance_rule_engine | 🔒 | Review checklist; tax and planning estimates unavailable |
| thai_expert_query | 🔒 | Curated KB: banking-by-visa, visa reqs, insurance, fees, deadlines, cost-of-living |

## Usage (HTTP JSON-RPC)

These examples use synthetic data. Configure MCP clients for this HTTP endpoint;
compatibility with every client has not been established.

```bash
# List tools
curl -X POST https://zipkit-mcp.scy1he02.workers.dev/ \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

# Call a tool
curl -X POST https://zipkit-mcp.scy1he02.workers.dev/ \
  -H "content-type: application/json" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"thai_tax_calculator","arguments":{"annual_income_thb":1200000}}}'
```

Premium calls add header: `-H "x-zipkit-key: <key>"`

## Remittance safeguard and response contract

The two remittance tools now return `verdict: "NEEDS_REVIEW"` and
`assessment_available: false` for all inputs. `combined_estimate` and `planning`
are `null`, not zero. Each premium remittance item has `status: "NEEDS_REVIEW"`
and `taxable: null`, which means **undetermined**, not exempt or non-taxable.
Callers must check the verdict before rendering estimates or doing arithmetic;
do not coerce null/absent values to zero or treat a falsy `taxable` as exemption.
This is an intentional output-contract change. External clients have not been
verified compatible.

Legacy input names remain accepted, including the deprecated
`foreign_tax_paid_above_15pct_with_proof` flag. Supplied values are retained as
review evidence; missing values are unknown rather than assumed false or zero.
For `remittance_rule_engine`, `annual_assessable_income_thb` remains other income
excluding `planned_remittances_thb`. Neither this input nor the remittance amounts
are used to issue a tax or timing-savings result.

The schema lacks income-year residency, source country, income category,
applicable treaty/taxing rights, actual foreign tax paid and credit-limit details.
A foreign tax percentage and proof alone cannot establish an exemption or credit.
The standalone `thai_tax_calculator` arithmetic for valid numbers is unchanged;
null and non-numeric income/deduction inputs now return tool errors. Its outputs do not
establish remittance assessability, deductions or credit entitlement.

Sources for the safeguard review (3 October 2026):
- [RD foreign tax credit manual, November 2025](https://www.rd.go.th/fileadmin/user_upload/porphor/GuideTaxFromAbroad_EN.pdf)
- [RD Por.161/162 Q&A](https://www.rd.go.th/fileadmin/download/news/question_p161_162.pdf)
- [Por.161](https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dn161A.pdf) and [Por.162](https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dn162A.pdf)

A source change does not establish the hosted endpoint's deployed version. Verify
that endpoint separately before relying on this response contract. Do not use
older exemption or savings outputs for decisions.

## Local regression tests

With a Node.js version supporting `node:test` and Web `Request`/`Response` APIs
(verified with Node 24):

```bash
node --check src/index.js
node --test tests/remittance-planning.test.mjs
```

These tests invoke the Worker handler locally with synthetic inputs and a dummy
key. They cover the 14.9/15/15.1% boundaries, proof and residency variations,
missing data, null-estimate semantics, unchanged arithmetic and the premium gate.
They require no package installation, live endpoint, or real credentials. They
do not validate tax law or external-client compatibility.

## Deploy / operate

```
npm install
npx wrangler dev          # local
npx wrangler deploy       # production
npx wrangler secret put ZIPKIT_PREMIUM_KEY   # set premium gate key
```

## Distribution status and verification

- Existing [Glama listing](https://glama.ai/mcp/servers/sniertough/zipkit-mcp); verify connection/deployment support separately before advertising one-click installation
- Existing [pricing page](https://zipkit.cc/mcp/); as of October 2, 2026, it says the Stripe payment link is coming. Working checkout and subscription provisioning remain unverified
- [ ] Check current PulseMCP, mcp.so, and Smithery listing status before submitting duplicates
- [ ] Verify MCPize publication, payout setup, and end-to-end paid access before claiming marketplace availability
- [ ] Check website cross-links before adding an "Available as MCP server" badge

## Data caveat
All knowledge-base content mirrors zipkit.cc research with `asof: 2026-08` stamps.
Update cadence: whenever ZipKit money guides get fact-checked, mirror changes here.
