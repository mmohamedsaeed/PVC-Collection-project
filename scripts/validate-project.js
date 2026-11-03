const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const backend = fs.readFileSync(path.join(root, 'Code.gs'), 'utf8');
const failures = [];

function check(condition, message) {
  if (!condition) failures.push(message);
}

function compile(label, source) {
  try {
    new vm.Script(source, { filename: label });
    console.log(`PASS syntax: ${label}`);
  } catch (error) {
    failures.push(`Syntax error in ${label}: ${error.message}`);
  }
}

compile('Code.gs', backend);
const backendFunctions = new Set(
  Array.from(backend.matchAll(/\bfunction\s+([A-Za-z_$][\w$]*)\s*\(/g), match => match[1])
);

for (const filename of ['Index.html', 'Admin.html']) {
  const html = fs.readFileSync(path.join(root, filename), 'utf8');
  const scripts = Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi), match => match[1]);
  check(scripts.length > 0, `${filename} must contain an inline application script`);

  scripts.forEach((script, index) => {
    const normalized = script.replace(/<\?!=\s*JSON\.stringify\(WEB_APP_URL\)\s*\?>/g, '"https://example.invalid/exec"');
    compile(`${filename} inline script ${index + 1}`, normalized);

    const apiCalls = Array.from(normalized.matchAll(/\b(?:api|call)\(\s*['"]([A-Za-z_$][\w$]*)['"]/g), match => match[1]);
    apiCalls.forEach(name => check(backendFunctions.has(name), `${filename} calls missing backend function ${name}()`));
  });

  check(!/<\?xml\b/i.test(html), `${filename} contains an XML declaration that may be parsed as an Apps Script template scriptlet`);
}

const adminHtml = fs.readFileSync(path.join(root, 'Admin.html'), 'utf8');
const dynamicAdminActions = Array.from(adminHtml.matchAll(/actionButton\([^,]+,\s*['"](admin[A-Za-z0-9_$]+)['"]/g), match => match[1]);
dynamicAdminActions.forEach(name => check(backendFunctions.has(name), `Admin.html references missing backend action ${name}()`));

const indexHtml = fs.readFileSync(path.join(root, 'Index.html'), 'utf8');
check(/USER\s*:\s*'USER'/.test(backend), 'Backend must keep USER as the normal employee role');
check(/r\.user\.role\s*!==\s*'USER'/.test(indexHtml), 'Employee frontend must accept the backend USER role');
check(!/role\s*!==\s*'EMPLOYEE'/.test(indexHtml), 'Employee frontend must not require an undefined EMPLOYEE role');

if (failures.length) {
  console.error('\nValidation failed:');
  failures.forEach(message => console.error(`- ${message}`));
  process.exitCode = 1;
} else {
  console.log('\nPASS: syntax, template hazard, employee role contract, and explicit frontend/backend calls.');
}
