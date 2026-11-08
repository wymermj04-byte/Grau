const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '..', 'components', 'gym', 'signature-pad-utils.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const componentSource = fs.readFileSync(
  path.join(__dirname, '..', 'components', 'gym', 'SignaturePad.tsx'),
  'utf8',
);
const developmentScreenSource = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'dev', 'signature-pad.tsx'),
  'utf8',
);
const waiverScreenSource = fs.readFileSync(
  path.join(__dirname, '..', 'app', 'members', '[studentId]', 'waiver.tsx'),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const compiledModule = { exports: {} };
new Function('exports', 'module', compiled)(compiledModule.exports, compiledModule);

const {
  appendPointToActiveStroke,
  copyRelativePadPoint,
  hasDrawnSignature,
} = compiledModule.exports;

const bounds = { width: 240, height: 176 };
const event = { nativeEvent: { locationX: 18.5, locationY: 33.25 } };
const copiedPoint = copyRelativePadPoint(event, bounds);
event.nativeEvent = null;

assert.deepEqual(copiedPoint, { x: 18.5, y: 33.25 });
assert.equal(copyRelativePadPoint(null, bounds), null);
assert.equal(copyRelativePadPoint({ nativeEvent: null }, bounds), null);
assert.equal(copyRelativePadPoint({ nativeEvent: { locationX: NaN, locationY: 2 } }, bounds), null);
assert.deepEqual(
  copyRelativePadPoint({ nativeEvent: { locationX: -10, locationY: 999 } }, bounds),
  { x: 0, y: 176 },
);

const firstStroke = appendPointToActiveStroke([[{ x: 1, y: 1 }]], { x: 2, y: 2 });
const multipleStrokes = appendPointToActiveStroke([...firstStroke, [{ x: 4, y: 4 }]], { x: 5, y: 5 });
assert.deepEqual(firstStroke, [[{ x: 1, y: 1 }, { x: 2, y: 2 }]]);
assert.deepEqual(multipleStrokes, [
  [{ x: 1, y: 1 }, { x: 2, y: 2 }],
  [{ x: 4, y: 4 }, { x: 5, y: 5 }],
]);
assert.equal(hasDrawnSignature(multipleStrokes), true);
assert.equal(hasDrawnSignature([]), false);

assert.match(componentSource, /className="min-h-11 min-w-11[\s\S]*?active:bg-accent"/);
assert.doesNotMatch(componentSource, /hasSignature\s*\?\s*['"]active:bg-accent/);
assert.match(componentSource, /style=\{\[styles\.drawingSurface, \{ backgroundColor: theme\.colors\.card \}\]\}/);
assert.match(componentSource, /style=\{\[styles\.prompt, hasSignature \? styles\.visuallyHiddenPrompt : undefined\]\}/);
assert.match(componentSource, /onStartShouldSetPanResponder:\s*\(\)\s*=>\s*true/);
assert.match(componentSource, /onPanResponderTerminationRequest:\s*\(\)\s*=>\s*false/);
assert.match(componentSource, /onPanResponderGrant:[\s\S]*?setDrawingState\(true\)/);
assert.match(componentSource, /onPanResponderRelease:\s*\(\)\s*=>\s*setDrawingState\(false\)/);
assert.match(componentSource, /onPanResponderTerminate:\s*\(\)\s*=>\s*setDrawingState\(false\)/);
assert.match(componentSource, /React\.useEffect\(\(\)\s*=>\s*\(\)\s*=>\s*\{\s*setDrawingState\(false\)/);
assert.match(developmentScreenSource, /scrollEnabled=\{!isDrawing\}/);
assert.match(developmentScreenSource, /onGestureStateChange=\{setIsDrawing\}/);
assert.match(waiverScreenSource, /scrollEnabled=\{!isDrawing\}/);
assert.match(waiverScreenSource, /onGestureStateChange=\{setIsDrawing\}/);

console.log('PASS: signature pad coordinate, multi-stroke, stable-interop, and gesture-lifecycle checks');
