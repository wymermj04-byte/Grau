const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'belt-colors.ts'), 'utf8');
const componentSource = fs.readFileSync(path.join(__dirname, '..', 'components', 'gym', 'BeltRankCard.tsx'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiledModule = { exports: {} };
new Function('exports', 'module', compiled)(compiledModule.exports, compiledModule);

const { getBeltColorProfile } = compiledModule.exports;
const fallback = { primaryColor: '#4B5250', borderColor: '#8A918D', textColor: '#F3F0E8' };

assert.equal(getBeltColorProfile('White', fallback).textColor, '#1A1D1C', 'white belt uses dark text');
assert.equal(getBeltColorProfile('Black', fallback).textColor, '#F7F5EF', 'black belt uses light text');
assert.equal(getBeltColorProfile('Grey/White', fallback).secondaryColor, '#F5F1E8', 'two-color youth rank has its white band');
assert.equal(getBeltColorProfile('yellow / black', fallback).secondaryColor, '#202326', 'two-color aliases normalize safely');
assert.deepEqual(getBeltColorProfile('Unrecorded experimental rank', fallback), fallback, 'unknown rank uses the theme-supplied neutral fallback');
assert.match(componentSource, /StyleSheet\.create/);
assert.match(componentSource, /backgroundColor: belt\.primaryColor/);
assert.doesNotMatch(componentSource, /className=\{`/);

console.log('PASS: adult and youth belt mapping, two-color ranks, readable text colors, neutral fallback, and explicit native rank-card styles');
