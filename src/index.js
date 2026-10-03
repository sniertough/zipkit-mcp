/**
 * ZipKit MCP Server — Thailand tax, visa & expat-money tools for AI agents.
 *
 * Free tools:
 *   - thai_tax_calculator      Progressive tax brackets 0–35%
 *   - remittance_tax_checker   Remittance review checklist (no tax verdict)
 *   - residency_day_counter    180-day threshold calculator
 *
 * Premium tools (require ZIPKIT_PREMIUM_KEY header):
 *   - remittance_rule_engine   Remittance review checklist (estimates withheld)
 *   - thai_expert_query        Curated Thai-expat knowledge base lookup
 *
 * Data source: zipkit.cc research (Revenue Dept orders, official schedules).
 */

const BRACKETS_2026 = [
  { cap: 150000, rate: 0 },
  { cap: 300000, rate: 0.05 },
  { cap: 500000, rate: 0.10 },
  { cap: 750000, rate: 0.15 },
  { cap: 1000000, rate: 0.20 },
  { cap: 2000000, rate: 0.25 },
  { cap: 5000000, rate: 0.30 },
  { cap: Infinity, rate: 0.35 },
];

function computeThaiTax(income, deductions) {
  const std = Math.min(income * 0.5, 100000);
  const ded = (deductions ?? std + 60000);
  const net = Math.max(0, income - ded);
  let tax = 0, prev = 0;
  const lines = [];
  for (const b of BRACKETS_2026) {
    if (net > prev) {
      const slice = Math.min(net, b.cap) - prev;
      const t = slice * b.rate;
      if (t > 0) lines.push({ rate: b.rate, slice_thb: Math.round(slice), tax_thb: Math.round(t) });
      tax += t; prev = b.cap;
    }
  }
  return {
    net_taxable_thb: Math.round(net),
    deductions_applied_thb: Math.round(ded),
    estimated_tax_thb: Math.round(tax),
    effective_rate_pct: +(net > 0 ? (tax / net) * 100 : 0).toFixed(2),
    bracket_breakdown: lines,
  };
}

// These schemas do not collect enough facts to determine remittance tax or relief.
// Preserve the submitted evidence without treating a current-year residency answer
// or a foreign-tax rate/proof flag as an income-year or treaty determination.
const REMITTANCE_REVIEW_CHECKLIST = [
  'Verify when each income amount arose and residency in that income year; the current-year 180-day answer is insufficient for earlier income.',
  'Verify the source country, income category, applicable treaty, treaty residence and taxing rights.',
  'Verify the actual foreign income tax paid, its connection to the income, payment evidence and applicable credit limit.',
  'Verify the nature of the funds and the remittance amount, date and method; remittance is not limited to a Thai bank transfer.',
  'Review relevant deductions, other income and current rules before computing liability or comparing years.',
];

function remittanceReviewResult(inputEvidence, assessments = []) {
  return { content: [{ type: 'text', text: JSON.stringify({
    verdict: 'NEEDS_REVIEW',
    assessment_available: false,
    reasoning: 'These inputs do not establish remittance tax liability or foreign tax credit entitlement. A foreign tax rate and proof of payment alone do not establish an exemption. No tax or savings amount has been calculated.',
    input_evidence: inputEvidence,
    assessments,
    combined_estimate: null,
    planning: null,
    review_checklist: REMITTANCE_REVIEW_CHECKLIST,
    sources: [
      'https://www.rd.go.th/fileadmin/user_upload/porphor/GuideTaxFromAbroad_EN.pdf',
      'https://www.rd.go.th/fileadmin/download/news/question_p161_162.pdf',
      'https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dn161A.pdf',
      'https://www.rd.go.th/fileadmin/user_upload/kormor/newlaw/dn162A.pdf',
    ],
    safeguard_reviewed: '2026-10-03',
    disclaimer: 'Educational review checklist, not tax advice. Unavailable estimates are not zero and must not be used as a no-tax or exemption result.',
  }, null, 2) }] };
}

// JSON-RPC over HTTP POST (stateless MCP transport — works on any agent client)
function jsonRpcResult(id, result) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, result }), {
    headers: { 'content-type': 'application/json' },
  });
}
function jsonRpcError(id, code, message) {
  return new Response(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }), {
    status: 400,
    headers: { 'content-type': 'application/json' },
  });
}

