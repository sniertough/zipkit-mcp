import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../src/index.js';

// Local-only tests: synthetic inputs and a dummy key, with no HTTP listener,
// real credentials, external calls, Cloudflare services, or package installs.
globalThis.fetch = async () => { throw new Error('Network access is forbidden in these tests'); };
const env = { ZIPKIT_PREMIUM_KEY: 'local-test-only-not-a-production-key' };
let nextId = 1;

async function rpc(method, params, authenticated = true) {
  const response = await worker.fetch(new Request('https://zipkit.test.invalid/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authenticated ? { 'x-zipkit-key': env.ZIPKIT_PREMIUM_KEY } : {}),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
  }), env);
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.error, undefined);
  return result.result;
}

async function call(name, args) {
  const result = await rpc('tools/call', { name, arguments: args });
  assert.notEqual(result.isError, true);
  return JSON.parse(result.content[0].text);
}

const remit = (amount_thb, extras = {}) => ({ amount_thb, earned_year: 2026, ...extras });
const assess = (annual_assessable_income_thb, planned_remittances_thb, is_tax_resident_180_days = true) => call('remittance_rule_engine', {
  is_tax_resident_180_days, annual_assessable_income_thb, planned_remittances_thb,
});
const tax = async annual_income_thb => (await call('thai_tax_calculator', { annual_income_thb })).estimated_tax_thb;

function assertReview(result) {
  assert.equal(result.verdict, 'NEEDS_REVIEW');
  assert.equal(result.assessment_available, false);
  assert.equal(result.combined_estimate, null);
  assert.equal(result.planning, null);
  for (const item of result.assessments) {
    assert.equal(item.status, 'NEEDS_REVIEW');
    assert.equal(item.taxable, null);
  }
  const derivedNumberKeys = /^(?:estimated_tax_thb|net_taxable_thb|effective_rate_pct|deductions_applied_thb|tax_if_single_year|tax_if_split_two_years_approx|potential_saving_thb|foreign_tax_credit_thb)$/;
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(derivedNumberKeys.test(key), false, `No computed tax/savings field: ${key}`);
      walk(child);
    }
  }
  walk(result);
  assert.match(result.review_checklist.join(' '), /residency in that income year/);
  assert.match(result.review_checklist.join(' '), /source country, income category/);
  assert.match(result.review_checklist.join(' '), /actual foreign income tax paid/);
  assert.match(result.review_checklist.join(' '), /credit limit/);
  assert.match(result.disclaimer, /Unavailable estimates are not zero/);
}

test('free checker requires review for all 16 legacy input combinations', async () => {
  let cases = 0;
  for (const resident of [true, false]) for (const recent of [true, false])
    for (const remitting of [true, false]) for (const proof of [true, false]) {
      const args = {
        is_tax_resident_180_days: resident, income_earned_2024_or_later: recent,
        will_remit_to_thailand: remitting, foreign_tax_paid_above_15pct_with_proof: proof,
      };
      const result = await call('remittance_tax_checker', args);
      assertReview(result);
      assert.deepEqual(result.input_evidence, args);
      cases++;
    }
  assert.equal(cases, 16);
});

test('missing legacy booleans are unknown, never silently treated as no tax', async () => {
  const result = await call('remittance_tax_checker', {});
  assertReview(result);
  assert.ok(Object.values(result.input_evidence).every(value => value === null));
});

test('14.9/15/15.1 percent with true, false or missing proof never excludes income or calculates savings', async () => {
  let cases = 0;
  for (const rate of [14.9, 15, 15.1]) for (const proof of [true, false, undefined])
    for (const resident of [true, false]) {
      const input = remit(500_000, { foreign_tax_paid_pct: rate, has_proof: proof });
      const result = await assess(300_000, [input, remit(500_000)], resident);
      assertReview(result);
      assert.equal(result.input_evidence.is_tax_resident_180_days, resident);
      assert.equal(result.input_evidence.annual_assessable_income_thb, 300_000);
      assert.equal(result.assessments[0].foreign_tax_paid_pct, rate);
      assert.equal(result.assessments[0].has_proof, proof ?? null);
      assert.equal(result.assessments[0].amount_thb, 500_000);
      assert.equal(result.assessments[0].earned_year, 2026);
      cases++;
    }
  assert.equal(cases, 18);
});

test('pre-2024, mixed-year, zero and empty remittances do not produce blanket exemptions or numeric plans', async () => {
  for (const entries of [[], [remit(0)], [remit(500_000, { earned_year: 2023 })], [
    remit(700_000, { earned_year: 2023 }), remit(500_000),
    remit(900_000, { foreign_tax_paid_pct: 15, has_proof: true }),
  ]]) {
    const result = await assess(1_000_000, entries);
    assertReview(result);
    assert.equal(result.assessments.length, entries.length);
    entries.forEach((entry, i) => {
      assert.equal(result.assessments[i].amount_thb, entry.amount_thb);
      assert.equal(result.assessments[i].earned_year, entry.earned_year);
    });
  }
});

