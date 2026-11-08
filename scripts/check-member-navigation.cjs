const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

function loadTypeScriptModule(relativePath) {
  const file = path.join(__dirname, '..', relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function('exports', 'module', 'require', compiled)(moduleRecord.exports, moduleRecord, (name) => {
    if (name === 'expo-router') return {};
    return require(name);
  });
  return moduleRecord.exports;
}

const { MEMBERS_LIST_PATH, memberProfilePath } = loadTypeScriptModule('lib/member-navigation.ts');
assert.equal(MEMBERS_LIST_PATH, '/members');
assert.equal(memberProfilePath(42), '/members/42');
assert.equal(memberProfilePath('member A'), '/members/member%20A');
assert.equal(memberProfilePath(undefined), '/members');

const expectedDismisses = [
  'app/members/[studentId].tsx',
  'app/members/[studentId]/edit.tsx',
  'app/members/[studentId]/promote.tsx',
  'app/members/[studentId]/waiver.tsx',
  'app/members/[studentId]/stripe-progress-setup.tsx',
  'app/members/[studentId]/[action].tsx',
];
for (const relativePath of expectedDismisses) {
  const source = fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
  assert.match(source, /router\.dismissTo\(/, `${relativePath} must use an explicit destination`);
}

console.log('Member navigation destination checks passed.');
