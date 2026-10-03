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

const remit = amount_thb => ({ amount_thb, earned_year: 2026 });
const assess = (annual_assessable_income_thb, planned_remittances_thb) => call('remittance_rule_engine', {
  is_tax_resident_180_days: true,
  annual_assessable_income_thb,
  planned_remittances_thb,
});
const tax = async annual_income_thb => (await call('thai_tax_calculator', { annual_income_thb })).estimated_tax_thb;

// Expected amounts below are the program's current model, not tax-law claims.
test('API documents other income as excluding the planned remittances', async () => {
  const schema = (await rpc('tools/list')).tools.find(t => t.name === 'remittance_rule_engine').inputSchema;
  assert.match(schema.properties.annual_assessable_income_thb.description, /excluding the remitted amount/);
  assert.equal(schema.properties.planned_remittances_thb.description, 'Planned remittances this year');
});

test('no remittances preserves the other-income estimate and null planning', async () => {
  const result = await assess(1_000_000, []);
  assert.equal(result.combined_estimate.estimated_tax_thb, await tax(1_000_000));
  assert.deepEqual(result.assessments, []);
  assert.equal(result.planning, null);
});

test('one assessable remittance preserves the existing null-planning behavior', async () => {
  const result = await assess(300_000, [remit(500_000)]);
  assert.equal(result.combined_estimate.estimated_tax_thb, await tax(800_000));
  assert.equal(result.planning, null);
});

test('two 500k remittances: single-year planning agrees with the 83k combined estimate', async () => {
  const result = await assess(0, [remit(500_000), remit(500_000)]);
  assert.equal(result.combined_estimate.estimated_tax_thb, 83_000);
  assert.equal(result.planning.tax_if_single_year, 83_000);
});

test('two 500k remittances: equal split counts each half once, yielding 23k', async () => {
  const result = await assess(0, [remit(500_000), remit(500_000)]);
  assert.equal(result.planning.tax_if_split_two_years_approx, 23_000);
  assert.equal(result.planning.potential_saving_thb, 60_000);
});

test('positive other income is retained once in the first-year split', async () => {
  const result = await assess(500_000, [remit(500_000), remit(500_000)]);
  assert.equal(result.combined_estimate.estimated_tax_thb, 200_000);
  assert.equal(result.planning.tax_if_single_year, 200_000);
  assert.equal(result.planning.tax_if_split_two_years_approx, 94_500);
  assert.equal(result.planning.potential_saving_thb, 105_500);
});

test('model-excluded entries do not enter either planning scenario', async () => {
  const result = await assess(500_000, [
    remit(500_000),
    { amount_thb: 700_000, earned_year: 2023 },
    { amount_thb: 900_000, earned_year: 2026, foreign_tax_paid_pct: 15, has_proof: true },
    remit(500_000),
  ]);
  assert.deepEqual(result.assessments.map(x => x.status), [
    'ASSESSABLE', 'EXEMPT_PRE_2024', 'CREDITABLE_REMITTANCE', 'ASSESSABLE',
  ]);
  assert.equal(result.combined_estimate.estimated_tax_thb, 200_000);
  assert.equal(result.planning.tax_if_single_year, 200_000);
  assert.equal(result.planning.tax_if_split_two_years_approx, 94_500);
});

test('multiple model-excluded remittances preserve null planning', async () => {
  const result = await assess(1_000_000, [
    { amount_thb: 500_000, earned_year: 2023 },
    { amount_thb: 500_000, earned_year: 2026, foreign_tax_paid_pct: 15, has_proof: true },
  ]);
  assert.equal(result.combined_estimate.estimated_tax_thb, 83_000);
  assert.equal(result.planning, null);
});

test('omitted other income defaults to zero', async () => {
  const result = await assess(undefined, [remit(500_000), remit(500_000)]);
  assert.equal(result.planning.tax_if_single_year, 83_000);
  assert.equal(result.planning.tax_if_split_two_years_approx, 23_000);
});

test('zero-value remittances do not alter other income', async () => {
  const result = await assess(1_000_000, [remit(0), remit(0)]);
  assert.equal(result.planning.tax_if_single_year, 83_000);
  assert.equal(result.planning.tax_if_split_two_years_approx, 83_000);
  assert.equal(result.planning.potential_saving_thb, 0);
});

test('scenario invariants hold across 84 synthetic income and partition cases', async () => {
  let cases = 0;
  for (const otherIncome of [0, 160_000, 500_000, 2_000_000]) {
    for (const total of [0, 1, 150_000, 340_000, 1_000_000, 5_000_000, 1_000_001.5]) {
      for (const fractions of [[0.5, 0.5], [0.25, 0.75], [0.25, 0.25, 0.5]]) {
        const result = await assess(otherIncome, fractions.map(f => remit(total * f)));
        const oneYear = await tax(otherIncome + total);
        const twoYears = await tax(otherIncome + total / 2) + await tax(total / 2);
        assert.equal(result.combined_estimate.estimated_tax_thb, oneYear);
        assert.equal(result.planning.tax_if_single_year, oneYear);
        assert.equal(result.planning.tax_if_split_two_years_approx, twoYears);
        assert.equal(result.planning.potential_saving_thb, Math.max(0, oneYear - twoYears));
        cases++;
      }
    }
  }
  assert.equal(cases, 84);
});

test('non-resident branch stays unchanged', async () => {
  const result = await call('remittance_rule_engine', {
    is_tax_resident_180_days: false,
    planned_remittances_thb: [remit(500_000), remit(500_000)],
  });
  assert.equal(result.verdict, 'NO_THAI_TAX_OBLIGATION');
  assert.equal(result.planning, undefined);
});

test('premium gate stays locked without the synthetic test key', async () => {
  const result = await rpc('tools/call', {
    name: 'remittance_rule_engine',
    arguments: { is_tax_resident_180_days: true, planned_remittances_thb: [] },
  }, false);
  assert.equal(result.isError, true);
  assert.equal(JSON.parse(result.content[0].text).error, 'PREMIUM_TOOL_LOCKED');
});