test('omitted inputs remain unknown instead of defaulting to zero or non-resident', async () => {
  const result = await call('remittance_rule_engine', { planned_remittances_thb: [{}] });
  assertReview(result);
  assert.deepEqual(result.input_evidence, { is_tax_resident_180_days: null, annual_assessable_income_thb: null });
  assert.equal(result.assessments[0].amount_thb, null);
  assert.equal(result.assessments[0].earned_year, null);
  assert.equal(result.assessments[0].foreign_tax_paid_pct, null);
  assert.equal(result.assessments[0].has_proof, null);
});

test('malformed remittance lists return tool errors without tax results', async () => {
  for (const list of [null, {}, [null], [[]]]) {
    const result = await rpc('tools/call', { name: 'remittance_rule_engine', arguments: { planned_remittances_thb: list } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /must be/);
    assert.doesNotMatch(result.content[0].text, /NOT_TAXABLE|NO_THAI_TAX|estimated_tax/);
  }
});

test('tool schemas retain input names but state that outputs require review', async () => {
  const tools = (await rpc('tools/list')).tools;
  const free = tools.find(t => t.name === 'remittance_tax_checker');
  const premium = tools.find(t => t.name === 'remittance_rule_engine');
  assert.deepEqual(free.inputSchema.required, ['is_tax_resident_180_days', 'income_earned_2024_or_later', 'will_remit_to_thailand', 'foreign_tax_paid_above_15pct_with_proof']);
  assert.deepEqual(premium.inputSchema.required, ['is_tax_resident_180_days', 'planned_remittances_thb']);
  for (const tool of [free, premium]) assert.match(tool.description, /NEEDS_REVIEW/);
  assert.match(free.inputSchema.properties.foreign_tax_paid_above_15pct_with_proof.description, /Deprecated/);
  assert.match(premium.inputSchema.properties.annual_assessable_income_thb.description, /excluding the remitted amount/);
});

// Arithmetic checks below describe the existing calculator model only. They do
// not validate assessability, deductions, credits or a person's tax liability.
function referenceArithmetic(gross) {
  const net = Math.max(0, gross - Math.min(gross * 0.5, 100000) - 60000);
  const bands = [[0,150000,0],[150000,300000,.05],[300000,500000,.10],[500000,750000,.15],
    [750000,1000000,.20],[1000000,2000000,.25],[2000000,5000000,.30],[5000000,Infinity,.35]];
  return Math.round(bands.reduce((sum, [low, high, rate]) => sum + Math.max(0, Math.min(net, high) - low) * rate, 0));
}

test('standalone arithmetic preserves known values', async () => {
  for (const [income, expected] of [[0, 0], [160_000, 0], [500_000, 11_500], [1_000_000, 83_000], [1_500_000, 200_000]]) {
    assert.equal(await tax(income), expected);
  }
});

test('standalone arithmetic remains available across 84 synthetic cases', async () => {
  let cases = 0;
  for (const other of [0, 160_000, 500_000, 2_000_000])
    for (const total of [0, 1, 150_000, 340_000, 1_000_000, 5_000_000, 1_000_001.5])
      for (const fraction of [0.25, 0.5, 1]) {
        const gross = other + total * fraction;
        assert.equal(await tax(gross), referenceArithmetic(gross));
        cases++;
      }
  assert.equal(cases, 84);
});

test('standalone calculator preserves explicit deduction and bracket boundaries', async () => {
  for (const [income, expected] of [[150_000, 0], [300_000, 7_500], [500_000, 27_500], [750_000, 65_000], [1_000_000, 115_000]]) {
    const result = await call('thai_tax_calculator', { annual_income_thb: income, custom_deductions_thb: 0 });
    assert.equal(result.estimated_tax_thb, expected);
    assert.equal(result.deductions_applied_thb, 0);
  }
});

test('premium gate stays locked without the synthetic test key', async () => {
  const result = await rpc('tools/call', {
    name: 'remittance_rule_engine', arguments: { is_tax_resident_180_days: true, planned_remittances_thb: [] },
  }, false);
  assert.equal(result.isError, true);
  assert.equal(JSON.parse(result.content[0].text).error, 'PREMIUM_TOOL_LOCKED');
});


test('null or non-numeric calculator inputs cannot be coerced into a zero estimate', async () => {
  for (const value of [null, false, true, '', '1000000', -1, {}, []]) {
    for (const args of [
      { annual_income_thb: value },
      { annual_income_thb: 1_000_000, custom_deductions_thb: value },
    ]) {
      const result = await rpc('tools/call', { name: 'thai_tax_calculator', arguments: args });
      assert.equal(result.isError, true);
      assert.match(result.content[0].text, /finite non-negative number/);
      assert.doesNotMatch(result.content[0].text, /estimated_tax_thb/);
    }
  }
});
