const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const FAQ_PATH = path.join(ROOT_DIR, 'data', 'faq.json');
const DOCS_DIR = path.join(ROOT_DIR, 'docs');
const DOCTOR_INFO_FILE = path.join(DOCS_DIR, '홈페이지-의료진 정보.txt');

const DAY_LABELS = ['월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
const DOCTOR_SLUGS = {
  동헌종: 'dongheonjong',
  이상덕: 'leesangdeok',
  정도광: 'jeongdogwang',
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
};

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeWhitespace(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isDoctorNameLine(line) {
  return /^[가-힣]{2,4}$/.test(normalizeWhitespace(line));
}

function extractRole(profile, name) {
  return normalizeWhitespace(profile)
    .replace(name, '')
    .replace(/이비인후과 전문의/gu, '')
    .trim();
}

function splitDoctorBlocks(text) {
  const lines = String(text || '').split(/\r?\n/);
  const blocks = [];
  let current = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = normalizeWhitespace(lines[index]);
    const nextLine = normalizeWhitespace(lines[index + 1] || '');

    if (isDoctorNameLine(line) && nextLine.startsWith(line) && nextLine.includes('이비인후과 전문의')) {
      if (current.length > 0) {
        blocks.push(current);
      }
      current = [lines[index]];
      continue;
    }

    if (current.length > 0) {
      current.push(lines[index]);
    }
  }

  if (current.length > 0) {
    blocks.push(current);
  }

  return blocks;
}

function parseDoctorBlocks(text) {
  return splitDoctorBlocks(text).map((rawLines) => {
    const lines = rawLines.map((line) => String(line || '').replace(/\r/g, ''));
    const name = normalizeWhitespace(lines[0]);
    const profile = normalizeWhitespace(lines[1]);
    const role = extractRole(profile, name);
    const entry = {
      name,
      profile,
      role,
      center: '',
      specialty: '',
      schedule: {
        morning: [],
        afternoon: [],
        notes: [],
        raw: [],
      },
    };

    let mode = '';
    lines.slice(2).forEach((rawLine) => {
      const line = normalizeWhitespace(rawLine);
      if (!line) {
        return;
      }

      if (line.startsWith('진료과목')) {
        mode = 'center';
        entry.center = line.replace(/^진료과목\s*/u, '').trim();
        return;
      }
      if (line.startsWith('진료과')) {
        mode = 'center';
        entry.center = line.replace(/^진료과\s*/u, '').trim();
        return;
      }
      if (line.startsWith('전문분야')) {
        mode = 'specialty';
        entry.specialty = line.replace(/^전문분야\s*/u, '').trim();
        return;
      }
      if (line === '주간 진료 시간표') {
        mode = 'schedule';
        return;
      }
      if (line === '주요경력') {
        mode = 'career';
        return;
      }
      if (line === '온라인예약' || line === '논문&연구실적') {
        return;
      }

      if (mode === 'center' && !entry.center) {
        entry.center = line;
        return;
      }
      if (mode === 'specialty' && !entry.specialty) {
        entry.specialty = line;
        return;
      }
      if (mode === 'schedule') {
        entry.schedule.raw.push(line);

        if (rawLine.startsWith('오전\t')) {
          entry.schedule.morning = rawLine.split('\t').slice(1, 7).map((cell) => normalizeWhitespace(cell));
          return;
        }
        if (rawLine.startsWith('오후\t')) {
          entry.schedule.afternoon = rawLine.split('\t').slice(1, 7).map((cell) => normalizeWhitespace(cell));
          return;
        }
        if (line.startsWith('비고')) {
          entry.schedule.notes.push(line.replace(/^비고\s*/u, '').trim());
          return;
        }
        if (line.startsWith('※')) {
          entry.schedule.notes.push(line);
        }
      }
    });

    entry.schedule.notes = unique(entry.schedule.notes);
    return entry;
  }).filter((entry) => entry.name);
}

function getOpenDays(dayCells) {
  return dayCells
    .map((value, index) => (value === '진료' ? DAY_LABELS[index] : ''))
    .filter(Boolean);
}

function formatDayList(days) {
  if (days.length === 0) return '';
  if (days.length === 1) return days[0];
  return `${days.slice(0, -1).join(', ')}, ${days[days.length - 1]}`;
}

function buildScheduleAnswer(entry) {
  const displayName = entry.role ? `${entry.name} ${entry.role}` : entry.name;
  const morningDays = getOpenDays(entry.schedule.morning);
  const afternoonDays = getOpenDays(entry.schedule.afternoon);
  const parts = [];

  if (entry.center) {
    parts.push(`${displayName}은(는) ${entry.center} 진료를 담당합니다.`);
  }
  if (morningDays.length > 0) {
    parts.push(`오전은 ${formatDayList(morningDays)}에 진료합니다.`);
  }
  if (afternoonDays.length > 0) {
    parts.push(`오후는 ${formatDayList(afternoonDays)}에 진료합니다.`);
  }
  if (parts.length === 0 && entry.schedule.raw.length > 0) {
    parts.push(`${displayName}의 진료 시간표는 홈페이지 기준으로 안내되어 있습니다.`);
  }

  return parts.join(' ');
}

function buildScheduleFollowUp(entry) {
  const followUp = [...entry.schedule.notes];
  followUp.push('응급 수술 등에 따라 진료시간이 변경될 수 있어 내원 전 확인이 필요합니다.');
  return unique(followUp).slice(0, 4);
}

function doctorKeywords(name, role) {
  const keywords = [
    name,
    `${name} 진료시간`,
    `${name} 진료 시간`,
    `${name} 일정`,
    `${name} 진료일정`,
    `${name} 요일별 진료`,
  ];
  if (role) {
    keywords.push(`${name} ${role}`);
  }
  return unique(keywords);
}

function matches(entry, patterns) {
  const haystack = `${entry.center} ${entry.specialty} ${entry.profile}`;
  return patterns.some((pattern) => pattern.test(haystack));
}

function buildDoctorOverviewFaq(entries) {
  const representatives = entries.slice(0, 10).map((entry) => entry.role ? `${entry.name} ${entry.role}` : entry.name);
  const nose = entries.filter((entry) => matches(entry, [/코 센터/u, /비염|부비동|축농증|비중격|코물혹|코 막힘/u]));
  const ear = entries.filter((entry) => matches(entry, [/귀 센터/u, /난청|이명|어지럼|인공와우|중이염|보청기|메니에르/u]));
  const throatSleep = entries.filter((entry) => matches(entry, [/두경부/u, /수면클리닉/u, /음성|인후두|갑상선|후두|구강암|침샘/u]));
  const internal = entries.filter((entry) => matches(entry, [/내과/u]));

  return {
    category: 'doctors_overview',
    keywords: ['의사', '진료의사', '의료진', '원장님', '전문의', '선생님', '누가 진료'],
    answer: representatives.length > 0
      ? `하나이비인후과병원 홈페이지 기준으로 현재 의료진 정보를 확인할 수 있습니다. 대표 의료진으로는 ${representatives.join(', ')} 등이 있습니다.`
      : '하나이비인후과병원 홈페이지 기준으로 현재 의료진 정보를 확인할 수 있습니다.',
    followUp: [
      nose.length > 0 ? `코 질환 의사: ${unique(nose.map((entry) => entry.name)).join(', ')}` : '',
      throatSleep.length > 0 ? `목·두경부·수면클리닉: ${unique(throatSleep.map((entry) => entry.name)).join(', ')}` : '',
      ear.length > 0 ? `귀 질환 의사: ${unique(ear.map((entry) => entry.name)).join(', ')}` : '',
      internal.length > 0 ? `내과: ${unique(internal.map((entry) => entry.name)).join(', ')}` : '',
      '세부 일정은 내원 전 대표전화 02-6925-1111로 확인해 주세요.',
    ].filter(Boolean),
  };
}

function buildDoctorSpecialtyFaq(category, keywords, answer, followUp) {
  return { category, keywords, answer, followUp };
}

function buildDoctorFaqEntries(entries) {
  const nose = entries.filter((entry) => matches(entry, [/코 센터/u, /비염|부비동|축농증|비중격|코물혹|코 막힘/u]));
  const ear = entries.filter((entry) => matches(entry, [/귀 센터/u, /난청|이명|어지럼|인공와우|중이염|보청기|메니에르/u]));
  const throatSleep = entries.filter((entry) => matches(entry, [/두경부/u, /수면클리닉/u, /음성|인후두|갑상선|후두|구강암|침샘/u]));
  const internal = entries.filter((entry) => matches(entry, [/내과/u]));

  const faqEntries = [
    buildDoctorOverviewFaq(entries),
    buildDoctorSpecialtyFaq(
      'doctors_nose',
      ['코센터', '코 의사', '비염', '비염 의사', '비염 의료진', '비염 추천', '축농증', '축농증 의사', '코 수술', '비중격만곡증', '코막힘', ...unique(nose.map((entry) => entry.name))],
      `코 센터 의료진으로는 ${unique(nose.map((entry) => entry.role ? `${entry.name} ${entry.role}` : entry.name)).join(', ')}이(가) 현재 홈페이지에 안내되어 있습니다.`,
      [
        nose.length > 0 ? `비염 관련 코 센터 의료진: ${unique(nose.map((entry) => entry.name)).join(', ')}` : '',
        '세부 일정은 내원 전 대표전화 02-6925-1111로 확인해 주세요.',
      ].filter(Boolean),
    ),
    buildDoctorSpecialtyFaq(
      'doctors_ear',
      ['귀센터', '귀 의사', '어지럼증 의사', '이명 의사', '난청 의사', '중이염 의사', '보청기', ...unique(ear.map((entry) => entry.name))],
      `귀 질환 관련 의료진으로는 ${unique(ear.map((entry) => entry.role ? `${entry.name} ${entry.role}` : entry.name)).join(', ')}이(가) 현재 홈페이지에 안내되어 있습니다.`,
      ['세부 일정은 내원 전 대표전화 02-6925-1111로 확인해 주세요.'],
    ),
    buildDoctorSpecialtyFaq(
      'doctors_throat_sleep',
      ['목센터', '목 의사', '코골이 의사', '수면무호흡 의사', '편도 의사', '갑상선 의사', '음성'],
      `목·두경부·수면클리닉 의료진으로는 ${unique(throatSleep.map((entry) => entry.role ? `${entry.name} ${entry.role}` : entry.name)).join(', ')}이(가) 현재 홈페이지에 안내되어 있습니다.`,
      ['세부 일정은 내원 전 대표전화 02-6925-1111로 확인해 주세요.'],
    ),
    buildDoctorSpecialtyFaq(
      'doctors_internal',
      ['내과', '내과 의사', '예방접종', '소화기', '건강검진', '신경과', '두통', '불면증'],
      internal.length > 0
        ? `내과 의료진으로는 ${unique(internal.map((entry) => entry.role ? `${entry.name} ${entry.role}` : entry.name)).join(', ')}이(가) 현재 홈페이지에 안내되어 있습니다.`
        : '현재 홈페이지 기준으로 내과 의료진 정보를 확인할 수 있습니다.',
      ['세부 일정은 내원 전 대표전화 02-6925-1111로 확인해 주세요.'],
    ),
    {
      category: 'doctor_schedule_general',
      keywords: ['진료일정', '진료표', '의사 일정', '원장 일정', '요일별 진료', '주간 진료'],
      answer: '하나이비인후과병원은 홈페이지에서 의료진별 주간 진료시간표를 안내하고 있습니다. 다만 응급 수술이나 휴진 일정에 따라 변동될 수 있어 내원 전 확인이 필요합니다.',
      followUp: ['대표전화 02-6925-1111'],
    },
  ];

  entries.forEach((entry) => {
    faqEntries.push({
      category: `doctor_schedule_${DOCTOR_SLUGS[entry.name] || Buffer.from(entry.name).toString('hex')}`,
      keywords: doctorKeywords(entry.name, entry.role),
      answer: buildScheduleAnswer(entry),
      followUp: buildScheduleFollowUp(entry),
    });
  });

  return faqEntries;
}

function replaceDoctorFaqEntries(existingFaq, doctorFaqEntries) {
  const doctorCategories = new Set(doctorFaqEntries.map((entry) => entry.category));
  const preserved = existingFaq.filter((entry) => !doctorCategories.has(entry.category));
  return [...preserved, ...doctorFaqEntries];
}

function main() {
  if (!fs.existsSync(DOCTOR_INFO_FILE)) {
    throw new Error(`Doctor info doc not found: ${DOCTOR_INFO_FILE}`);
  }

  const doctorInfoText = fs.readFileSync(DOCTOR_INFO_FILE, 'utf8');
  const entries = parseDoctorBlocks(doctorInfoText);
  const faq = readJson(FAQ_PATH);
  const updatedFaq = replaceDoctorFaqEntries(faq, buildDoctorFaqEntries(entries));
  writeJson(FAQ_PATH, updatedFaq);
  console.log(`Doctor FAQ sync complete: ${entries.length} doctors`);
}

main();
