const fs = require('fs');
const path = require('path');
const { createSemanticSearchService } = require('../lib/semantic-search');

const ROOT_DIR = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT_DIR, 'docs');
const FAQ_PATH = path.join(ROOT_DIR, 'data', 'faq.json');
const FAQ_EXTENDED_PATH = path.join(ROOT_DIR, 'data', 'faq-extended.json');
const IMAGE_GUIDES_PATH = path.join(ROOT_DIR, 'data', 'image-guides.json');
const DEFAULT_QUESTIONS = [
  '수술 전에 먹으면 안 되는 약 있어?',
  '비염 수술하면 며칠 입원해?',
  '입원할 때 뭐 챙겨가야 해?',
  '보호자 밥 신청할 수 있어?',
  '아스피린 먹고 있는데 수술 괜찮아?',
];

function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(parsed) ? parsed : [];
}

function normalizeLine(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function splitTextIntoChunks(text, maxLength = 900) {
  const lines = String(text || '')
    .replace(/\r/g, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const chunks = [];
  let current = '';

  lines.forEach((line) => {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLength && current) {
      chunks.push(current);
      current = line;
      return;
    }
    current = next;
  });

  if (current) {
    chunks.push(current);
  }

  return chunks;
}

function loadLocalDocuments() {
  if (!fs.existsSync(DOCS_DIR)) {
    return [];
  }

  const docs = [];
  fs.readdirSync(DOCS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile() && ['.txt'].includes(path.extname(entry.name).toLowerCase()))
    .forEach((entry) => {
      const filePath = path.join(DOCS_DIR, entry.name);
      const sourceTitle = path.parse(entry.name).name;
      const text = fs.readFileSync(filePath, 'utf8');
      splitTextIntoChunks(text).forEach((chunk, index) => {
        docs.push({
          title: `Local doc - ${sourceTitle}`,
          sourceTitle,
          url: `local://docs/${encodeURIComponent(entry.name)}`,
          text: chunk,
          keywords: [sourceTitle],
          sourceType: 'local',
          chunkLabel: `${entry.name}${index > 0 ? ` #${index + 1}` : ''}`,
        });
      });
    });

  return docs;
}

function loadIntegratedFaqCards() {
  const filePath = path.join(DOCS_DIR, '통합-FAQ.txt');
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const lines = fs.readFileSync(filePath, 'utf8')
    .replace(/\r/g, '')
    .split('\n')
    .map(normalizeLine);
  const cards = [];
  let current = null;

  lines.forEach((line) => {
    if (!line) {
      return;
    }

    const questionMatch = line.match(/^(?:질문|Q\.?|Q:)\s*:?\s*(.+)$/iu);
    if (questionMatch) {
      if (current && current.answerLines.length > 0) {
        cards.push({
          question: current.question,
          aliases: [current.question],
          answer: current.answerLines.join('\n'),
        });
      }
      current = {
        question: questionMatch[1].trim(),
        answerLines: [],
      };
      return;
    }

    if (current) {
      current.answerLines.push(line);
    }
  });

  if (current && current.answerLines.length > 0) {
    cards.push({
      question: current.question,
      aliases: [current.question],
      answer: current.answerLines.join('\n'),
    });
  }

  return cards;
}

async function main() {
  const questions = process.argv.slice(2);
  const queryList = questions.length > 0 ? questions : DEFAULT_QUESTIONS;
  const service = createSemanticSearchService({
    getSources: () => ({
      faqEntries: [
        ...readJsonArray(FAQ_PATH),
        ...readJsonArray(FAQ_EXTENDED_PATH),
      ],
      integratedFaqCards: loadIntegratedFaqCards(),
      localDocuments: loadLocalDocuments(),
      imageGuides: readJsonArray(IMAGE_GUIDES_PATH),
    }),
  });

  const status = service.getStatus();
  if (!status.enabled) {
    console.log('OPENAI_API_KEY가 없어 embedding 검색은 실행하지 않습니다.');
    console.log(`검색용 chunk 수: ${service.buildSemanticDocumentsForTest().length}`);
    console.log('키를 설정한 뒤 다시 실행하면 질문별 top 문서를 확인할 수 있습니다.');
    return;
  }

  for (const question of queryList) {
    console.log(`\n질문: ${question}`);
    const results = await service.search(question, 5);
    if (results.length === 0) {
      console.log('- 검색 결과 없음');
      continue;
    }

    results.forEach((doc, index) => {
      console.log(`${index + 1}. ${doc.sourceTitle || doc.title} / ${doc.chunkLabel || ''}`);
      console.log(`   score: ${doc.semanticScore}`);
      console.log(`   preview: ${normalizeLine(doc.text).slice(0, 140)}`);
    });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
