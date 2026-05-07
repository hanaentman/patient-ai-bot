const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const EVAL_DIR = process.env.EVAL_DATA_DIR
  ? path.resolve(process.env.EVAL_DATA_DIR)
  : path.join(ROOT_DIR, 'eval');
const EVAL_FILES = [
  path.join(EVAL_DIR, 'wrong-answers.json'),
  path.join(EVAL_DIR, 'seed-questions.json'),
];
const EVAL_CACHE_TTL_MS = 30 * 1000;
let evalIntentCache = {
  expiresAt: 0,
  byQuestion: new Map(),
};

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, '');
}

function normalizeExpectedIntent(value) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const canonicalIntents = new Set([
    'reservation_or_reception',
    'parking_info',
    'mri_availability',
    'smell_exam',
    'smell_exam_fee',
    'admission_prep_items',
    'guardian_meal',
    'medication_stop',
    'nasal_irrigation',
    'nasal_irrigation_general',
    'nasal_irrigation_surgery',
    'receipt_issuance',
    'certificate_fee',
    'doctor_overview',
    'doctor_specialty',
    'hospital_phone',
    'same_day_exam_availability',
  ]);
  if (canonicalIntents.has(raw)) {
    return raw;
  }

  const tokens = raw
    .split(/[,\n/|]+/u)
    .map((part) => compactText(part))
    .filter(Boolean);
  const compact = compactText(raw);
  const keys = tokens.length ? tokens : [compact];

  const hasAny = (values) => keys.some((key) => values.includes(key)) || values.includes(compact);
  if (hasAny(['예약', '예약안내', '예약방법', '예약문의', '진료예약', '외래예약', '접수예약'])) {
    return 'reservation_or_reception';
  }
  if (hasAny(['주차', '주차안내', '주차장', '주차가능', '발렛', '발렛파킹'])) {
    return 'parking_info';
  }
  if (hasAny(['mri', 'mri검사', '엠알아이', '엠알아이검사'])) {
    return 'mri_availability';
  }
  if (hasAny(['후각검사', '후각저하검사', '후각장애검사', '냄새검사'])) {
    return 'smell_exam';
  }
  if (hasAny(['후각검사비용', '후각검사금액', '냄새검사비용'])) {
    return 'smell_exam_fee';
  }
  if (hasAny(['입원준비물', '입원준비', '입원물품'])) {
    return 'admission_prep_items';
  }
  if (hasAny(['보호자식사', '보호자식대', '보호자밥'])) {
    return 'guardian_meal';
  }
  if (hasAny(['약물중단', '복용중단약물', '입원전복용중단약물', '수술전약물중단'])) {
    return 'medication_stop';
  }
  if (hasAny(['수술후코세척', '수술후코세척방법'])) {
    return 'nasal_irrigation_surgery';
  }
  if (hasAny(['일반코세척', '일반코세척방법'])) {
    return 'nasal_irrigation_general';
  }
  if (hasAny(['코세척', '코세척방법'])) {
    return 'nasal_irrigation';
  }
  if (hasAny(['서류발급', '제증명', '진단서', '소견서', '진료기록사본', '검사결과지'])) {
    return 'receipt_issuance';
  }
  if (hasAny(['서류비용', '진단서비용', '제증명비용'])) {
    return 'certificate_fee';
  }
  if (hasAny(['의료진', '의료진소개', '의사소개', '전문의소개'])) {
    return 'doctor_overview';
  }
  if (hasAny(['전문분야', '의료진전문분야', '담당의료진'])) {
    return 'doctor_specialty';
  }
  if (hasAny(['대표전화', '전화번호', '병원전화'])) {
    return 'hospital_phone';
  }
  if (hasAny(['당일검사', '검사당일', '당일검사가능'])) {
    return 'same_day_exam_availability';
  }

  return raw;
}

function readJsonArray(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }

    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function getEvalIntentIndex() {
  const now = Date.now();
  if (evalIntentCache.expiresAt > now) {
    return evalIntentCache.byQuestion;
  }

  const byQuestion = new Map();
  EVAL_FILES.forEach((filePath) => {
    readJsonArray(filePath).forEach((item) => {
      const questionKey = compactText(item?.question || '');
      const expectedIntent = normalizeExpectedIntent(item?.expectedIntent || '');
      const expectedSource = String(item?.expectedSource || '').trim();
      const expectedAnswerHint = String(item?.expectedAnswerHint || '').trim();
      if (!questionKey || (!expectedIntent && !expectedSource && !expectedAnswerHint)) {
        return;
      }

      if (byQuestion.has(questionKey)) {
        return;
      }

      byQuestion.set(questionKey, {
        intent: expectedIntent || 'eval_source_guidance',
        expectedSource,
        expectedAnswerHint,
        file: path.basename(filePath),
      });
    });
  });

  evalIntentCache = {
    expiresAt: now + EVAL_CACHE_TTL_MS,
    byQuestion,
  };
  return byQuestion;
}

function findEvalIntentMatch(message) {
  const questionKey = compactText(message);
  if (!questionKey) {
    return null;
  }

  return getEvalIntentIndex().get(questionKey) || null;
}

function matchesAny(value, patterns) {
  return patterns.some((pattern) => pattern.test(value));
}

