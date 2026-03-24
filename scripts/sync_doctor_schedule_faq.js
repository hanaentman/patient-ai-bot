const fs = require('fs');
const path = require('path');

const FAQ_PATH = path.join(__dirname, '..', 'data', 'faq.json');
const DOCS_DIR = path.join(__dirname, '..', 'docs');
const DOCTOR_LIST_FILE = path.join(DOCS_DIR, '외래-의료진 명단.txt');
const DOCTOR_INFO_FILE = path.join(DOCS_DIR, '홈페이지-의료진 정보.txt');

const ROLE_KEYWORD_ALIASES = {
  대표원장: ['대표원장'],
  병원장: ['병원장', '원장'],
  원장: ['원장'],
  두경부센터장: ['두경부 센터장', '센터장'],
  귀질환센터장: ['귀질환 센터장', '센터장'],
  진료부장: ['진료부장', '부장'],
  진료부원장: ['진료부원장', '부원장', '원장'],
  부원장: ['부원장', '원장'],
  부장: ['부장'],
  과장: ['과장'],
};

const DAY_LABELS = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function parseDoctorNames(listText) {
  const names = [];
  const regex = /([가-힣]{2,4})\s*(대표원장|병원장|원장|두경부\s*센터장|귀질환\s*센터장|진료부장|진료부원장|부원장|부장|과장)/g;
  let match;

  while ((match = regex.exec(listText)) !== null) {
    names.push(match[1]);
  }

  return unique(names);
}

function parseDoctorBlocks(infoText, doctorNames) {
  const lines = infoText.split(/\r?\n/);
  const names = new Set(doctorNames);
  const blocks = [];

  for (let index = 0; index < lines.length; index += 1) {
    const currentLine = normalizeWhitespace(lines[index]);
    const nextLine = normalizeWhitespace(lines[index + 1]);

    if (!names.has(currentLine) || !nextLine.startsWith(currentLine)) {
      continue;
    }

    const start = index;
    let end = lines.length;

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const candidate = normalizeWhitespace(lines[cursor]);
      const candidateNext = normalizeWhitespace(lines[cursor + 1]);

      if (cursor > start && names.has(candidate) && candidateNext.startsWith(candidate)) {
        end = cursor;
        break;
      }
    }

    blocks.push({
      name: currentLine,
      titleLine: nextLine,
      lines: lines.slice(start, end).map((line) => line.replace(/\r/g, '')),
    });

    index = end - 1;
  }

  return blocks;
}

function extractRole(titleLine, name) {
  const cleaned = normalizeWhitespace(titleLine)
    .replace(new RegExp(`^${name}`), '')
    .replace(/(이비인후과|내과|신경과|마취통증의학과)\s*전문의$/, '')
    .replace(/\s+/g, '');

  return cleaned || '';
}

function extractClinic(blockLines) {
  const clinicLine = blockLines.find((line) => (
    normalizeWhitespace(line).startsWith('진료과') || normalizeWhitespace(line).startsWith('진료과목')
  ));

  return normalizeWhitespace(clinicLine)
    .replace(/^진료과목?\s*/, '')
    .trim();
}

function parseScheduleRow(line) {
  const cells = line.split('\t').map((cell) => normalizeWhitespace(cell));
  return {
    label: cells[0] || '',
    days: cells.slice(1, 7),
  };
}

function parseDoctorSchedule(blockLines) {
  const index = blockLines.findIndex((line) => normalizeWhitespace(line) === '주간 진료 시간표');
  if (index === -1) {
    return null;
  }

  let morningRow = { label: '', days: [] };
  let afternoonRow = { label: '', days: [] };
  const notes = [];

  for (let cursor = index + 1; cursor < blockLines.length; cursor += 1) {
    const rawLine = String(blockLines[cursor] || '').replace(/\r/g, '');
    const line = normalizeWhitespace(rawLine);
    if (!line) {
      continue;
    }
    if (rawLine.startsWith('오전\t')) {
      morningRow = parseScheduleRow(rawLine);
      continue;
    }
    if (rawLine.startsWith('오후\t')) {
      afternoonRow = parseScheduleRow(rawLine);
      continue;
    }
    if (line === '온라인예약' || line === '주요경력') {
      break;
    }
  }

  for (let cursor = index + 1; cursor < blockLines.length; cursor += 1) {
    const line = normalizeWhitespace(blockLines[cursor]);
    if (!line) {
      continue;
    }
    if (line === '온라인예약' || line === '주요경력') {
      break;
    }
    if (line.startsWith('비고')) {
      notes.push(line.replace(/^비고\s*/, ''));
      continue;
    }
    if (line.startsWith('※')) {
      notes.push(line);
    }
  }

  return {
    morning: morningRow.days,
    afternoon: afternoonRow.days,
    notes: unique(notes),
  };
}

