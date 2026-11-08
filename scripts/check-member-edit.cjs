const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

function loadTypeScriptModule(relativePath) {
  const source = fs.readFileSync(path.join(__dirname, "..", relativePath), "utf8");
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  new Function("exports", "module", compiled)(moduleRecord.exports, moduleRecord);
  return moduleRecord.exports;
}

const { hasRequiredFirstName, normalizeMemberName } = loadTypeScriptModule("lib/member-name.ts");
const editSource = fs.readFileSync(
  path.join(__dirname, "..", "app", "members", "[studentId]", "edit.tsx"),
  "utf8",
);
const profileSource = fs.readFileSync(
  path.join(__dirname, "..", "app", "members", "[studentId].tsx"),
  "utf8",
);
const membersSource = fs.readFileSync(
  path.join(__dirname, "..", "app", "(tabs)", "members.tsx"),
  "utf8",
);
const databaseSource = fs.readFileSync(path.join(__dirname, "..", "lib", "database.ts"), "utf8");

assert.equal(normalizeMemberName("  Ana María O’Neill-Smith  "), "Ana María O’Neill-Smith");
assert.equal(hasRequiredFirstName("  \n\t "), false, "blank first names are rejected");
assert.equal(
  hasRequiredFirstName(" José-Luis O'Connor "),
  true,
  "valid punctuation and accents are retained",
);

assert.match(editSource, /first_name: normalizedFirstName/);
assert.match(editSource, /last_name: normalizedLastName/);
assert.match(editSource, /Enter a first name before saving this member\./);
assert.match(editSource, /setErrorMessage\(null\);/);
assert.doesNotMatch(
  editSource,
  /isSaving \|\| isComplete \|\| errorMessage/,
  "a save error must not block retry",
);
assert.match(editSource, /setStudent\(\(current\) =>[\s\S]*first_name: normalizedFirstName/);
assert.match(editSource, /router\.dismissTo\(memberProfilePath\(studentId\)\)/);
assert.match(profileSource, /useFocusEffect\(/, "the profile refetches when returning from edit");
assert.match(
  membersSource,
  /useFocusEffect\(/,
  "Members refreshes on focus after returning from a profile",
);
assert.match(
  databaseSource,
  /updateStudent:[\s\S]*\.eq\('studentId', studentId\)\.eq\('gym_id', gymId\)/,
  "member update remains gym-scoped",
);

console.log(
  "PASS: member name validation, retryable save, gym-scoped update, and refreshed display checks",
);