const TOOLS = [
  {
    name: 'thai_tax_calculator',
    description: 'Calculate Thai personal income tax using official progressive brackets (2025-2026, 0-35%). Standard deduction auto-applied unless custom deductions given.',
    inputSchema: {
      type: 'object',
      properties: {
        annual_income_thb: { type: 'number', description: 'Annual assessable income in THB' },
        custom_deductions_thb: { type: 'number', description: 'Optional total deductions/allowances in THB. Default = standard 50% expense deduction (max 100k) + 60k personal allowance.' },
      },
      required: ['annual_income_thb'],
    },
    free: true,
    handler: async (args) => {
      if (!Number.isFinite(args.annual_income_thb) || args.annual_income_thb < 0) {
        throw new Error('annual_income_thb must be a finite non-negative number');
      }
      if (args.custom_deductions_thb !== undefined &&
          (!Number.isFinite(args.custom_deductions_thb) || args.custom_deductions_thb < 0)) {
        throw new Error('custom_deductions_thb must be a finite non-negative number when supplied');
      }
      const r = computeThaiTax(args.annual_income_thb, args.custom_deductions_thb);
      return { content: [{ type: 'text', text: JSON.stringify(r, null, 2) }] };
    },
  },

  {
    name: 'remittance_tax_checker',
    description: 'Prepare a remittance review checklist. Always returns NEEDS_REVIEW with unavailable tax and planning estimates: the legacy inputs cannot determine income-year residency, treaty relief or tax liability.',
    inputSchema: {
      type: 'object',
      properties: {
        is_tax_resident_180_days: { type: 'boolean', description: 'Legacy current-calendar-year 180-day answer. Does not establish residency in the year each income amount was earned.' },
        income_earned_2024_or_later: { type: 'boolean', description: 'Was the income earned in 2024 or later?' },
        will_remit_to_thailand: { type: 'boolean', description: 'Legacy remittance answer. Review the actual method and date; a Thai bank transfer is not the only form of remittance.' },
        foreign_tax_paid_above_15pct_with_proof: { type: 'boolean', description: 'Deprecated legacy evidence flag retained for input compatibility. Neither true nor false determines exemption or foreign tax credit entitlement.' },
      },
      required: ['is_tax_resident_180_days', 'income_earned_2024_or_later', 'will_remit_to_thailand', 'foreign_tax_paid_above_15pct_with_proof'],
    },
    free: true,
    handler: async (a) => remittanceReviewResult({
      is_tax_resident_180_days: a.is_tax_resident_180_days ?? null,
      income_earned_2024_or_later: a.income_earned_2024_or_later ?? null,
      will_remit_to_thailand: a.will_remit_to_thailand ?? null,
      foreign_tax_paid_above_15pct_with_proof: a.foreign_tax_paid_above_15pct_with_proof ?? null,
    }),
  },

  {
    name: 'residency_day_counter',
    description: 'Count total days present in Thailand from entry/exit date pairs and evaluate against the 180-day tax-residency threshold.',
    inputSchema: {
      type: 'object',
      properties: {
        stays: {
          type: 'array',
          description: 'Date pairs of stays in Thailand (ISO dates). Both arrival and departure days count.',
          items: {
            type: 'object',
            properties: {
              enter: { type: 'string', description: 'Entry date YYYY-MM-DD' },
              exit: { type: 'string', description: 'Exit date YYYY-MM-DD (inclusive)' },
            },
            required: ['enter', 'exit'],
          },
        },
        year: { type: 'number', description: 'Calendar year to evaluate (default current year).' },
      },
      required: ['stays'],
    },
    free: true,
    handler: async (args) => {
      const y = args.year ?? new Date().getFullYear();
      let total = 0;
      const detail = [];
      for (const s of args.stays) {
        const enter = new Date(s.enter), exit = new Date(s.exit);
        if (isNaN(enter) || isNaN(exit) || exit < enter) throw new Error(`Invalid stay pair: ${s.enter} -> ${s.exit}`);
        // clip to evaluated year
        const ys = new Date(y, 0, 1), ye = new Date(y, 11, 31);
        const effEnter = enter < ys ? ys : enter;
        const effExit = exit > ye ? ye : exit;
        if (effExit < effEnter) continue;
        const days = Math.round((effExit - effEnter) / 86400000) + 1;
        total += days;
        detail.push({ enter: s.enter, exit: s.exit, days_in_year: days });
      }
      const status = total >= 180 ? 'TAX_RESIDENT' : total >= 160 ? 'NEAR_THRESHOLD' : 'BELOW_THRESHOLD';
      return { content: [{ type: 'text', text: JSON.stringify({
        year: y, total_days: total, threshold: 180, status,
        days_remaining_buffer: Math.max(0, 180 - total),
        stays: detail,
        note: 'Any part of a day counts. Visa runs reset nothing. Status per Section 41 Revenue Code.',
      }, null, 2) }] };
    },
  },

  // ---------- PREMIUM ----------

  {
    name: 'remittance_rule_engine',
    description: 'PREMIUM-GATED. Remittance review checklist only. Always returns NEEDS_REVIEW, with combined_estimate and planning set to null; tax, exemption, credit and savings calculations are unavailable pending case-specific review.',
    inputSchema: {
      type: 'object',
      properties: {
        is_tax_resident_180_days: { type: 'boolean', description: 'Legacy current-year residency answer; does not establish residency in each income year.' },
        annual_assessable_income_thb: { type: 'number', description: 'Other Thai assessable income this year (salary etc.) excluding the remitted amount' },
        planned_remittances_thb: {
          type: 'array',
          description: 'Planned remittances this year',
          items: {
            type: 'object',
            properties: {
              amount_thb: { type: 'number' },
              earned_year: { type: 'number', description: 'Year the underlying income was earned' },
              foreign_tax_paid_pct: { type: 'number', description: 'Reported foreign-tax percentage (0-100), retained as evidence only. No percentage triggers an exemption or credit.' },
              has_proof: { type: 'boolean', description: 'Whether supporting records are available; this flag does not validate the tax or establish relief.' },
            },
            required: ['amount_thb', 'earned_year'],
          },
        },
      },
      required: ['is_tax_resident_180_days', 'planned_remittances_thb'],
    },
    free: false,
    handler: async (args) => {
      if (!Array.isArray(args.planned_remittances_thb)) {
        throw new Error('planned_remittances_thb must be an array');
      }
      const assessments = args.planned_remittances_thb.map(item => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) {
          throw new Error('Each planned remittance must be an object');
        }
        return {
          amount_thb: item.amount_thb ?? null,
          earned_year: item.earned_year ?? null,
          foreign_tax_paid_pct: item.foreign_tax_paid_pct ?? null,
          has_proof: item.has_proof ?? null,
          status: 'NEEDS_REVIEW',
          taxable: null,
        };
      });
      return remittanceReviewResult({
        is_tax_resident_180_days: args.is_tax_resident_180_days ?? null,
        annual_assessable_income_thb: args.annual_assessable_income_thb ?? null,
      }, assessments);
    },
  },

  {
    name: 'thai_expert_query',
    description: 'PREMIUM. Curated Thai-expat knowledge lookup: banking policy status by visa type, visa requirements/costs, insurance comparisons, fee schedules. Structured answers with data-as-of stamps.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: {
          type: 'string',
          enum: ['banking_by_visa', 'visa_requirements', 'insurance_comparison', 'fee_schedules', 'tax_deadlines', 'cost_of_living'],
          description: 'Knowledge domain to query',
        },
        detail: { type: 'string', description: 'Optional free-text refinement, e.g. specific visa or city.' },
      },
      required: ['topic'],
    },
    free: false,
    handler: async (args) => {
      const KB = {
        banking_by_visa: {
          accepted_visas: ['Non-B (work permit)', 'Non-O/OA retirement extension', 'LTR', 'Thailand Privilege (Elite)', 'Non-ED (with school docs)'],
          refused_2026: ['Tourist visa/exempt entries', 'DTV (widely refused; branch discretion occasionally applies)'],
          notes: 'Bangkok Bank tightened Jan 2026. Main branches in expat districts process better than suburban branches. Thai SIM in applicant name required for OTP/mobile banking.',
          asof: '2026-08',
        },
        visa_requirements: {
         DTV: { validity: '5 years, 180 days/entry', cost_thb: '10,000-15,000 one-off', funds: '~500k THB proof', work: 'Remote foreign work allowed; Thai clients need work permit' },
          LTR: { validity: '10 years (5+5)', categories: ['Wealthy Global Citizen ($1M assets + $80k income)', 'Wealthy Pensioner ($80k passive OR $40-80k + $250k Thai investment)', 'Work-from-Thailand Pro ($80k remote income, 5yr history)', 'Highly-Skilled Professional'], perks: 'Digital work permit, annual reporting, airport fast-track, flat 17% PIT for skilled tier', cost_thb: '~50,000 application' },
          retirement_extension: { validity: '1 year renewable', financial: '800k THB seasoned 2 months (first) / 3 months (renewals), floor 400k rest of year OR 65k THB/month provable income', insurance: 'Required per current regulations' },
        },
        insurance_comparison: {
          safetywing: { model: 'subscription ~$56/4wks (age ~30)', coverage: 'worldwide incl home visits', deductible: '$250', best_for: 'multi-country nomads' },
          world_nomads: { model: 'trip-based ~10% premium equivalent', coverage: 'adventure sports included', best_for: 'short trips + activities' },
          local_thai: { model: '15-40k THB/year comprehensive', coverage: 'Thailand (+options)', best_for: 'settled residents' },
          claim_warning: 'Motorbike accidents require license matching engine class — top denial cause',
        },
        fee_schedules: {
          work_permit: { application: 100, book_3mo: 750, book_3_6mo: 1500, book_annual: 3100 },
          extensions: { annual_extension_of_stay: 1900, re_entry_single: 1000 },
          visa_non_b: { single: 2000, multiple_1yr: 5000 },
          reporting: '90-day report free (fine 2000 if missed)',
        },
        tax_deadlines: {
          annual_pnd_90_91: 'March 31 paper / April 8 e-file (auto extension)',
          half_year_pnd_94: 'September 30 (income types 5-8 above thresholds)',
          penalty: '1.5%/month surcharge + fixed fines',
        },
        cost_of_living: {
          bangkok_balanced_monthly_thb: '55,000-75,000',
          chiang_mai: '35,000-50,000',
          pattaya: '45,000-60,000',
          phuket: '55,000-75,000 (island premium)',
          hua_hin: '40,000-55,000',
          koh_samui: '50,000-70,000',
          chiang_rai_isaan: '22,000-48,000 (lowest nationally)',
          note: 'Balanced lifestyle tiers; lean/comfortable vary +/- 40%',
        },
      };
      const payload = KB[args.topic] ?? { error: 'unknown topic', available: Object.keys(KB) };
      if (args.detail) payload.query_refinement = args.detail;
      return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] };
    },
  },
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Health / info endpoints
    if (request.method === 'GET' && url.pathname === '/health') {
      return Response.json({ ok: true, server: 'zipkit-mcp', version: '1.0.0', tools: TOOLS.length });
    }
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/tools')) {
      return Response.json({
        server: 'zipkit-mcp',
        description: 'Thailand tax, visa & expat-money tools for AI agents',
        data_source: 'https://zipkit.cc',
        premium_header: 'x-zipkit-key',
        tools: TOOLS.map(t => ({ name: t.name, premium: !t.free, description: t.description })),
      });
    }

    if (request.method !== 'POST') {
      return new Response('POST JSON-RPC only. GET /tools lists capabilities.', { status: 405 });
    }

    let msg;
    try { msg = await request.json(); } catch { return jsonRpcError(null, -32700, 'Parse error'); }

    const { id, method, params } = msg ?? {};

    switch (method) {
      case 'initialize':
        return jsonRpcResult(id, {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'zipkit-mcp', version: '1.0.0' },
        });

      case 'notifications/initialized':
        return new Response(null, { status: 204 });

      case 'tools/list': {
        const premiumKey = request.headers.get('x-zipkit-key');
        const unlocked = premiumKey && env.ZIPKIT_PREMIUM_KEY && premiumKey === env.ZIPKIT_PREMIUM_KEY;
        return jsonRpcResult(id, {
          tools: TOOLS.map(({ handler, ...meta }) => ({
            ...meta,
            ...(unlocked ? {} : { annotations: { ...(meta.annotations||{}), premium_locked: meta.free ? undefined : true } }),
          })),
          pricing_hint: unlocked ? 'premium unlocked' : 'Premium tools require x-zipkit-key header — get access at https://zipkit.cc/mcp',
        });
      }

      case 'tools/call': {
        const tool = TOOLS.find(t => t.name === params?.name);
        if (!tool) return jsonRpcError(id, -32602, `Unknown tool: ${params?.name}`);
        if (!tool.free) {
          const key = request.headers.get('x-zipkit-key');
          if (!env.ZIPKIT_PREMIUM_KEY || key !== env.ZIPKIT_PREMIUM_KEY) {
            return jsonRpcResult(id, {
              content: [{
                type: 'text',
                text: JSON.stringify({
                  error: 'PREMIUM_TOOL_LOCKED',
                  message: `"${tool.name}" requires a ZipKit premium key.`,
                  how_to_access: 'Visit https://zipkit.cc/mcp for pricing and key issuance.',
                }),
              }],
              isError: true,
            });
          }
        }
        try {
          return jsonRpcResult(id, await tool.handler(params.arguments ?? {}, env));
        } catch (e) {
          return jsonRpcResult(id, { content: [{ type: 'text', text: `Tool error: ${e.message}` }], isError: true });
        }
      }

      case 'ping':
        return jsonRpcResult(id, {});

      default:
        return jsonRpcError(id, -32601, `Method not found: ${method}`);
    }
  },
};
