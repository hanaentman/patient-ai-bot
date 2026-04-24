const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DOCS_DIR = path.join(ROOT_DIR, 'docs');
const OUT_DIR = path.join(ROOT_DIR, 'DOCSS');

const SECTION_LABELS = new Set([
  '검사',
  '진단',
  '진료/검사',
  '검사방법',
  '치료',
  '수술',
  '수술 후',
  '증상',
  '원인',
  '수술비용',
  '수술시간',
  '마취방법',
  '입원기간',
  '내원치료',
  '회복기간',
  '전문분야',
  '진료과',
  '진료과목',
  '주간 진료 시간표',
  '주요경력',
  '입원 전',
  '퇴원 후',
  '외래 진료 전',
  '기본 수칙',
]);

const DOCTOR_NAME_REGEX = /^[가-힣]{2,4}$/;
const DOCTOR_ROLE_REGEX = /(대표원장|병원장|부원장|센터장|진료부장|원장|과장)/;
const DOCTOR_FIELDS = [
  { label: '진료과목', key: 'center' },
  { label: '진료과', key: 'center' },
  { label: '전문분야', key: 'specialty' },
  { label: '주간 진료 시간표', key: 'schedule' },
  { label: '주요경력', key: 'career' },
];

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '');
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeText(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text, 'utf8');
}

