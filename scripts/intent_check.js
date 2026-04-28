const fs = require('fs');
const path = require('path');
const { classifyIntentMeaning } = require('../lib/intent-classifier');

const ROOT_DIR = path.join(__dirname, '..');
const EVAL_DIR = path.join(ROOT_DIR, 'eval');
const FILES = [
  path.join(EVAL_DIR, 'seed-questions.json'),
  path.join(EVAL_DIR, 'wrong-answers.json'),
];

function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(parsed) ? parsed : [];
}

function main() {
  const cases = FILES.flatMap((filePath) => readJsonArray(filePath).map((item) => ({
    ...item,
    file: path.relative(ROOT_DIR, filePath),
  })));

  if (cases.length === 0) {
    console.log('No intent cases found.');
    return;
  }

  let checked = 0;
  let passed = 0;

  cases.forEach((item, index) => {
    const question = String(item.question || '').trim();
    if (!question) {
      return;
    }

    const result = classifyIntentMeaning(question);
    const expectedIntent = String(item.expectedIntent || '').trim();
    const hasExpectation = Boolean(expectedIntent);
    const ok = !hasExpectation || result.intent === expectedIntent;

    if (hasExpectation) {
      checked += 1;
      if (ok) {
        passed += 1;
      }
    }

    const status = hasExpectation ? (ok ? 'PASS' : 'FAIL') : 'INFO';
    console.log(`${status} #${index + 1} ${question}`);
    console.log(`  file: ${item.file}`);
    console.log(`  actual: ${result.intent} (${result.confidence}) ${result.reason}`);
    if (hasExpectation) {
      console.log(`  expected: ${expectedIntent}`);
    }
    if (result.needsClarification) {
      console.log(`  clarification: ${result.clarificationQuestion}`);
    }
  });

  if (checked > 0) {
    console.log(`\nIntent expectations: ${passed}/${checked} passed`);
    if (passed !== checked) {
      process.exitCode = 1;
    }
  }
}

main();
