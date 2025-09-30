const countriesArr = require('./stripe-countries.json');
const usStatesArr  = require('./stripe-us-states.json');

const toMap = (arr) =>
  arr.reduce((m, it) => {
    const code = String(it?.code || '').trim().toUpperCase();
    const name = String(it?.name || '').trim();
    if (code && name) m[code] = name;
    return m;
  }, Object.create(null));

const COUNTRIES = toMap(countriesArr);
const US_STATES = toMap(usStatesArr);

// normalize helpers
const up = (v) => String(v ?? '').trim().toUpperCase();

// Return country name; falls back to code if unknown
function countryName(code, { fallbackToCode = true } = {}) {
  const cc = up(code);
  const key = cc === 'UK' ? 'GB' : cc; // common alias
  return COUNTRIES[key] ?? (fallbackToCode ? key : '');
}

// Return US state name; falls back to code if unknown
function usStateName(code, { fallbackToCode = true } = {}) {
  const sc = up(code);
  return US_STATES[sc] ?? (fallbackToCode ? sc : '');
}

// Convenience: resolve both for bill_to
function resolveBillTo(countryCode, stateCode) {
  const country = countryName(countryCode);
  const isUS = up(countryCode) === 'US';
  const state  = isUS ? usStateName(stateCode) : (stateCode || '');
  return { country, state };
}

module.exports = {
  countryName,
  usStateName,
  resolveBillTo,
  COUNTRIES,
  US_STATES,
};