function cleanText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\t/g, '\t')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function splitLines(text) {
  return cleanText(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function compact(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeInlineList(value) {
  return normalizeWhitespace(value)
    .replace(/[|·•]/g, ', ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/,\s*,+/g, ', ')
    .replace(/^,\s*/, '')
    .replace(/\s*,$/, '');
}

function filenameMeta(fileName) {
  const baseName = fileName.replace(/\.txt$/i, '');
  const [group, ...rest] = baseName.split('-');
  const title = rest.length > 0 ? rest.join('-') : baseName;
  const tags = [...new Set(
    baseName
      .split(/[-\s()]+/)
      .map((item) => item.trim())
      .filter(Boolean)
  )];

  return {
    fileName,
    baseName,
    group: group || '기타',
    title,
    tags,
  };
}

function classifyDoc(fileName) {
  if (/의료진 상세정보/i.test(fileName)) return 'doctor_detail';
  if (/의료진 정보/i.test(fileName)) return 'doctor_info';
  if (/의료진 명단/i.test(fileName)) return 'doctor_list';
  if (/유튜브-링크/i.test(fileName)) return 'link_map';
  if (/FAQ/i.test(fileName)) return 'faq';
  if (/비급여비용/i.test(fileName)) return 'pricing';
  if (/수술 후 주의사항/i.test(fileName)) return 'slide_notes';
  if (/홈페이지-/i.test(fileName)) return 'homepage_topic';
  return 'general';
}

function renderFrontMatter(meta) {
  return [
    '---',
    `source_file: docs/${meta.fileName}`,
    `source_group: ${meta.group}`,
    `doc_type: ${meta.docType}`,
    `title: ${meta.title}`,
    `tags: [${meta.tags.join(', ')}]`,
    '---',
    '',
  ].join('\n');
}

function renderNormalizedRaw(lines) {
  return [
    '## 정규화 원문',
    '',
    ...(lines.length > 0 ? lines.map((line) => `- ${line}`) : ['- 원문 없음']),
    '',
  ].join('\n');
}

function pushLines(body, lines) {
  lines.forEach((line) => body.push(line));
}

function parseFaqEntries(lines) {
  const entries = [];
  let currentCategory = '기본';
  let current = null;
  let answerMode = false;

  function flushCurrent() {
    if (!current) return;
    entries.push({
      category: current.category,
      question: normalizeWhitespace(current.question),
      answer: normalizeWhitespace(current.answerLines.join(' ')),
    });
    current = null;
    answerMode = false;
  }

  for (const line of lines) {
    if (!line.includes(':') && /관련$/.test(line)) {
      flushCurrent();
      currentCategory = line;
      continue;
    }

    const questionMatch = line.match(/^(?:\d+\.)?\s*질문\s*:?\s*(.+)$/);
    if (questionMatch) {
      flushCurrent();
      current = { category: currentCategory, question: questionMatch[1], answerLines: [] };
      answerMode = false;
      continue;
    }

    const numberedQuestionMatch = line.match(/^\d+\.\s*(.+\?)$/);
    if (numberedQuestionMatch) {
      flushCurrent();
      current = { category: currentCategory, question: numberedQuestionMatch[1], answerLines: [] };
      answerMode = false;
      continue;
    }

    const answerMatch = line.match(/^답변\s*:?\s*(.+)$/);
    if (answerMatch && current) {
      current.answerLines.push(answerMatch[1]);
      answerMode = true;
      continue;
    }

    if (current && answerMode) {
      current.answerLines.push(line);
      continue;
    }
  }

  flushCurrent();
  return entries;
}

function renderFaqDoc(meta, text) {
  const lines = splitLines(text);
  const entries = parseFaqEntries(lines);
  const body = [`# ${meta.title}`, '', '## 구조화 질문과 답변', ''];

  if (entries.length === 0) {
    pushLines(body, ['- 질문/답변 구조를 자동 추출하지 못했습니다.', '']);
  } else {
    let currentCategory = '';
    entries.forEach((entry, index) => {
      if (entry.category !== currentCategory) {
        currentCategory = entry.category;
        pushLines(body, [`### ${currentCategory}`, '']);
      }
      pushLines(body, [
        `#### Q${index + 1}. ${entry.question}`,
        `- 답변: ${entry.answer || '답변 없음'}`,
        '',
      ]);
    });
  }

  return renderFrontMatter(meta) + body.join('\n') + '\n' + renderNormalizedRaw(lines);
}

function parseDoctorList(text) {
  const lines = splitLines(text);
  const sections = [];
  let current = null;

  for (const line of lines) {
    const sectionMatch = line.match(/^\d+\.\s*(.+)$/);
    if (sectionMatch) {
      current = { section: sectionMatch[1].trim(), doctors: [] };
      sections.push(current);
      continue;
    }

    if (!current || /의료진 명단/.test(line)) continue;

    current.doctors.push(
      ...line
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    );
  }

  return sections;
}

function renderDoctorListDoc(meta, text) {
  const sections = parseDoctorList(text);
  const lines = splitLines(text);
  const body = [`# ${meta.title}`, '', '## 센터별 의료진', ''];

  if (sections.length === 0) {
    pushLines(body, ['- 센터별 구조를 자동 추출하지 못했습니다.', '']);
  } else {
    sections.forEach((section) => {
      pushLines(body, [`### ${section.section}`, '']);
      section.doctors.forEach((doctor) => body.push(`- ${doctor}`));
      body.push('');
    });
  }

  return renderFrontMatter(meta) + body.join('\n') + '\n' + renderNormalizedRaw(lines);
}

function splitBlocks(text) {
  return cleanText(text)
    .split(/\n\s*\n+/)
    .map((block) => block.trim())
    .filter(Boolean);
}

function isDoctorNameLine(line) {
  return DOCTOR_NAME_REGEX.test((line || '').trim());
}

function matchDoctorField(line) {
  const trimmed = String(line || '').trim();
  for (const field of DOCTOR_FIELDS) {
    if (trimmed === field.label) {
      return { key: field.key, remainder: '' };
    }
    if (trimmed.startsWith(field.label)) {
      return { key: field.key, remainder: trimmed.slice(field.label.length).trim() };
    }
  }
  return null;
}

function parseDoctorInfoBlock(block) {
  const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
  const firstLine = lines[0] || '';
  if (!isDoctorNameLine(firstLine)) return null;

  const item = {
    name: firstLine,
    role: '',
    profile: '',
    center: [],
    specialty: [],
    schedule: [],
    career: [],
  };
  let currentField = '';

  for (const line of lines.slice(1)) {
    const fieldMatch = matchDoctorField(line);
    if (fieldMatch) {
      currentField = fieldMatch.key;
      if (fieldMatch.remainder) {
        item[currentField].push(fieldMatch.remainder);
      }
      continue;
    }

    if (!item.profile && /이비인후과 전문의/.test(line)) {
      item.profile = line;
      const roleMatch = line.match(DOCTOR_ROLE_REGEX);
      if (roleMatch) item.role = roleMatch[1];
      continue;
    }

    if (currentField === 'career' && /논문.?연구실적/.test(line)) {
      continue;
    }

    if (currentField) {
      item[currentField].push(line);
    }
  }

  if (!item.role) {
    const roleMatch = lines.join(' ').match(DOCTOR_ROLE_REGEX);
    if (roleMatch) item.role = roleMatch[1];
  }

  return {
    name: item.name,
    role: item.role,
    profile: item.profile,
    center: normalizeInlineList(item.center.join(', ')),
    specialty: normalizeInlineList(item.specialty.join(', ')),
    scheduleLines: item.schedule
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean)
      .filter((line) => line !== '온라인예약'),
    careerLines: item.career
      .map((line) => normalizeWhitespace(line))
      .filter(Boolean),
  };
}

function splitDoctorInfoBlocks(text) {
  const lines = splitLines(text);
  const blocks = [];
  let current = [];

  const isDoctorBlockStart = (line, nextLine) => (
    isDoctorNameLine(line) && /이비인후과 전문의/.test(nextLine || '')
  );

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const nextLine = lines[index + 1] || '';

    if (isDoctorBlockStart(line, nextLine)) {
      if (current.length > 0) {
        blocks.push(current.join('\n'));
      }
      current = [line];
      continue;
    }

    if (current.length > 0) {
      current.push(line);
    }
  }

  if (current.length > 0) {
    blocks.push(current.join('\n'));
  }

  return blocks;
}

function renderDoctorInfoDoc(meta, text) {
  const lines = splitLines(text);
  const blocks = splitDoctorInfoBlocks(text).map(parseDoctorInfoBlock).filter(Boolean);
  const body = [`# ${meta.title}`, '', '## 의료진별 구조화 정보', ''];

  if (blocks.length === 0) {
    pushLines(body, ['- 의료진 블록을 자동 추출하지 못했습니다.', '']);
  } else {
    blocks.forEach((item) => {
      pushLines(body, [`### ${item.name}`, '']);
      if (item.role) body.push(`- 직함: ${item.role}`);
      if (item.profile) body.push(`- 소개: ${item.profile}`);
      if (item.center) body.push(`- 소속/진료과: ${item.center}`);
      if (item.specialty) body.push(`- 전문분야: ${item.specialty}`);

      if (item.scheduleLines.length > 0) {
        pushLines(body, ['', '#### 주간 진료 정보', '']);
        item.scheduleLines.forEach((line) => body.push(`- ${line}`));
      }

      if (item.careerLines.length > 0) {
        pushLines(body, ['', '#### 주요 경력', '']);
        item.careerLines.forEach((line) => body.push(`- ${line}`));
      }

      body.push('');
    });
  }

  return renderFrontMatter(meta) + body.join('\n') + '\n' + renderNormalizedRaw(lines);
}

function parseDoctorDetailDocs(text) {
  return cleanText(text)
    .split(/\[의료진\]/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n').map((line) => line.trim()).filter(Boolean);
      const fields = {};
      let currentField = '';

      for (const line of lines) {
        const match = line.match(/^([^:]+):\s*(.*)$/);
        if (match) {
          currentField = match[1].trim();
          fields[currentField] = fields[currentField] || [];
          if (match[2].trim()) {
            fields[currentField].push(match[2].trim());
          }
          continue;
        }

        if (currentField) {
          fields[currentField].push(line);
        }
      }

      return fields;
    });
}

function renderDoctorDetailDoc(meta, text) {
  const lines = splitLines(text);
  const blocks = parseDoctorDetailDocs(text);
  const body = [`# ${meta.title}`, '', '## 의료진 상세정보', ''];

  if (blocks.length === 0) {
    pushLines(body, ['- 의료진 상세정보 구조를 자동 추출하지 못했습니다.', '']);
  } else {
    blocks.forEach((fields, index) => {
      const title = (fields['이름'] || [])[0] || `의료진 ${index + 1}`;
      pushLines(body, [`### ${title}`, '']);
      Object.entries(fields).forEach(([key, values]) => {
        if (values.length === 0) return;
        if (values.length === 1) {
          body.push(`- ${key}: ${normalizeWhitespace(values[0])}`);
          return;
        }
        body.push(`- ${key}:`);
        values.forEach((value) => body.push(`  - ${normalizeWhitespace(value)}`));
      });
      body.push('');
    });
  }

  return renderFrontMatter(meta) + body.join('\n') + '\n' + renderNormalizedRaw(lines);
}

function renderLinkMapDoc(meta, text) {
  const lines = splitLines(text);
  const pairs = [];
  for (let index = 0; index < lines.length; index += 2) {
    const topic = lines[index];
    const url = lines[index + 1];
    if (topic && url && /^https?:\/\//i.test(url)) {
      pairs.push({ topic, url });
    }
  }

  const body = [`# ${meta.title}`, '', '## 주제별 링크', ''];
  if (pairs.length === 0) {
    pushLines(body, ['- 링크 쌍을 자동 추출하지 못했습니다.', '']);
  } else {
    pairs.forEach((pair) => body.push(`- ${pair.topic}: ${pair.url}`));
    body.push('');
  }

  return renderFrontMatter(meta) + body.join('\n') + '\n' + renderNormalizedRaw(lines);
}

function isSectionLabel(line) {
  return SECTION_LABELS.has(line)
    || /^\[[^\]]+\]$/.test(line)
    || /^STEP\s*\d+/i.test(line);
}

