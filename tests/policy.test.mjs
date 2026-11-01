import assert from 'node:assert/strict';
import test from 'node:test';

import { POLICY_2026 } from '../src/definition/policy/policy-2026.js';
import { policyForAt } from '../src/definition/policy/index.js';
import { getCurrentPeriod, getNextTransition, getRemainingSeconds } from '../src/definition/peak.js';

/** Beijing wall-clock instant. */
const bj = (y, m, d, hh = 0, mm = 0) => Date.UTC(y, m - 1, d, hh, mm) - 8 * 3600 * 1000;

test('weekday peak windows match 09-12 and 14-18 Beijing time', () => {
  // 2026-11-02 is a Monday.
  assert.equal(getCurrentPeriod(POLICY_2026, bj(2026, 11, 2, 8, 59)).kind, 'idle');
  assert.equal(getCurrentPeriod(POLICY_2026, bj(2026, 11, 2, 9, 0)).kind, 'peak');
  assert.equal(getCurrentPeriod(POLICY_2026, bj(2026, 11, 2, 11, 59)).kind, 'peak');
  assert.equal(getCurrentPeriod(POLICY_2026, bj(2026, 11, 2, 12, 0)).kind, 'idle');
  assert.equal(getCurrentPeriod(POLICY_2026, bj(2026, 11, 2, 13, 59)).kind, 'idle');
  assert.equal(getCurrentPeriod(POLICY_2026, bj(2026, 11, 2, 14, 0)).kind, 'peak');
  assert.equal(getCurrentPeriod(POLICY_2026, bj(2026, 11, 2, 17, 59)).kind, 'peak');
  assert.equal(getCurrentPeriod(POLICY_2026, bj(2026, 11, 2, 18, 0)).kind, 'idle');
  assert.equal(getCurrentPeriod(POLICY_2026, bj(2026, 11, 2, 23, 59)).kind, 'idle');
});

test('weekends are idle even at peak hours', () => {
  // 2026-11-01 Sunday, 2026-11-07 Saturday.
  assert.equal(getCurrentPeriod(POLICY_2026, bj(2026, 11, 1, 10, 0)).kind, 'idle');
  assert.equal(getCurrentPeriod(POLICY_2026, bj(2026, 11, 7, 15, 0)).kind, 'idle');
});

test('statutory holidays are idle for their whole range', () => {
  // 国庆节 2026-10-01 (Thu) .. 10-07 (Wed); 中秋节 09-25 (Fri); 元旦 01-01 (Thu).
  assert.equal(getCurrentPeriod(POLICY_2026, bj(2026, 10, 1, 10, 0)).kind, 'idle');
  assert.equal(getCurrentPeriod(POLICY_2026, bj(2026, 10, 7, 15, 0)).kind, 'idle');
  assert.equal(getCurrentPeriod(POLICY_2026, bj(2026, 9, 25, 10, 0)).kind, 'idle');
  assert.equal(getCurrentPeriod(POLICY_2026, bj(2026, 1, 1, 10, 0)).kind, 'idle');
  // Day after 国庆 (10-08, Thu) is a normal weekday again.
  assert.equal(getCurrentPeriod(POLICY_2026, bj(2026, 10, 8, 10, 0)).kind, 'peak');
});

test('make-up workdays on a weekend stay idle', () => {
  // 2026-10-10 is a Saturday listed as a make-up workday.
  assert.ok(POLICY_2026.makeUpWorkdays.includes('2026-10-10'));
  assert.equal(getCurrentPeriod(POLICY_2026, bj(2026, 10, 10, 10, 0)).kind, 'idle');
});

test('next transition and remaining seconds land on the window boundary', () => {
  const at = bj(2026, 11, 2, 11, 50);
  const next = getNextTransition(POLICY_2026, at);
  assert.equal(next.to, 'idle');
  assert.equal(next.atMs, bj(2026, 11, 2, 12, 0));
  assert.equal(getRemainingSeconds(POLICY_2026, at), 600);
});

test('Friday evening rolls forward to Monday morning, not Saturday', () => {
  const at = bj(2026, 11, 6, 18, 0); // Friday after the last window
  const next = getNextTransition(POLICY_2026, at);
  assert.equal(next.to, 'peak');
  assert.equal(next.atMs, bj(2026, 11, 9, 9, 0)); // Monday 09:00
  assert.equal(getRemainingSeconds(POLICY_2026, at), 63 * 3600);
});

test('remaining seconds never goes negative and is stable at the boundary', () => {
  const at = bj(2026, 11, 2, 9, 0); // exactly at the peak start
  assert.ok(getRemainingSeconds(POLICY_2026, at) >= 0);
  const after = getNextTransition(POLICY_2026, at);
  assert.equal(after.atMs, bj(2026, 11, 2, 12, 0));
});

test('a year without a policy is marked estimated', () => {
  const lookup = policyForAt(bj(2027, 3, 1, 10, 0));
  assert.equal(lookup.estimated, true);
  assert.equal(lookup.policy.year, 2027);
  // Still weekday-aware, just without holidays.
  assert.equal(getCurrentPeriod(lookup.policy, bj(2027, 3, 1, 10, 0)).kind, 'peak'); // 2027-03-01 is a Monday
  assert.equal(getCurrentPeriod(lookup.policy, bj(2027, 3, 6, 10, 0)).kind, 'idle'); // Saturday
});
