const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'class-roster.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiledModule = { exports: {} };
new Function('exports', 'module', compiled)(compiledModule.exports, compiledModule);

const { filterInProgressClassRoster, filterCompletedClassRoster } = compiledModule.exports;
const students = [
  { studentId: 1, first_name: 'Kids', last_name: 'Only', programs: ['Kids'] },
  { studentId: 2, first_name: 'Adults', last_name: 'Only', programs: ['Adults'] },
  { studentId: 3, first_name: 'Dual', last_name: 'Program', programs: ['Kids', 'Adults'] },
  { studentId: 4, first_name: 'Formatted', last_name: 'Values', programs: [' kids ', 'ADULTS'] },
];
const ids = (roster) => roster.map((student) => student.studentId);

assert.deepEqual(ids(filterInProgressClassRoster(students, 'kids', new Set())), [1, 3, 4]);
assert.deepEqual(ids(filterInProgressClassRoster(students, 'adults', new Set())), [2, 3, 4]);
assert.deepEqual(ids(filterInProgressClassRoster(students, 'mixed', new Set())), [1, 2, 3, 4]);
assert.deepEqual(ids(filterInProgressClassRoster(students, null, new Set())), [1, 2, 3, 4]);
assert.deepEqual(ids(filterInProgressClassRoster(students, 'kids', new Set([2]))), [1, 2, 3, 4]);
assert.deepEqual(ids(filterCompletedClassRoster(students, new Set([2, 4]))), [2, 4]);
assert.equal(new Set(ids(filterInProgressClassRoster(students, 'mixed', new Set([3])))).size, 4);

console.log('PASS: kids, adults, mixed, legacy, normalized programs, saved check-ins, completed read-only roster, and no duplicate students');
