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

const { isNewPaymentMethod, newPaymentMethods } = loadTypeScriptModule("lib/payment-methods.ts");
const addPaymentSource = fs.readFileSync(
  path.join(__dirname, "..", "app", "members", "[studentId]", "add-payment.tsx"),
  "utf8",
);
const historySource = fs.readFileSync(
  path.join(__dirname, "..", "app", "members", "[studentId]", "payment-history.tsx"),
  "utf8",
);
const financeSource = fs.readFileSync(
  path.join(__dirname, "..", "app", "(tabs)", "finance.tsx"),
  "utf8",
);
const reportSource = fs.readFileSync(
  path.join(__dirname, "..", "app", "financial-reports.tsx"),
  "utf8",
);
const apiSource = fs.readFileSync(path.join(__dirname, "..", "draftbit-api.ts"), "utf8");

assert.deepEqual(newPaymentMethods, ["Cash", "Check", "Cash App"]);
for (const method of newPaymentMethods) assert.equal(isNewPaymentMethod(method), true);
for (const historicalMethod of ["Card", "Venmo", "Zelle", "Other"]) {
  assert.equal(
    isNewPaymentMethod(historicalMethod),
    false,
    `${historicalMethod} is not selectable for new payments`,
  );
}
assert.match(addPaymentSource, /options=\{newPaymentMethods\}/);
assert.match(addPaymentSource, /payment_method: paymentMethod/);
assert.match(addPaymentSource, /isNewPaymentMethod\(paymentMethod\)/);
assert.doesNotMatch(addPaymentSource, /\["Cash", "Card", "Check", "Venmo", "Zelle", "Other"\]/);
assert.match(
  historySource,
  /\{record\.payment_method\}/,
  "history displays saved methods without relabeling",
);
assert.match(
  financeSource,
  /payment\.payment_method/,
  "Finance displays saved methods without relabeling",
);
assert.match(
  reportSource,
  /payment\.payment_method/,
  "reports display saved methods without relabeling",
);
assert.match(
  apiSource,
  /"payment_method": \{\s+"type": "string"/m,
  "the verified write contract has no enum",
);

console.log("PASS: new-payment method choices, validation, and historical-method display checks");
