const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'date.ts'), 'utf8');
const setupSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'members', '[studentId]', 'stripe-progress-setup.tsx'), 'utf8');
const classFormSource = fs.readFileSync(path.join(__dirname, '..', 'app', 'classes', 'add.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiledModule = { exports: {} };
new Function('exports', 'module', compiled)(compiledModule.exports, compiledModule);

const { formatCalendarDate, formatTimestampDate, parseCalendarDateInput } = compiledModule.exports;

assert.equal(formatCalendarDate('2026-03-08'), '03-08-26');
assert.equal(formatCalendarDate('2024-02-29'), '02-29-24');
assert.equal(formatCalendarDate('2025-02-29'), 'Date unavailable');
assert.equal(parseCalendarDateInput('03-08-26'), '2026-03-08');
assert.equal(parseCalendarDateInput('02-29-24'), '2024-02-29');
assert.equal(parseCalendarDateInput('02-29-25'), null);
assert.equal(parseCalendarDateInput('13-01-26'), null);
assert.equal(parseCalendarDateInput('3-08-26'), null);
assert.equal(
  formatTimestampDate('2026-03-09T03:30:00.000Z', 'America/New_York'),
  '03-08-26',
  'timestamps must be formatted in the requested timezone without changing their stored instant',
);
assert.match(setupSource, /placeholder="MM-DD-YY"/);
assert.match(classFormSource, /placeholder="MM-DD-YY"/);
assert.match(setupSource, /parseCalendarDateInput/);
assert.match(classFormSource, /parseCalendarDateInput/);

console.log('PASS: MM-DD-YY calendar formatting, real-date validation, and timezone-safe timestamp formatting checks');