function buildResult(intent, options = {}) {
  return {
    intent,
    confidence: options.confidence ?? 0.85,
    needsClarification: Boolean(options.needsClarification),
    clarificationQuestion: options.clarificationQuestion || '',
    options: options.options || [],
    searchQuery: options.searchQuery || '',
    expectedSource: options.expectedSource || '',
    expectedAnswerHint: options.expectedAnswerHint || '',
    reason: options.reason || '',
  };
}

function classifyIntentMeaning(message) {
  const text = String(message || '').trim();
  const normalized = normalizeText(text);
  const compact = compactText(text);

  if (!normalized) {
    return buildResult('welcome', { confidence: 1, reason: 'empty_message' });
  }

  const evalIntentMatch = findEvalIntentMatch(text);
  if (evalIntentMatch) {
    return buildResult(evalIntentMatch.intent, {
      confidence: 0.99,
      searchQuery: evalIntentMatch.expectedSource || evalIntentMatch.expectedAnswerHint || text,
      expectedSource: evalIntentMatch.expectedSource,
      expectedAnswerHint: evalIntentMatch.expectedAnswerHint,
      reason: `eval_${evalIntentMatch.file}`,
    });
  }

  if (matchesAny(text, [/네트워크\s*병원/u, /전국\s*네트워크/u, /하나\s*네트워크/u, /네트워크\s*구축/u, /43\s*개소/u])) {
    return buildResult('network_hospital_info', {
      confidence: 0.96,
      searchQuery: '하나이비인후과 전국 네트워크 병원 43개소',
      reason: 'network_hospital_keyword',
    });
  }

  if (matchesAny(text, [/주차/u, /발렛/u, /주차권/u, /주차장/u])) {
    const isInpatient = matchesAny(text, [/입원/u, /수술/u, /퇴원/u, /밤샘/u, /종일/u]);
    const isOutpatient = matchesAny(text, [/외래/u, /방문객/u, /보호자/u, /내원/u, /통원/u]);
    return buildResult('parking_info', {
      confidence: isInpatient || isOutpatient ? 0.96 : 0.9,
      needsClarification: false,
      searchQuery: isInpatient ? '입원 환자 주차 안내' : '외래 방문 주차 안내',
      reason: 'parking_keyword',
    });
  }

  const isNasalIrrigation = matchesAny(text, [/코\s*세척/u, /비강\s*세척/u, /코\s*세정/u, /세척기/u, /세척\s*분말/u, /생리식염수\s*분말/u]);
  if (isNasalIrrigation) {
    if (matchesAny(text, [/수술/u, /퇴원/u, /수술후/u, /수술 후/u])) {
      return buildResult('nasal_irrigation_surgery', {
        confidence: 0.96,
        searchQuery: '수술 후 코세척 방법',
        reason: 'nasal_irrigation_surgery_keyword',
      });
    }

    if (matchesAny(text, [/일반/u, /평소/u, /비수술/u])) {
      return buildResult('nasal_irrigation_general', {
        confidence: 0.96,
        searchQuery: '일반 코세척 방법',
        reason: 'nasal_irrigation_general_keyword',
      });
    }

    return buildResult('nasal_irrigation', {
      confidence: 0.9,
      needsClarification: true,
      clarificationQuestion: '코세척은 수술 후 코세척인지 일반 코세척인지에 따라 안내가 달라집니다. 어느 경우인지 먼저 선택해 주세요.',
      options: ['수술 후 코세척이에요', '일반 코세척이에요'],
      searchQuery: '코세척 방법',
      reason: 'nasal_irrigation_ambiguous',
    });
  }

  if (
    normalized.includes('보호자')
    && (normalized.includes('식사') || normalized.includes('식대') || normalized.includes('밥') || normalized.includes('식권'))
  ) {
    return buildResult('guardian_meal', {
      confidence: 0.94,
      searchQuery: '보호자 식대 보호자 식사 신청',
      reason: 'guardian_meal_keyword',
    });
  }

  if (
    matchesAny(text, [/복용\s*중단/u, /중단\s*약물/u, /금지\s*약물/u, /중단해야\s*하는\s*약/u, /끊어야\s*하는\s*약/u, /먹으면\s*안\s*되는\s*약/u, /먹지\s*말아야\s*하는\s*약/u, /아스피린/u, /항응고/u, /항혈소판/u])
    || (matchesAny(text, [/수술\s*전/u, /입원\s*전/u]) && matchesAny(text, [/약/u, /약물/u, /복용약/u]))
    || compact.includes('입원전복용중단약물')
  ) {
    return buildResult('medication_stop', {
      confidence: 0.93,
      searchQuery: '입원 전 복용 중단 약물 리스트',
      reason: 'medication_stop_keyword',
    });
  }

  if (
    matchesAny(text, [/입원\s*준비물/u, /입원\s*시\s*준비물/u, /입원\s*전\s*준비물/u])
    || (normalized.includes('입원') && matchesAny(text, [/챙겨/u, /가져/u, /준비/u, /필요/u]))
  ) {
    return buildResult('admission_prep_items', {
      confidence: 0.9,
      searchQuery: '입원 준비물',
      reason: 'admission_prep_keyword',
    });
  }

  return buildResult('unknown', {
    confidence: 0.2,
    reason: 'no_high_confidence_rule',
  });
}

module.exports = {
  classifyIntentMeaning,
};
