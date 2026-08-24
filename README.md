# ZipKit MCP Server

**Live:** https://zipkit-mcp.scy1he02.workers.dev
Thailand tax, visa & expat-money tools exposed as an MCP (Model Context Protocol) server for AI agents.

## The business logic

- **Free tools** drive adoption: tax calculator, remittance checker, residency counter
- **Premium tools** monetize: remittance rule engine (multi-year planning scenarios) + Thai expert knowledge base
- Premium unlocked via `x-zipkit-key` header matching `ZIPKIT_PREMIUM_KEY` secret
- Monetization path: list on MCPize (85% rev share, they handle billing) or sell keys direct via zipkit.cc/mcp + Stripe

## Tools

| Tool | Tier | What it does |
|---|---|---|
| thai_tax_calculator | Free | Official 0–35% progressive brackets w/ breakdown |
| remittance_tax_checker | Free | Por.161/162 four-factor verdict |
| residency_day_counter | Free | 180-day threshold evaluation from stay pairs |
| remittance_rule_engine | 🔒 | Multi-year split scenarios + savings computation |
| thai_expert_query | 🔒 | Curated KB: banking-by-visa, visa reqs, insurance, fees, deadlines, cost-of-living |

## Usage (any MCP client / raw JSON-RPC)

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

## Deploy / operate

```
npm install
npx wrangler dev          # local
npx wrangler deploy       # production
npx wrangler secret put ZIPKIT_PREMIUM_KEY   # set premium gate key
```

## Distribution TODO
- [ ] Submit to PulseMCP, mcp.so, Glama, Smithery (free listings)
- [ ] Apply to MCPize marketplace (85% share, billing handled)
- [ ] Create zipkit.cc/mcp pricing page → Stripe key sales
- [ ] Add "Available as MCP server" badge on ZipKit tool pages (cross-marketing)

## Data caveat
All knowledge-base content mirrors zipkit.cc research with `asof: 2026-08` stamps.
Update cadence: whenever ZipKit money guides get fact-checked, mirror changes here.
