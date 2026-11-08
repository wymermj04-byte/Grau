const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const studentsSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'students.ts'), 'utf8');
const membersSource = fs.readFileSync(path.join(__dirname, '..', 'app', '(tabs)', 'members.tsx'), 'utf8');
const compiled = ts.transpileModule(studentsSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiledModule = { exports: {} };
new Function('exports', 'module', 'require', compiled)(compiledModule.exports, compiledModule, () => ({}));

const { filterStudents } = compiledModule.exports;
const students = [
  { studentId: 1, first_name: 'Ava', last_name: 'Jones', membership_status: 'Active', programs: ['kids'] },
  { studentId: 2, first_name: 'Ben', last_name: 'Stone', membership_status: 'Active', programs: ['adults'] },
  { studentId: 3, first_name: 'Cara', last_name: 'Mills', membership_status: 'Lead', programs: ['kids', 'adults'] },
];

assert.deepEqual(filterStudents(students, 'a', 'All', 'All').map((student) => student.studentId), [1, 3], 'first character filters without changing data');
assert.deepEqual(filterStudents(students, 'av', 'All', 'All').map((student) => student.studentId), [1], 'continued typing narrows results');
assert.deepEqual(filterStudents(students, 'zz', 'All', 'All'), [], 'no-match searches are empty');
assert.deepEqual(filterStudents(students, '', 'All', 'All').map((student) => student.studentId), [1, 2, 3], 'clearing restores the full list');
assert.deepEqual(filterStudents(students, '', 'All', 'Kids').map((student) => student.studentId), [1, 3], 'Kids filter is retained');
assert.deepEqual(filterStudents(students, '', 'Active', 'Adults').map((student) => student.studentId), [2], 'status and program filters combine');
assert.match(membersSource, /accessibilityLabel="Clear member search"/);
assert.match(membersSource, /disabled=\{!hasQuery\}/);
assert.match(membersSource, /router\.push\(`\/members\/\$\{student\.studentId\}`\)/);
assert.doesNotMatch(membersSource, /active:/, 'search and result surfaces must not dynamically upgrade through NativeWind pseudo-styles');
assert.match(membersSource, /index=\{student\.studentId\}/, 'avatar color selection must remain stable while filtered rows reorder');

console.log('PASS: member search first-character, continued typing, no-match, clear, filters, and stable native styling checks');