function parseTopicSections(lines) {
  const sections = [];
  let current = { title: '개요', lines: [] };

  for (const line of lines) {
    if (isSectionLabel(line)) {
      if (current.lines.length > 0) {
        sections.push(current);
      }
      current = { title: line.replace(/^\[|\]$/g, ''), lines: [] };
      continue;
    }

    current.lines.push(line);
  }

  if (current.lines.length > 0) {
    sections.push(current);
  }

  return sections;
}

function shouldSkipStructuredLine(line) {
  return /^(HOME|HANA ENT)/i.test(line) || line === '온라인예약';
}

function renderTopicDoc(meta, text) {
  const lines = splitLines(text);
  const sections = parseTopicSections(lines);
  const body = [`# ${meta.title}`, '', '## 구조화 섹션', ''];

  if (sections.length === 0) {
    pushLines(body, ['- 섹션 구조를 자동 추출하지 못했습니다.', '']);
  } else {
    sections.forEach((section) => {
      const sectionLines = section.lines.filter((line) => !shouldSkipStructuredLine(line));
      if (sectionLines.length === 0) return;
      pushLines(body, [`### ${section.title}`, '']);
      sectionLines.forEach((line) => body.push(`- ${line}`));
      body.push('');
    });
  }

  return renderFrontMatter(meta) + body.join('\n') + '\n' + renderNormalizedRaw(lines);
}

