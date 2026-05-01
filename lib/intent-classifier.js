const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');
const EVAL_DIR = process.env.EVAL_DATA_DIR
  ? path.resolve(process.env.EVAL_DATA_DIR)
  : path.join(ROOT_DIR, 'eval');
const EVAL_FILES = [
  path.join(EVAL_DIR, 'seed-questions.json'),
  path.join(EVAL_DIR, 'wrong-answers.json'),
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
      const expectedIntent = String(item?.expectedIntent || '').trim();
      if (!questionKey || !expectedIntent) {
        return;
      }

      if (byQuestion.has(questionKey)) {
        return;
      }

      byQuestion.set(questionKey, {
        intent: expectedIntent,
        expectedSource: String(item?.expectedSource || '').trim(),
        expectedAnswerHint: String(item?.expectedAnswerHint || '').trim(),
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