function getOpenDays(dayCells) {
  return dayCells
    .map((value, index) => (value === '진료' ? DAY_LABELS[index] : ''))
    .filter(Boolean);
}

function formatDayList(days) {
  if (days.length === 0) {
    return '';
  }

  if (days.length === 1) {
    return days[0];
  }

  return `${days.slice(0, -1).join(', ')}, ${days[days.length - 1]}`;
}

function buildScheduleSentence(name, role, clinic, schedule) {
  const morningDays = getOpenDays(schedule.morning);
  const afternoonDays = getOpenDays(schedule.afternoon);
  const subject = `${name}${role ? ` ${role}` : ''}`;
  const clinicText = clinic ? `${clinic} 진료를 담당하며 ` : '';
  const sentences = [];

  if (morningDays.length > 0) {
    sentences.push(`오전은 ${formatDayList(morningDays)}에 진료합니다`);
  }

  if (afternoonDays.length > 0) {
    sentences.push(`오후는 ${formatDayList(afternoonDays)}에 진료합니다`);
  }

  if (sentences.length === 0) {
    return `${subject}은 ${clinicText}홈페이지 기준 정기 외래 진료 시간이 별도로 표시되어 있지 않습니다.`.trim();
  }

  return `${subject}은 ${clinicText}${sentences.join(', ')}.`.trim();
}

function buildFollowUps(schedule) {
  const genericChangeNote = '※ 응급 수술 등에 의해 진료시간이 변경될 수 있으니 예약 및 내원 시 확인바랍니다.';
  const notes = schedule.notes.filter((note) => note !== genericChangeNote);
  const followUp = [];

  for (const note of notes) {
    followUp.push(note.replace(/^※\s*/, ''));
  }

  followUp.push('응급 수술 등에 따라 진료시간이 변경될 수 있어 내원 전 확인이 필요합니다.');
  return unique(followUp).slice(0, 4);
}

function slugifyName(name) {
  const slugMap = {
    동헌종: 'dongheonjong',
    이상덕: 'leesangdeok',
    정도광: 'jeongdogwang',
    이용배: 'leeyongbae',
    남순열: 'namsunyeol',
    주형로: 'joohyungro',
    장선오: 'jangseonoh',
    장정훈: 'jangjunghoon',
    김태현: 'kimtaehyun',
    정종인: 'jeongjongin',
    김종세: 'kimjongse',
    장규선: 'janggyuseon',
    김병길: 'kimbyeonggil',
    이영미: 'leeyoungmi',
    강매화: 'kangmaehwa',
    문보은: 'moonboeun',
    김태영: 'kimtaeyoung',
  };

  return slugMap[name] || `doctor-${Buffer.from(name).toString('hex')}`;
}

function buildKeywords(name, role) {
  const compactRole = normalizeWhitespace(role).replace(/\s+/g, '');
  const aliases = ROLE_KEYWORD_ALIASES[compactRole] || [];
  const keywords = [
    name,
    `${name} 진료시간`,
    `${name} 진료 시간`,
    `${name} 일정`,
    `${name} 진료일정`,
    `${name} 요일별 진료`,
    ...aliases.map((alias) => `${name} ${alias}`),
  ];

  return unique(keywords);
}

function buildDoctorScheduleFaqEntries(blocks) {
  return blocks
    .map((block) => {
      const role = extractRole(block.titleLine, block.name);
      const clinic = extractClinic(block.lines);
      const schedule = parseDoctorSchedule(block.lines);

      if (!schedule) {
        return null;
      }

      return {
        category: `doctor_schedule_${slugifyName(block.name)}`,
        keywords: buildKeywords(block.name, role),
        answer: buildScheduleSentence(block.name, role, clinic, schedule),
        followUp: buildFollowUps(schedule),
      };
    })
    .filter(Boolean);
}

function syncDoctorScheduleFaq() {
  const faqEntries = readJson(FAQ_PATH);
  const doctorListText = fs.readFileSync(DOCTOR_LIST_FILE, 'utf8');
  const doctorInfoText = fs.readFileSync(DOCTOR_INFO_FILE, 'utf8');
  const doctorNames = parseDoctorNames(doctorListText);
  const doctorBlocks = parseDoctorBlocks(doctorInfoText, doctorNames);
  const generatedEntries = buildDoctorScheduleFaqEntries(doctorBlocks);

  const preservedEntries = faqEntries.filter((entry) => !/^doctor_schedule_/.test(String(entry.category || '')) || entry.category === 'doctor_schedule_general');
  const nextEntries = [...preservedEntries, ...generatedEntries];

  writeJson(FAQ_PATH, nextEntries);
  console.log(`[doctor-faq-sync] updated ${generatedEntries.length} doctor schedule entries`);
}

syncDoctorScheduleFaq();