function renderSlideNotesDoc(meta, text) {
  const lines = splitLines(text);
  const blocks = cleanText(text)
    .split(/(?=\[슬라이드\s*\d+\])/)
    .map((block) => block.trim())
    .filter(Boolean);

  const body = [`# ${meta.title}`, '', '## 슬라이드별 정리', ''];
  if (blocks.length === 0) {
    pushLines(body, ['- 슬라이드 구조를 자동 추출하지 못했습니다.', '']);
  } else {
    blocks.forEach((block) => {
      const blockLines = block.split('\n').map((line) => line.trim()).filter(Boolean);
      const heading = blockLines.shift() || '슬라이드';
      pushLines(body, [`### ${heading}`, '']);
      blockLines.forEach((line) => body.push(`- ${line}`));
      body.push('');
    });
  }

  return renderFrontMatter(meta) + body.join('\n') + '\n' + renderNormalizedRaw(lines);
}

function renderDoc(meta, text) {
  switch (meta.docType) {
    case 'faq':
      return renderFaqDoc(meta, text);
    case 'doctor_list':
      return renderDoctorListDoc(meta, text);
    case 'doctor_info':
      return renderDoctorInfoDoc(meta, text);
    case 'doctor_detail':
      return renderDoctorDetailDoc(meta, text);
    case 'link_map':
      return renderLinkMapDoc(meta, text);
    case 'slide_notes':
      return renderSlideNotesDoc(meta, text);
    case 'pricing':
    case 'homepage_topic':
    case 'general':
    default:
      return renderTopicDoc(meta, text);
  }
}

function buildReadme(manifest) {
  const lines = [
    '# DOCSS',
    '',
    '`docs/` 폴더의 TXT 문서를 검색/학습에 더 쓰기 쉬운 Markdown 구조로 정리한 결과물입니다.',
    '',
    '## 원칙',
    '',
    '- 원본은 `docs/`에 그대로 둡니다.',
    '- 변환본은 `DOCSS/`에 문서 유형별 구조를 붙여 저장합니다.',
    '- 각 문서는 메타데이터 + 구조화 섹션 + 정규화 원문을 함께 가집니다.',
    '',
    `## 생성 문서 수`,
    '',
    `- 총 ${manifest.length}개`,
    '',
    '## 문서 목록',
    '',
  ];

  manifest.forEach((item) => {
    lines.push(`- ${item.outputFile} (${item.docType}) <- ${item.sourceFile}`);
  });

  pushLines(lines, [
    '',
    '## 재생성 방법',
    '',
    '```powershell',
    'cd C:\\Users\\OCSEMR\\patient-ai-bot',
    'node scripts\\build_docss.js',
    '```',
    '',
  ]);

  return lines.join('\n');
}

function main() {
  ensureDir(OUT_DIR);

  const docFiles = fs.readdirSync(DOCS_DIR)
    .filter((name) => name.toLowerCase().endsWith('.txt'))
    .sort((a, b) => a.localeCompare(b, 'ko'));

  const manifest = [];

  for (const fileName of docFiles) {
    const filePath = path.join(DOCS_DIR, fileName);
    const meta = {
      ...filenameMeta(fileName),
      docType: classifyDoc(fileName),
    };
    const outputFile = `${meta.baseName}.md`;
    const rendered = renderDoc(meta, readText(filePath));

    writeText(path.join(OUT_DIR, outputFile), rendered);
    manifest.push({
      sourceFile: `docs/${fileName}`,
      outputFile: `DOCSS/${outputFile}`,
      docType: meta.docType,
      group: meta.group,
      title: meta.title,
      tags: meta.tags,
    });
  }

  writeText(path.join(OUT_DIR, 'index.json'), JSON.stringify(manifest, null, 2));
  writeText(path.join(OUT_DIR, 'README.md'), buildReadme(manifest));
  console.log(`DOCSS build complete: ${manifest.length} files`);
}

main();
