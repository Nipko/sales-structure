#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const [inputFile, outputFile] = process.argv.slice(2);
if (!inputFile || !outputFile) {
  console.error('Usage: jest-json-to-junit.cjs <jest-results.json> <junit.xml>');
  process.exit(2);
}

const stripAnsiAndInvalidXml = (value) => {
  const withoutAnsi = String(value ?? '').replace(/\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '');
  let safe = '';
  for (const character of withoutAnsi) {
    const codePoint = character.codePointAt(0);
    if (codePoint === 0x9 || codePoint === 0xA || codePoint === 0xD
        || (codePoint >= 0x20 && codePoint <= 0xD7FF)
        || (codePoint >= 0xE000 && codePoint <= 0xFFFD)
        || (codePoint >= 0x10000 && codePoint <= 0x10FFFF)) {
      safe += character;
    }
  }
  return safe;
};

const escapeXml = (value) => stripAnsiAndInvalidXml(value)
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const seconds = (milliseconds) => Number.isFinite(milliseconds)
  ? Math.max(0, milliseconds) / 1000
  : 0;

const writeInfrastructureFailure = (message, exitCode = 1) => {
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<testsuites name="Jest" tests="1" failures="1" skipped="0" time="0.000">',
    '  <testsuite name="Jest evidence infrastructure" tests="1" failures="1" skipped="0" time="0.000">',
    `    <testcase classname="jest.evidence" name="Jest result artifact"><failure message="Jest evidence unavailable">${escapeXml(message)}</failure></testcase>`,
    '  </testsuite>',
    '</testsuites>',
    '',
  ].join('\n');
  fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
  fs.writeFileSync(outputFile, xml, 'utf8');
  console.error(message);
  process.exit(exitCode);
};

if (!fs.existsSync(inputFile)) {
  writeInfrastructureFailure(`Jest JSON evidence does not exist: ${inputFile}`);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
} catch (error) {
  writeInfrastructureFailure(`Jest JSON evidence is invalid: ${error instanceof Error ? error.message : String(error)}`);
}

const suites = Array.isArray(report.testResults) ? report.testResults : [];
const normalizedSuites = suites.map((suite) => {
  const assertions = Array.isArray(suite.assertionResults) ? [...suite.assertionResults] : [];
  const hasFailedAssertion = assertions.some((test) => test.status === 'failed');
  const suiteFailure = suite.testExecError?.message
    || suite.failureMessage
    || (suite.status === 'failed' && !hasFailedAssertion ? 'Jest reported a failed suite without assertion results.' : '');
  if (suiteFailure && !hasFailedAssertion) {
    assertions.push({
      ancestorTitles: ['Jest infrastructure'],
      title: 'Suite execution',
      status: 'failed',
      duration: 0,
      failureMessages: [suiteFailure],
    });
  }
  return { ...suite, assertionResults: assertions };
});

const representedFailures = normalizedSuites.reduce(
  (sum, suite) => sum + suite.assertionResults.filter((test) => test.status === 'failed').length,
  0,
);
const reportSignalsFailure = report.success === false
  || report.wasInterrupted === true
  || Number(report.numFailedTestSuites || 0) > 0;
if (reportSignalsFailure && representedFailures === 0) {
  normalizedSuites.push({
    name: 'Jest global execution',
    startTime: 0,
    endTime: 0,
    assertionResults: [{
      ancestorTitles: ['Jest infrastructure'],
      title: 'Global execution',
      status: 'failed',
      duration: 0,
      failureMessages: [report.wasInterrupted
        ? 'Jest execution was interrupted.'
        : `Jest reported ${Number(report.numFailedTestSuites || 0)} failed suite(s) without assertion failure details.`],
    }],
  });
}

const totalTests = normalizedSuites.reduce((sum, suite) => sum + suite.assertionResults.length, 0);
const totalFailures = normalizedSuites.reduce(
  (sum, suite) => sum + suite.assertionResults.filter((test) => test.status === 'failed').length,
  0,
);
const totalSkipped = normalizedSuites.reduce(
  (sum, suite) => sum + suite.assertionResults.filter((test) => ['pending', 'skipped', 'todo'].includes(test.status)).length,
  0,
);
const totalTime = normalizedSuites.reduce((sum, suite) => sum + seconds((suite.endTime || 0) - (suite.startTime || 0)), 0);

const suiteXml = normalizedSuites.map((suite) => {
  const tests = suite.assertionResults;
  const failures = tests.filter((test) => test.status === 'failed').length;
  const skipped = tests.filter((test) => ['pending', 'skipped', 'todo'].includes(test.status)).length;
  const testcases = tests.map((test) => {
    const name = [...(test.ancestorTitles || []), test.title].filter(Boolean).join(' › ');
    const className = test.ancestorTitles?.join('.') || path.basename(suite.name || 'jest');
    const attrs = `classname="${escapeXml(className)}" name="${escapeXml(name)}" time="${seconds(test.duration).toFixed(3)}"`;
    if (test.status === 'failed') {
      const detail = (test.failureMessages || []).join('\n');
      return `    <testcase ${attrs}><failure message="Jest assertion failed">${escapeXml(detail)}</failure></testcase>`;
    }
    if (['pending', 'skipped', 'todo'].includes(test.status)) {
      return `    <testcase ${attrs}><skipped message="${escapeXml(test.status)}" /></testcase>`;
    }
    return `    <testcase ${attrs} />`;
  }).join('\n');
  const suiteTime = seconds((suite.endTime || 0) - (suite.startTime || 0));
  return `  <testsuite name="${escapeXml(suite.name)}" tests="${tests.length}" failures="${failures}" skipped="${skipped}" time="${suiteTime.toFixed(3)}">\n${testcases}\n  </testsuite>`;
}).join('\n');

const xml = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  `<testsuites name="Jest" tests="${totalTests}" failures="${totalFailures}" skipped="${totalSkipped}" time="${totalTime.toFixed(3)}">`,
  suiteXml,
  '</testsuites>',
  '',
].join('\n');

fs.mkdirSync(path.dirname(path.resolve(outputFile)), { recursive: true });
fs.writeFileSync(outputFile, xml, 'utf8');
console.log(`JUnit evidence written: ${outputFile}`);
