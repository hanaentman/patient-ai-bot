const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { DatabaseSync } = require('node:sqlite');
const XLSX = require('xlsx');

const PORT = process.env.PORT || 3000;
const IS_RENDER = Boolean(process.env.RENDER || process.env.RENDER_SERVICE_ID);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const ADMIN_LOGIN_USERNAME = 'hanaent';
const ADMIN_LOGIN_PASSWORD = 'hana1120@@';
const ADMIN_SESSION_COOKIE = 'admin_session';
const ADMIN_SESSION_VALUE = 'hanaent-admin-authenticated';
const PUBLIC_DIR = path.join(__dirname, 'public');
const FAQ_PATH = path.join(__dirname, 'data', 'faq.json');
const FAQ_EXTENDED_PATH = path.join(__dirname, 'data', 'faq-extended.json');
const SITE_SOURCES_PATH = path.join(__dirname, 'data', 'site-sources.json');
const IMAGE_GUIDES_PATH = path.join(__dirname, 'data', 'image-guides.json');
const POPULAR_QUESTIONS_PATH = path.join(__dirname, 'data', 'popular-question-stats.json');
const CHAT_LOGS_PATH = path.join(__dirname, 'data', 'chat-logs.json');
const CHAT_LOGS_DB_PATH = path.join(__dirname, 'data', 'chat-logs.db');
const DOCS_DIR = path.join(__dirname, 'docs');
const DOCTOR_LIST_DOC_FILENAME = '외래-의료진 명단.txt';
const DOCTOR_INFO_DOC_FILENAME = '홈페이지-의료진 정보.txt';
const DOCTOR_SYNC_SCRIPT_PATH = path.join(__dirname, 'scripts', 'sync_doctor_schedule_faq.js');
const FLOOR_GUIDE_DOC_PATH = path.join(DOCS_DIR, '기타-층별안내도.txt');
const CERTIFICATE_FEES_DOC_PATH = findDocPathByKeyword('비급여비용');
const YOUTUBE_LINKS_PATH = path.join(DOCS_DIR, '유튜브-링크.txt');

const siteSources = JSON.parse(fs.readFileSync(SITE_SOURCES_PATH, 'utf8'));
const imageGuides = fs.existsSync(IMAGE_GUIDES_PATH)
  ? JSON.parse(fs.readFileSync(IMAGE_GUIDES_PATH, 'utf8'))
  : [];
const sessions = new Map();
const allowedHostnames = ['www.hanaent.co.kr', 'hanaent.co.kr'];
const LOCAL_FAQ_URL = (
  siteSources.find((source) => source.type === 'official' && /faq|info06/i.test(source.url))
  || siteSources.find((source) => source.type === 'official' && /faq/i.test(source.title || ''))
  || { url: 'https://www.hanaent.co.kr/info/info06.html' }
).url;
const faqCategoryUrlHints = {
  reservation: 'info/info05.html',
  hours: 'info/info01.html',
  location: 'info/info04.html',
  documents: 'info/info09.html',
  exam: 'info/info01.html',
  admission: 'info/info03.html',
  doctors_overview: 'intro/intro02.html',
  doctors_nose: 'nose/nose01.html',
  doctors_ear: 'ear/ear01.html',
  doctors_throat_sleep: 'neck/neck01.html',
  doctors_internal: 'nerve/nerve01.html',
  same_day_reservation_detail: 'info/info05.html',
  first_visit_process: 'info/info05.html',
  ct_result_submission: 'info/info09.html',
  multi_department_visit: 'intro/intro02.html',
  preop_test_detail: 'info/info03.html',
  surgery_reservation_process: 'info/info03.html',
  card_refund: 'info/info06.html',
  guardian_stay: 'info/info03.html',
  rhinitis_control: 'nose/nose05.html',
  sinusitis_treatment_options: 'nose/nose01.html',
  nasal_irrigation: 'nose/nose01.html',
  nose_exam_turnaround: 'nose/nose01.html',
  tinnitus_hearing_loss: 'ear/ear01.html',
  ear_exam_turnaround: 'ear/ear01.html',
  sleep_study_required: 'neck/neck01.html',
  sleep_study_insurance: 'neck/neck01.html',
  cpap_insurance: 'neck/neck01.html',
  doctor_schedule_general: 'info/info01.html',
  doctor_schedule_dong: 'info/info01.html',
  doctor_schedule_kimtaehyun: 'info/info01.html',
  doctor_schedule_jung: 'info/info01.html',
  doctor_schedule_joo: 'info/info01.html',
  doctor_schedule_jang: 'info/info01.html',
  doctor_schedule_nerve: 'info/info01.html',
};
const sourceTypeWeights = {
  official: 0.9,
  local: 1.8,
  external: 0.2,
  low_trust: 0.1,
};

const emergencyPatterns = [
  /응급/u,
  /호흡곤란/u,
  /가슴\s*통증/u,
  /의식/u,
  /심한\s*출혈/u,
  /경련/u,
  /실신/u,
  /마비/u,
  /숨이?\s*(차|안)/u,
  /119/u,
];

const medicalRestrictionPatterns = [
  /진단/u,
  /처방/u,
  /병명/u,
  /암인가/u,
  /수술해야/u,
  /(^|[^가-힣])(약|복용약|먹는약).{0,8}(바꿔|변경|중단|끊어)/u,
];

const lateArrivalPatterns = [
  /늦게\s*도착/u,
  /늦을\s*것\s*같/u,
  /지각/u,
  /예약\s*시간.{0,10}늦/u,
  /예약.{0,12}늦/u,
  /도착.{0,12}늦/u,
];

const certificateDocumentQuestionPatterns = [
  /진단서/u,
  /병사용\s*진단서/u,
  /영문\s*진단서/u,
  /상해\s*진단서/u,
  /후유장애\s*진단서/u,
  /장애\s*진단서/u,
  /진료확인서/u,
  /입퇴원\s*확인서/u,
  /제증명/u,
  /서류\s*발급/u,
  /재발급/u,
  /의무기록/u,
];

const inpatientMealPolicyPatterns = [
  /취사/u,
  /전자\s*레인지/u,
  /전자레인지/u,
  /전자렌지/u,
];

const floorGuidePatterns = [
  /\d+\s*번\s*진료실/u,
  /\d+\s*진료실/u,
  /몇\s*층/u,
  /어느\s*층/u,
  /어디/u,
  /위치/u,
  /층별/u,
  /안내도/u,
];

const rhinitisPostOpVisitPatterns = [
  /비염.{0,12}수술.{0,12}(통원|내원)/u,
  /만성비염.{0,12}수술.{0,12}(통원|내원)/u,
  /(통원|내원).{0,12}비염.{0,12}수술/u,
  /(통원|내원).{0,12}만성비염.{0,12}수술/u,
  /비염.{0,12}수술\s*후/u,
  /만성비염.{0,12}수술\s*후/u,
  /하비갑개.{0,12}(통원|내원)/u,
];

const personalInfoPatterns = [
  /\b\d{6}[- ]?\d{7}\b/,
  /\b01[016789][- ]?\d{3,4}[- ]?\d{4}\b/,
  /\b(?:02|0[3-9]\d)[- ]?\d{3,4}[- ]?\d{4}\b/,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /(주민등록번호|주민번호|휴대폰번호|핸드폰번호|전화번호|이메일|메일주소|상세주소|집주소|우편번호)/u,
];

const documentCache = {
  loadedAt: 0,
  docs: [],
  pendingPromise: null,
};
const responseCache = new Map();
const RESPONSE_CACHE_TTL_MS = 10 * 60 * 1000;
const RESPONSE_CACHE_MAX_ENTRIES = 200;
const popularQuestionStats = loadPopularQuestionStats();
const POPULAR_QUESTION_LIMIT = 6;
const DEFAULT_POPULAR_QUESTIONS = [
  { label: '진료과', question: '진료과를 알려줘' },
  { label: '원장 일정', question: '하나이비인후과 원장 진료시간 알려줘' },
  { label: '신경과 일정', question: '신경과 원장 진료시간 알려줘' },
  { label: '병원 진료시간', question: '진료시간 안내해줘' },
  { label: '예약 변경', question: '예약 변경 방법 알려줘' },
  { label: '코골이 상담', question: '코골이 진료 과를 알려줘' },
];
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_IP_PER_MINUTE = 10;
const RATE_LIMIT_SESSION_PER_MINUTE = 5;
const RATE_LIMIT_SESSION_PER_DAY = 40;
const ipRateWindow = new Map();
const sessionMinuteRateWindow = new Map();
const sessionDailyRateWindow = new Map();
let warmupStarted = false;
const MAX_CHAT_LOG_ENTRIES = 5000;
const chatLogDb = createChatLogDatabase();
let docsWatchDebounceTimer = null;
let pendingDoctorDocsUpdate = false;
let doctorScheduleSyncInProgress = false;
let doctorScheduleSyncQueued = false;
let runtimeData = null;
let docsWatcher = null;

function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(parsed) ? parsed : [];
}

function loadFaqEntries() {
  return [
    ...readJsonArray(FAQ_PATH),
    ...readJsonArray(FAQ_EXTENDED_PATH),
  ];
}

function createRuntimeData() {
  const faqEntries = loadFaqEntries();
  const localDocuments = buildLocalDocuments();

  return {
    faqEntries,
    faqDocuments: buildFaqDocuments(faqEntries),
    localDocuments,
    certificateFeeEntries: buildCertificateFeeEntries(),
    floorGuideIndex: buildFloorGuideIndex(),
    homepageDiseaseTerms: buildHomepageDiseaseTerms(localDocuments),
    youtubeLinks: loadYoutubeLinks(),
  };
}

function invalidateDynamicCaches() {
  documentCache.loadedAt = 0;
  documentCache.docs = [];
  documentCache.pendingPromise = null;
  responseCache.clear();
  warmupStarted = false;
}

function refreshRuntimeData(reason = 'manual refresh') {
  runtimeData = createRuntimeData();
  invalidateDynamicCaches();
  console.log(`[docs-refresh] ${reason}`);
  return runtimeData;
}

function isDoctorScheduleSourceFile(filename) {
  return filename === DOCTOR_INFO_DOC_FILENAME || filename === DOCTOR_LIST_DOC_FILENAME;
}

function runDoctorScheduleSync(trigger = 'docs update') {
  if (doctorScheduleSyncInProgress) {
    doctorScheduleSyncQueued = true;
    return;
  }

  doctorScheduleSyncInProgress = true;
  const child = spawn(process.execPath, [DOCTOR_SYNC_SCRIPT_PATH], {
    cwd: __dirname,
    stdio: 'ignore',
  });

  child.on('error', (error) => {
    doctorScheduleSyncInProgress = false;
    console.error('[doctor-sync-error]', error);
    refreshRuntimeData(`${trigger} (reload after sync error)`);
    if (doctorScheduleSyncQueued) {
      doctorScheduleSyncQueued = false;
      runDoctorScheduleSync('queued docs update');
    }
  });

  child.on('exit', (code) => {
    doctorScheduleSyncInProgress = false;

    if (code !== 0) {
      console.error(`[doctor-sync-error] exited with code ${code}`);
    }

    refreshRuntimeData(`${trigger}${code === 0 ? '' : ' (reload after sync failure)'}`);
    if (doctorScheduleSyncQueued) {
      doctorScheduleSyncQueued = false;
      runDoctorScheduleSync('queued docs update');
    }
  });
}

function scheduleDocsRefresh(filename = '') {
  if (isDoctorScheduleSourceFile(filename)) {
    pendingDoctorDocsUpdate = true;
  }

  if (docsWatchDebounceTimer) {
    clearTimeout(docsWatchDebounceTimer);
  }

  docsWatchDebounceTimer = setTimeout(() => {
    docsWatchDebounceTimer = null;

    if (pendingDoctorDocsUpdate) {
      pendingDoctorDocsUpdate = false;
      runDoctorScheduleSync(`doctor docs changed: ${filename}`);
      return;
    }

    refreshRuntimeData(`docs changed: ${filename || 'unknown file'}`);
  }, 300);
}

function watchDocsDirectory() {
  if (!fs.existsSync(DOCS_DIR)) {
    return;
  }

  if (IS_RENDER) {
    console.log('[docs-watch] disabled on Render');
    return;
  }

  try {
    docsWatcher = fs.watch(DOCS_DIR, (_eventType, filename) => {
      scheduleDocsRefresh(String(filename || ''));
    });
    docsWatcher.on('error', (error) => {
      console.error('[docs-watch-error]', error);
      if (docsWatcher) {
        docsWatcher.close();
        docsWatcher = null;
      }
    });
  } catch (error) {
    console.error('[docs-watch-error]', error);
  }
}

process.on('uncaughtException', (error) => {
  console.error('[process-uncaught-exception]', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[process-unhandled-rejection]', reason);
});

process.on('SIGTERM', () => {
  console.warn('[process-signal] SIGTERM received');
});

process.on('SIGINT', () => {
  console.warn('[process-signal] SIGINT received');
});

process.on('exit', (code) => {
  console.warn(`[process-exit] code=${code}`);
});

function loadPopularQuestionStats() {
  if (!fs.existsSync(POPULAR_QUESTIONS_PATH)) {
    return new Map();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(POPULAR_QUESTIONS_PATH, 'utf8'));
    const items = Array.isArray(parsed) ? parsed : [];
    const stats = new Map();

    items.forEach((item) => {
      const question = String(item.question || '').trim();
      const normalized = normalizeSearchTextSafe(question);
      const count = Number(item.count) || 0;
      const updatedAt = Number(item.updatedAt) || 0;

      if (!normalized || !question || count <= 0) {
        return;
      }

      stats.set(normalized, {
        question,
        count,
        updatedAt,
      });
    });

    return stats;
  } catch (error) {
    console.error('[popular-questions-load-error]', error);
    return new Map();
  }
}

function savePopularQuestionStats() {
  try {
    const items = [...popularQuestionStats.values()]
      .sort((a, b) => b.count - a.count || b.updatedAt - a.updatedAt)
      .slice(0, 200);
    fs.writeFileSync(POPULAR_QUESTIONS_PATH, JSON.stringify(items, null, 2), 'utf8');
  } catch (error) {
    console.error('[popular-questions-save-error]', error);
  }
}

function createChatLogDatabase() {
  const db = new DatabaseSync(CHAT_LOGS_DB_PATH);

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_logs (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      session_id TEXT,
      question TEXT NOT NULL,
      answer TEXT NOT NULL,
      follow_up TEXT NOT NULL,
      answer_full TEXT NOT NULL,
      type TEXT NOT NULL,
      sources TEXT NOT NULL,
      flag TEXT NOT NULL DEFAULT 'normal',
      note TEXT NOT NULL DEFAULT '',
      reviewed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_chat_logs_timestamp ON chat_logs(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_logs_flag ON chat_logs(flag);
  `);

  migrateChatLogsJsonToSqlite(db);
  trimChatLogs(db);
  return db;
}

function migrateChatLogsJsonToSqlite(db) {
  if (!fs.existsSync(CHAT_LOGS_PATH)) {
    return;
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(CHAT_LOGS_PATH, 'utf8'));
    const items = Array.isArray(parsed) ? parsed : [];
    const insert = db.prepare(`
      INSERT OR IGNORE INTO chat_logs (
        id, timestamp, session_id, question, answer, follow_up, answer_full, type, sources, flag, note, reviewed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    items.forEach((item) => {
      insert.run(
        String(item.id || `migrated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        String(item.timestamp || new Date().toISOString()),
        String(item.sessionId || ''),
        String(item.question || ''),
        String(item.answer || ''),
        JSON.stringify(Array.isArray(item.followUp) ? item.followUp : []),
        String(item.answerFull || item.answer || ''),
        String(item.type || 'unknown'),
        JSON.stringify(Array.isArray(item.sources) ? item.sources : []),
        String(item.flag || 'normal'),
        String(item.note || ''),
        item.reviewedAt ? String(item.reviewedAt) : null
      );
    });

    fs.renameSync(CHAT_LOGS_PATH, `${CHAT_LOGS_PATH}.migrated`);
  } catch (error) {
    console.error('[chat-logs-migrate-error]', error);
  }
}

function trimChatLogs(db) {
  db.prepare(`
    DELETE FROM chat_logs
    WHERE id NOT IN (
      SELECT id FROM chat_logs
      ORDER BY datetime(timestamp) DESC
      LIMIT ?
    )
  `).run(MAX_CHAT_LOG_ENTRIES);
}

function appendChatLog(entry) {
  chatLogDb.prepare(`
    INSERT INTO chat_logs (
      id, timestamp, session_id, question, answer, follow_up, answer_full, type, sources, flag, note, reviewed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    String(entry.id),
    String(entry.timestamp),
    String(entry.sessionId || ''),
    String(entry.question || ''),
    String(entry.answer || ''),
    JSON.stringify(Array.isArray(entry.followUp) ? entry.followUp : []),
    String(entry.answerFull || entry.answer || ''),
    String(entry.type || 'unknown'),
    JSON.stringify(Array.isArray(entry.sources) ? entry.sources : []),
    String(entry.flag || 'normal'),
    String(entry.note || ''),
    entry.reviewedAt ? String(entry.reviewedAt) : null
  );

  trimChatLogs(chatLogDb);
}

function mapChatLogRow(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    timestamp: row.timestamp,
    sessionId: row.session_id || '',
    question: row.question || '',
    answer: row.answer || '',
    followUp: safeJsonParseArray(row.follow_up),
    answerFull: row.answer_full || row.answer || '',
    type: row.type || 'unknown',
    sources: safeJsonParseArray(row.sources),
    flag: row.flag || 'normal',
    note: row.note || '',
    reviewedAt: row.reviewed_at || '',
  };
}

function safeJsonParseArray(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function updateChatLogFlag(logId, flag, note = '') {
  chatLogDb.prepare(`
    UPDATE chat_logs
    SET flag = ?, note = ?, reviewed_at = ?
    WHERE id = ?
  `).run(
    String(flag || 'normal'),
    String(note || '').trim(),
    new Date().toISOString(),
    String(logId)
  );

  return mapChatLogRow(
    chatLogDb.prepare(`SELECT * FROM chat_logs WHERE id = ?`).get(String(logId))
  );
}

function getChatLogsForAdmin(query) {
  const getQueryValue = (key) => (typeof query.get === 'function' ? query.get(key) : query[key]);
  const limit = Math.min(Math.max(Number(getQueryValue('limit')) || 100, 1), 300);
  const search = normalizeSearchTextSafe(getQueryValue('q') || '');
  const flag = String(getQueryValue('flag') || '').trim();

  let sql = 'SELECT * FROM chat_logs';
  const conditions = [];
  const params = [];

  if (flag) {
    conditions.push('flag = ?');
    params.push(flag);
  }

  if (search) {
    conditions.push('(question LIKE ? OR answer LIKE ? OR answer_full LIKE ? OR note LIKE ? OR sources LIKE ?)');
    const likeValue = `%${search}%`;
    params.push(likeValue, likeValue, likeValue, likeValue, likeValue);
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }

  sql += ' ORDER BY datetime(timestamp) DESC LIMIT ?';
  params.push(limit);

  return chatLogDb.prepare(sql).all(...params).map(mapChatLogRow);
}

function getChatLogCount() {
  const row = chatLogDb.prepare('SELECT COUNT(*) AS count FROM chat_logs').get();
  return Number(row?.count || 0);
}

function findDocPathByKeyword(keyword) {
  if (!fs.existsSync(DOCS_DIR)) {
    return '';
  }

  const matchedFile = fs.readdirSync(DOCS_DIR).find((name) => name.includes(keyword));
  return matchedFile ? path.join(DOCS_DIR, matchedFile) : '';
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function isPublicHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function parseCookies(req) {
  const cookieHeader = String(req.headers.cookie || '');
  if (!cookieHeader) {
    return {};
  }

  return cookieHeader.split(';').reduce((result, part) => {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (!rawKey) {
      return result;
    }

    result[rawKey] = decodeURIComponent(rawValue.join('=') || '');
    return result;
  }, {});
}

function isAuthorizedAdminRequest(req) {
  const cookies = parseCookies(req);
  return cookies[ADMIN_SESSION_COOKIE] === ADMIN_SESSION_VALUE;
}

function redirectToAdminLogin(res) {
  res.writeHead(302, {
    Location: '/admin/login',
    'Cache-Control': 'no-store',
  });
  res.end();
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
  };

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentTypes[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store, no-cache, must-revalidate' : 'public, max-age=300',
    });
    res.end(data);
  });
}

function getScore(message, keywords) {
  return keywords.reduce((score, keyword) => (
    message.includes(keyword) ? score + 1 : score
  ), 0);
}

function matchesAnyPattern(message, patterns) {
  return patterns.some((pattern) => pattern.test(message));
}

function normalizeMessageForCache(message) {
  return String(message || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function formatPopularQuestionLabel(question) {
  const value = String(question || '').trim();
  if (!value) {
    return '';
  }

  return value.length > 18 ? `${value.slice(0, 18)}…` : value;
}

function recordPopularQuestion(message) {
  const question = String(message || '').trim();
  const normalized = normalizeSearchTextSafe(question);
  if (!normalized) {
    return;
  }

  const current = popularQuestionStats.get(normalized) || {
    question,
    count: 0,
    updatedAt: 0,
  };

  current.question = question;
  current.count += 1;
  current.updatedAt = Date.now();
  popularQuestionStats.set(normalized, current);
  savePopularQuestionStats();
}

function buildPopularQuestionLabel(question) {
  const value = String(question || '').trim();
  const normalized = normalizeSearchTextSafe(value);
  if (!normalized) {
    return '';
  }

  const stopwords = new Set([
    '나', '저', '좀', '혹시', '관련', '문의', '확인', '부탁', '설명',
    '알려줘', '알려주세요', '말해줘', '말해주세요', '가르쳐줘', '보여줘',
    '가능해', '가능한가요', '가능할까요', '되나요', '되나', '돼', '되요',
    '있어', '있나요', '있을까요', '어떻게', '뭐야', '뭔가요', '궁금해',
    '궁금합니다', '해주세요', '해줘', '주세요',
  ]);
  const simplifiedTokens = tokenizeSafe(normalized)
    .map((token) => token
      .replace(/수술통원기간$/u, '통원기간')
      .replace(/수술입원기간$/u, '입원기간')
      .replace(/진료시간표$/u, '진료시간')
    )
    .filter((token) => token && !stopwords.has(token));
  const uniqueTokens = [...new Set(simplifiedTokens)];

  if (uniqueTokens.length === 0) {
    return value.length > 18 ? `${value.slice(0, 18)}...` : value;
  }

  const label = uniqueTokens.slice(0, 2).join(' ');
  return label.length > 18 ? `${label.slice(0, 18)}...` : label;
}

function getPopularQuestions(limit = POPULAR_QUESTION_LIMIT) {
  const dynamicItems = [...popularQuestionStats.values()]
    .sort((a, b) => (
      b.count - a.count || b.updatedAt - a.updatedAt
    ))
    .slice(0, limit)
    .map((item) => ({
      label: buildPopularQuestionLabel(item.question),
      question: item.question,
      count: item.count,
      source: 'live',
    }));

  if (dynamicItems.length >= limit) {
    return dynamicItems;
  }

  const seen = new Set(dynamicItems.map((item) => normalizeSearchTextSafe(item.question)));
  const fallbackItems = DEFAULT_POPULAR_QUESTIONS
    .filter((item) => !seen.has(normalizeSearchTextSafe(item.question)))
    .slice(0, Math.max(limit - dynamicItems.length, 0))
    .map((item) => ({
      ...item,
      count: 0,
      source: 'default',
    }));

  return [...dynamicItems, ...fallbackItems];
}

function getCachedResponse(message) {
  const key = normalizeMessageForCache(message);
  if (!key) {
    return null;
  }

  const cached = responseCache.get(key);
  if (!cached) {
    return null;
  }

  if (Date.now() - cached.createdAt > RESPONSE_CACHE_TTL_MS) {
    responseCache.delete(key);
    return null;
  }

  return cached.payload;
}

function setCachedResponse(message, payload) {
  const key = normalizeMessageForCache(message);
  if (!key) {
    return;
  }

  if (responseCache.size >= RESPONSE_CACHE_MAX_ENTRIES) {
    const oldestKey = responseCache.keys().next().value;
    if (oldestKey) {
      responseCache.delete(oldestKey);
    }
  }

  responseCache.set(key, {
    createdAt: Date.now(),
    payload,
  });
}

function normalizePublicAssetPath(value) {
  const normalized = String(value || '')
    .replace(/\\/g, '/')
    .trim();

  if (!normalized) {
    return '';
  }

  if (normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return normalized;
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function getClientIp(req) {
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }

  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) {
    return realIp.trim();
  }

  return req.socket?.remoteAddress || 'unknown';
}

function isAllowedRequestOrigin(req) {
  const host = String(req.headers.host || '').trim().toLowerCase();
  if (!host) {
    return false;
  }

  const candidates = [req.headers.origin, req.headers.referer]
    .filter((value) => typeof value === 'string' && value.trim());

  if (candidates.length === 0) {
    return false;
  }

  return candidates.some((value) => {
    try {
      const url = new URL(value);
      return url.host.toLowerCase() === host;
    } catch (error) {
      return false;
    }
  });
}

function hasBrowserLikeUserAgent(req) {
  const userAgent = String(req.headers['user-agent'] || '').toLowerCase();
  if (!userAgent) {
    return false;
  }

  const browserHints = ['mozilla/', 'chrome/', 'safari/', 'edg/', 'firefox/', 'applewebkit/'];
  return browserHints.some((hint) => userAgent.includes(hint));
}

function getRequestGuardResult(req) {
  if (!hasBrowserLikeUserAgent(req)) {
    return {
      allowed: false,
      statusCode: 403,
      detail: 'invalid_user_agent',
      answer: '접근이 제한되었습니다. 브라우저에서 다시 시도해 주세요.',
      followUp: [],
    };
  }

  if (!isAllowedRequestOrigin(req)) {
    return {
      allowed: false,
      statusCode: 403,
      detail: 'invalid_origin',
      answer: '직접 호출은 제한되어 있습니다. 서비스 화면에서 다시 시도해 주세요.',
      followUp: [],
    };
  }

  return { allowed: true };
}

function pruneRateLimitMap(store, windowMs, now) {
  for (const [key, timestamps] of store.entries()) {
    const filtered = timestamps.filter((timestamp) => now - timestamp < windowMs);
    if (filtered.length === 0) {
      store.delete(key);
      continue;
    }

    if (filtered.length !== timestamps.length) {
      store.set(key, filtered);
    }
  }
}

function recordRateLimitHit(store, key, windowMs, limit, now) {
  if (!key) {
    return { allowed: true, remaining: limit };
  }

  const timestamps = (store.get(key) || []).filter((timestamp) => now - timestamp < windowMs);
  if (timestamps.length >= limit) {
    store.set(key, timestamps);
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(windowMs - (now - timestamps[0]), 1000),
    };
  }

  timestamps.push(now);
  store.set(key, timestamps);
  return {
    allowed: true,
    remaining: Math.max(limit - timestamps.length, 0),
  };
}

function getRateLimitResult(req, sessionId) {
  const now = Date.now();
  pruneRateLimitMap(ipRateWindow, RATE_LIMIT_WINDOW_MS, now);
  pruneRateLimitMap(sessionMinuteRateWindow, RATE_LIMIT_WINDOW_MS, now);
  pruneRateLimitMap(sessionDailyRateWindow, RATE_LIMIT_DAILY_WINDOW_MS, now);

  const clientIp = getClientIp(req);
  const ipCheck = recordRateLimitHit(ipRateWindow, clientIp, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_IP_PER_MINUTE, now);
  if (!ipCheck.allowed) {
    return {
      allowed: false,
      statusCode: 429,
      retryAfterMs: ipCheck.retryAfterMs,
      detail: 'ip_minute_limit',
      answer: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.',
      followUp: ['같은 네트워크에서 요청이 많이 발생하면 잠시 제한될 수 있습니다.'],
    };
  }

  if (!sessionId) {
    return { allowed: true };
  }

  const minuteCheck = recordRateLimitHit(
    sessionMinuteRateWindow,
    sessionId,
    RATE_LIMIT_WINDOW_MS,
    RATE_LIMIT_SESSION_PER_MINUTE,
    now
  );
  if (!minuteCheck.allowed) {
    return {
      allowed: false,
      statusCode: 429,
      retryAfterMs: minuteCheck.retryAfterMs,
      detail: 'session_minute_limit',
      answer: '질문이 너무 빠르게 이어지고 있습니다. 1분 정도 후 다시 시도해 주세요.',
      followUp: ['한 세션에서는 1분에 5회까지 질문할 수 있습니다.'],
    };
  }

  const dailyCheck = recordRateLimitHit(
    sessionDailyRateWindow,
    sessionId,
    RATE_LIMIT_DAILY_WINDOW_MS,
    RATE_LIMIT_SESSION_PER_DAY,
    now
  );
  if (!dailyCheck.allowed) {
    return {
      allowed: false,
      statusCode: 429,
      retryAfterMs: dailyCheck.retryAfterMs,
      detail: 'session_daily_limit',
      answer: '오늘 이 대화의 사용 한도에 도달했습니다. 내일 다시 이용해 주세요.',
      followUp: ['한 세션에서는 하루 40회까지 질문할 수 있습니다.'],
    };
  }

  return { allowed: true };
}

function resolvePublicImagePath(value) {
  const normalized = normalizePublicAssetPath(value);

  if (!normalized || normalized.startsWith('http://') || normalized.startsWith('https://')) {
    return normalized;
  }

  let decodedPath = normalized;
  try {
    decodedPath = decodeURIComponent(normalized);
  } catch (error) {
    decodedPath = normalized;
  }

  const relativePath = decodedPath.replace(/^\/+/, '').split('/').join(path.sep);
  const absolutePath = path.join(PUBLIC_DIR, relativePath);

  if (fs.existsSync(absolutePath)) {
    return normalized;
  }

  const parsed = path.parse(absolutePath);
  if (!fs.existsSync(parsed.dir)) {
    return '';
  }

  const matchedFile = fs.readdirSync(parsed.dir).find((name) => path.parse(name).name === parsed.name);
  if (!matchedFile) {
    return '';
  }

  const resolvedRelativePath = path.relative(PUBLIC_DIR, path.join(parsed.dir, matchedFile)).split(path.sep).join('/');
  return `/${resolvedRelativePath}`;
}

function loadYoutubeLinks() {
  if (!fs.existsSync(YOUTUBE_LINKS_PATH)) {
    return [];
  }

  const lines = fs.readFileSync(YOUTUBE_LINKS_PATH, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim());
  const results = [];

  for (let index = 0; index < lines.length; index += 1) {
    const topic = lines[index];

    if (!topic || /^https?:\/\//i.test(topic)) {
      continue;
    }

    const url = lines[index + 1];
    if (!url || !/^https?:\/\//i.test(url)) {
      continue;
    }

    results.push({
      topic,
      url,
      normalizedTopic: normalizeSearchTextSafe(topic),
      compactTopic: compactSearchTextSafe(topic),
    });
    index += 1;
  }

  return results;
}

function findRelevantYoutubeLink(question, answer = '') {
  const normalizedQuestion = normalizeSearchTextSafe(question);
  const compactQuestion = compactSearchTextSafe(question);
  const normalizedAnswer = normalizeSearchTextSafe(answer);
  const compactAnswer = compactSearchTextSafe(answer);

  return runtimeData.youtubeLinks.find((item) => (
    (item.normalizedTopic && normalizedQuestion.includes(item.normalizedTopic))
    || (item.compactTopic && compactQuestion.includes(item.compactTopic))
    || (item.normalizedTopic && normalizedAnswer.includes(item.normalizedTopic))
    || (item.compactTopic && compactAnswer.includes(item.compactTopic))
  )) || null;
}

function appendSupportLinks(answer, question) {
  let result = String(answer || '').trim();

  if (!result) {
    return result;
  }

  const youtubeLink = findRelevantYoutubeLink(question, result);
  if (youtubeLink && !result.includes(youtubeLink.url)) {
    result = `${result}\n\n${youtubeLink.topic} 관련 영상 보기: ${youtubeLink.url}`;
  }

  return result.replace(/(?:대표전화\s*)?02-6925-1111/g, '대표전화 02-6925-1111');
}

function enrichResponsePayload(payload, question) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  return {
    ...payload,
    answer: appendSupportLinks(payload.answer, question),
  };
}

function scoreImageGuide(guide, normalizedQuestion, compactQuestion, contextDocs) {
  const keywords = Array.isArray(guide.keywords) ? guide.keywords : [];
  const docHints = Array.isArray(guide.docHints) ? guide.docHints : [];
  const normalizedDocTitles = contextDocs.map((doc) => normalizeSearchTextSafe(`${doc.title} ${doc.sourceTitle || ''}`));
  const compactDocTitles = normalizedDocTitles.map((title) => title.replace(/\s+/g, ''));

  const keywordScore = keywords.reduce((score, keyword) => {
    const normalizedKeyword = normalizeSearchTextSafe(keyword);
    const compactKeyword = normalizedKeyword.replace(/\s+/g, '');

    if (!normalizedKeyword) {
      return score;
    }

    if (normalizedQuestion.includes(normalizedKeyword) || compactQuestion.includes(compactKeyword)) {
      return score + 6;
    }

    return score;
  }, 0);

  const docHintScore = docHints.reduce((score, hint) => {
    const normalizedHint = normalizeSearchTextSafe(hint);
    const compactHint = normalizedHint.replace(/\s+/g, '');

    if (!normalizedHint) {
      return score;
    }

    const matched = normalizedDocTitles.some((title, index) => (
      title.includes(normalizedHint) || compactDocTitles[index].includes(compactHint)
    ));

    return matched ? score + 4 : score;
  }, 0);

  return keywordScore + docHintScore;
}

function findRelevantImages(message, contextDocs = []) {
  const normalizedQuestion = normalizeSearchTextSafe(message);
  const compactQuestion = compactSearchTextSafe(message);

  if (!normalizedQuestion || imageGuides.length === 0) {
    return [];
  }

  return imageGuides
    .map((guide) => ({
      title: guide.title || '안내 이미지',
      description: guide.description || '',
      url: resolvePublicImagePath(guide.path),
      score: scoreImageGuide(guide, normalizedQuestion, compactQuestion, contextDocs),
    }))
    .filter((guide) => guide.url && guide.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(({ title, description, url }) => ({ title, description, url }));
}

function findDirectFaqMatch(message) {
  const normalizedMessage = normalizeSearchTextSafe(message);
  const compactMessage = compactSearchTextSafe(message);
  const expandedSearchState = buildExpandedSearchState(message);
  const expandedNormalizedVariants = expandedSearchState.normalizedVariants;
  const expandedCompactVariants = expandedSearchState.compactVariants;
  const tokens = expandedSearchState.tokens;
  const isConversationalQuestion = (
    normalizedMessage.length >= 14
    || tokens.length >= 4
    || /[?？]$/.test(String(message || '').trim())
    || /(했는데|인데|같아|같은데|하려고|되나요|되나요|어떻게|어떡해|가능할까요|될까요|해도 되나요)/u.test(message)
  );

  const rankedEntries = runtimeData.faqEntries
    .map((entry) => {
      let exactKeywordMatch = false;

      const keywordScore = (entry.keywords || []).reduce((score, keyword) => {
        const normalizedKeyword = normalizeSearchTextSafe(keyword);
        const compactKeyword = compactSearchTextSafe(keyword);
        const keywordTokens = tokenizeSafe(normalizedKeyword);

        if (!normalizedKeyword) {
          return score;
        }

        let nextScore = score;

        const isExactAliasMatch = expandedNormalizedVariants.includes(normalizedKeyword)
          || expandedCompactVariants.includes(compactKeyword);

        if (normalizedMessage === normalizedKeyword || compactMessage === compactKeyword || isExactAliasMatch) {
          nextScore += 20;
          exactKeywordMatch = true;
        } else if (
          normalizedMessage.includes(normalizedKeyword)
          || compactMessage.includes(compactKeyword)
          || expandedNormalizedVariants.some((variant) => variant.includes(normalizedKeyword))
          || expandedCompactVariants.some((variant) => variant.includes(compactKeyword))
          || normalizedKeyword.includes(normalizedMessage)
        ) {
          nextScore += 12;
        }

        const keywordTokenScore = keywordTokens.reduce((tokenScore, token) => (
          tokens.includes(token) ? tokenScore + 3 : tokenScore
        ), 0);

        return nextScore + keywordTokenScore;
      }, 0);

      const answerText = normalizeSearchTextSafe(`${entry.answer} ${(entry.followUp || []).join(' ')}`);
      const tokenScore = tokens.reduce((score, token) => (
        answerText.includes(token) ? score + 1 : score
      ), 0);

      return {
        entry,
        score: keywordScore + tokenScore,
        exactKeywordMatch,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (rankedEntries.length === 0) {
    return null;
  }

  const [bestMatch, secondMatch] = rankedEntries;
  const scoreGap = secondMatch ? bestMatch.score - secondMatch.score : bestMatch.score;
  const hasClearLead = !secondMatch || scoreGap >= 3;
  const isStrongMatch = bestMatch.score >= 12 || (bestMatch.score >= 8 && hasClearLead);

  if (!isStrongMatch) {
    return null;
  }

  if (!bestMatch.exactKeywordMatch && scoreGap < 4) {
    return null;
  }

  if (isConversationalQuestion && !bestMatch.exactKeywordMatch) {
    const conversationalStrongMatch = bestMatch.score >= 15 && scoreGap >= 5;
    if (!conversationalStrongMatch) {
      return null;
    }
  }

  const sourceInfo = getFaqSourceInfo(bestMatch.entry);
  return {
    type: 'faq',
    answer: bestMatch.entry.answer,
    followUp: bestMatch.entry.followUp || [],
    sources: [{
      title: sourceInfo.title,
      url: sourceInfo.url,
    }],
  };
}

function createRestrictedMedicalResponse() {
  return {
    type: 'restricted',
    answer: '이 상담봇은 진단, 처방 변경, 약 복용 중단 여부를 판단하지 않습니다. 증상이나 약 관련 질문은 진료과 또는 상담 직원에게 연결해 주세요.',
    followUp: [
      '대표전화 02-6925-1111',
      '모바일 또는 전화로 진료 예약',
      '증상이 급하면 가까운 응급실 또는 119 이용',
    ],
  };
}

function createEmergencyResponse() {
  return {
    type: 'emergency',
    answer: '응급 상황이 의심됩니다. 이 상담봇으로 지연하지 말고 즉시 119 또는 가까운 응급실로 연락해 주세요.',
    followUp: [
      '의식 저하, 호흡곤란, 심한 출혈은 즉시 응급실 권고',
      '대표전화 02-6925-1111',
      '야간에는 응급 대응 체계로 연결 필요',
    ],
  };
}

function createPersonalInfoWarningResponse() {
  return {
    type: 'privacy_warning',
    answer: '개인정보나 민감한 건강정보는 입력하지 말아 주세요. 주민등록번호, 전화번호, 이메일, 상세 주소 같은 정보 없이 질문해 주세요.',
    followUp: [
      '예: 진단서 비용, 예약 변경 방법, 진료시간처럼 개인정보 없이 질문해 주세요.',
      '이미 입력한 개인정보가 있다면 다시 적지 말고 일반적인 표현으로 바꿔 질문해 주세요.',
    ],
  };
}

function createWelcomeResponse() {
  return {
    type: 'welcome',
    answer: '안녕하세요. 하나이비인후과병원 AI 상담봇입니다. 병원 홈페이지 내용을 바탕으로 예약, 진료시간, 의료진, 입원, 서류 발급 등을 대화형으로 안내합니다.',
    followUp: [
      '진료의사 알려줘',
      '동헌종 원장 진료시간 알려줘',
      '입원 절차 알려줘',
    ],
  };
}

function createApiKeyMissingResponse() {
  return {
    type: 'config_error',
    answer: '현재 OpenAI API 키가 설정되지 않아 AI 대화형 답변을 할 수 없습니다. PowerShell에서 OPENAI_API_KEY를 설정한 뒤 서버를 다시 실행해 주세요.',
    followUp: [
      '$env:OPENAI_API_KEY="발급받은키"',
      'node .\\server.js',
      '대표전화 02-6925-1111',
    ],
  };
}

function createLateArrivalResponse() {
  return {
    type: 'late_arrival',
    answer: '예약 후 늦게 도착할 것 같으면 대표전화 02-6925-1111로 먼저 연락해 상담원에게 상황을 알려 주세요. 문서 기준으로 도착 예정 시간과 외래 대기 상황에 따라 방문 접수로 안내되거나 예약 가능 여부를 다시 확인해 안내할 수 있습니다.',
    followUp: [
      '1시간 이내 도착 가능하면 방문 접수로 안내될 수 있습니다.',
      '1시간 이상 늦어질 것 같으면 전화로 예약 가능 여부를 먼저 확인하는 편이 안전합니다.',
      '대표전화: 02-6925-1111',
    ],
  };
}

function createInpatientMealPolicyResponse() {
  return {
    type: 'inpatient_meal_policy',
    answer: '입원생활 안내문 기준으로 원내 전자레인지는 비치되어 있지 않으며, 취사와 배달음식은 금지입니다.',
    followUp: [
      '식사시간은 조식 8시, 중식 12시, 석식 오후 5시 30분으로 안내되어 있습니다.',
      '세부 안내는 병동 간호사실이나 대표전화 02-6925-1111로 확인할 수 있습니다.',
    ],
    sources: [{
      title: '입원-입원생활안내문',
      url: 'local://docs/%EC%9E%85%EC%9B%90-%EC%9E%85%EC%9B%90%EC%83%9D%ED%99%9C%EC%95%88%EB%82%B4%EB%AC%B8.txt',
    }],
  };
}

function createRhinitisPostOpVisitResponse() {
  return {
    type: 'rhinitis_postop_visit',
    answer: '문서 기준으로 비염 수술 후 내원치료는 보통 8~12회로 안내되어 있습니다.',
    followUp: [
      '회복기간은 3~4주로 안내되어 있습니다.',
      '세부 내원 횟수와 일정은 수술 방식과 경과에 따라 달라질 수 있어 진료 시 최종 안내를 받는 것이 안전합니다.',
    ],
    sources: [{
      title: '비염 수술',
      url: 'https://hanaent.co.kr/nose/nose05.html?type=A&sub_tp=3',
    }],
  };
}

function createFallbackResponse(contextTitles) {
  return {
    type: 'fallback',
    answer: '홈페이지에서 확인한 범위 안에서 바로 답하기 어려운 질문입니다. 더 구체적으로 질문하시거나 대표전화 02-6925-1111로 문의해 주세요.',
    followUp: contextTitles.length > 0 ? contextTitles : ['진료시간 안내', '의료진 일정', '서류 발급 안내'],
  };
}

function getSmallTalkIntent(message) {
  const normalized = normalizeSearchTextSafe(message);
  const compact = compactSearchTextSafe(message);

  if (!normalized) {
    return null;
  }

  if (
    ['안녕하세요', '안녕', '반가워요', '반갑습니다', '처음 왔어요'].includes(normalized)
    || compact === '안녕하세요'
    || compact === '안녕'
  ) {
    return 'greeting';
  }

  if (
    ['고마워', '고마워요', '감사합니다', '감사해요', 'thanks', 'thank you'].includes(normalized)
    || compact === '감사합니다'
  ) {
    return 'thanks';
  }

  if (
    ['잘 있어', 'bye', 'goodbye', '종료', '끝', '그만', '수고하세요'].includes(normalized)
    || compact === '수고하세요'
  ) {
    return 'closing';
  }

  return null;
}

function createSmallTalkResponse(intent) {
  if (intent === 'greeting') {
    return {
      type: 'smalltalk',
      answer: '안녕하세요. 하나이비인후과병원 상담 도우미입니다. 예약, 진료시간, 의료진, 입원, 셔틀버스 같은 병원 안내를 편하게 물어보시면 됩니다.',
      followUp: ['진료시간 알려줘', '셔틀버스 시간표 알려줘', '입원 안내 알려줘'],
    };
  }

  if (intent === 'thanks') {
    return {
      type: 'smalltalk',
      answer: '네, 필요하신 내용 있으면 이어서 말씀해 주세요. 병원 안내 관련 질문이면 바로 도와드리겠습니다.',
      followUp: [],
    };
  }

  if (intent === 'closing') {
    return {
      type: 'smalltalk',
      answer: '네, 필요하실 때 다시 말씀해 주세요. 급한 문의는 대표전화 02-6925-1111로 바로 연락하셔도 됩니다.',
      followUp: [],
    };
  }

  return null;
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripHtml(html) {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|section|article|h1|h2|h3|h4)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\r/g, ' ')
      .replace(/\t/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .replace(/[ ]{2,}/g, ' ')
      .trim()
  );
}

function splitIntoChunks(text, maxLength = 900) {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const chunks = [];
  let current = '';

  for (const line of lines) {
    if ((current + ' ' + line).trim().length > maxLength) {
      if (current) {
        chunks.push(current.trim());
      }
      current = line;
    } else {
      current = `${current} ${line}`.trim();
    }
  }

  if (current) {
    chunks.push(current.trim());
  }

  return chunks;
}

function normalizeUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    if (url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1) || '/';
    }
    return url.toString();
  } catch (error) {
    return null;
  }
}

function extractLinks(html, baseUrl) {
  const links = new Set();
  const hrefRegex = /href\s*=\s*["']([^"'#]+)["']/gi;
  let match;

  while ((match = hrefRegex.exec(html)) !== null) {
    try {
      const absolute = new URL(match[1], baseUrl);
      const normalized = normalizeUrl(absolute.toString());
      if (normalized) {
        links.add(normalized);
      }
    } catch (error) {
      continue;
    }
  }

  return [...links];
}

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^0-9a-zA-Z가-힣\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length >= 2);
}

function normalizeSearchText(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^0-9a-zA-Z가-힣]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactSearchText(text) {
  return normalizeSearchText(text).replace(/\s+/g, '');
}

function tokenize(text) {
  return normalizeSearchText(text)
    .split(' ')
    .filter((token) => token.length >= 2);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'PatientAIBot/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeSearchTextSafe(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactSearchTextSafe(text) {
  return normalizeSearchTextSafe(text).replace(/\s+/g, '');
}

function tokenizeSafe(text) {
  return normalizeSearchTextSafe(text)
    .split(' ')
    .filter((token) => token.length >= 2);
}

const searchAliasGroups = [
  ['비염', '만성비염', '알레르기비염', '비후성비염'],
  ['축농증', '부비동염', '만성부비동염'],
  ['코막힘', '비염', '비후성비염'],
  ['코물혹', '비용종', '비강용종', '비폴립'],
];

function expandSearchAliases(text) {
  const normalized = normalizeSearchTextSafe(text);
  const expanded = new Set([normalized]);

  searchAliasGroups.forEach((group) => {
    const matched = group.some((term) => normalized.includes(normalizeSearchTextSafe(term)));
    if (!matched) {
      return;
    }

    group.forEach((term) => {
      expanded.add(normalizeSearchTextSafe(term));
    });
  });

  return [...expanded].filter(Boolean);
}

function buildExpandedSearchState(text) {
  const normalizedVariants = expandSearchAliases(text);
  const compactVariants = normalizedVariants.map((value) => compactSearchTextSafe(value));
  const tokenSet = new Set();

  normalizedVariants.forEach((value) => {
    tokenizeSafe(value).forEach((token) => {
      tokenSet.add(token);
    });
  });

  return {
    normalizedVariants,
    compactVariants,
    tokens: [...tokenSet],
  };
}

function extractPriceText(line) {
  const amountMatches = String(line || '').match(/\d{1,3}(?:,\d{3})+/g) || [];
  return amountMatches[0] || '';
}

function buildCertificateFeeEntries() {
  if (!CERTIFICATE_FEES_DOC_PATH || !fs.existsSync(CERTIFICATE_FEES_DOC_PATH)) {
    return [];
  }

  const rawLines = fs.readFileSync(CERTIFICATE_FEES_DOC_PATH, 'utf8')
    .split(/\r?\n/)
    .map((line) => String(line || '').replace(/\r/g, '').trim())
    .filter(Boolean);

  const feeConfigs = [
    {
      key: 'diagnosis',
      title: '진단서',
      requiredTerms: ['진단서', 'pdz01'],
    },
    {
      key: 'diagnosis_reissue',
      title: '진단서 재발급',
      requiredTerms: ['진단서', 'pdz16'],
    },
    {
      key: 'surgery_confirmation',
      title: '수술확인서',
      requiredTerms: ['수술확인서', '상병', '수술코드'],
    },
    {
      key: 'surgery_confirmation_reissue',
      title: '수술확인서 재발급',
      requiredTerms: ['수술확인서', '재발급'],
    },
    {
      key: 'admission_discharge',
      title: '입퇴원확인서',
      requiredTerms: ['입퇴원확인서', 'pdz09'],
    },
    {
      key: 'admission_discharge_reissue',
      title: '입퇴원확인서 재발급',
      requiredTerms: ['입퇴원확인서', '재발행'],
    },
  ];

  return feeConfigs.map((config) => {
    const matchedLine = rawLines.find((line) => {
      const normalizedLine = compactSearchTextSafe(line);
      return config.requiredTerms.every((term) => normalizedLine.includes(compactSearchTextSafe(term)));
    });

    if (!matchedLine) {
      return null;
    }

    return {
      ...config,
      price: extractPriceText(matchedLine),
    };
  }).filter((entry) => entry && entry.price);
}

function buildFloorGuideIndex() {
  const index = {
    byRoomNumber: new Map(),
  };

  if (!fs.existsSync(FLOOR_GUIDE_DOC_PATH)) {
    return index;
  }

  const lines = fs.readFileSync(FLOOR_GUIDE_DOC_PATH, 'utf8')
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter(Boolean);

  lines.forEach((line) => {
    const floorMatch = line.match(/(\d)\s*층/);
    if (!floorMatch) {
      return;
    }

    const floor = Number(floorMatch[1]);
    const rangeRegex = /(\d+)\s*~\s*(\d+)\s*진료실/g;
    let rangeMatch = rangeRegex.exec(line);

    while (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      for (let roomNumber = start; roomNumber <= end; roomNumber += 1) {
        index.byRoomNumber.set(roomNumber, {
          floor,
          line,
        });
      }
      rangeMatch = rangeRegex.exec(line);
    }

    const singleRoomRegex = /(\d+)\s*진료실/g;
    let singleRoomMatch = singleRoomRegex.exec(line);
    while (singleRoomMatch) {
      const roomNumber = Number(singleRoomMatch[1]);
      if (!index.byRoomNumber.has(roomNumber)) {
        index.byRoomNumber.set(roomNumber, {
          floor,
          line,
        });
      }
      singleRoomMatch = singleRoomRegex.exec(line);
    }
  });

  return index;
}

function findFloorGuideResponse(message) {
  if (!matchesAnyPattern(message, floorGuidePatterns)) {
    return null;
  }

  const roomMatch = String(message || '').match(/(\d+)\s*번?\s*진료실/u);
  if (!roomMatch) {
    return null;
  }

  const roomNumber = Number(roomMatch[1]);
  const floorInfo = runtimeData.floorGuideIndex.byRoomNumber.get(roomNumber);
  if (!floorInfo) {
    return null;
  }

  const department = floorInfo.floor === 2
    ? '이비인후과 진료실(1~6진료실)'
    : (floorInfo.floor === 1 ? '이비인후과 진료실(7~8진료실)' : '진료실');

  return {
    type: 'floor_guide',
    answer: `${roomNumber}번 진료실은 ${floorInfo.floor}층입니다. 층별안내도 기준으로 ${department}에 해당합니다.`,
    followUp: [
      '정확한 위치가 헷갈리면 1층 또는 해당 층 안내 데스크에서 다시 안내받으시면 됩니다.',
    ],
    sources: [{
      title: '기타-층별안내도',
      url: `local://docs/${encodeURIComponent(path.basename(FLOOR_GUIDE_DOC_PATH))}`,
    }],
  };
}

function findCertificateFeeResponse(message) {
  const normalizedMessage = normalizeSearchTextSafe(message);
  if (!normalizedMessage) {
    return null;
  }

  if (!/(비용|금액|수수료|가격|얼마)/u.test(message)) {
    return null;
  }

  const wantsReissue = /(재발급|재발행|사본)/u.test(message);
  const targets = [
    {
      baseKey: 'diagnosis',
      reissueKey: 'diagnosis_reissue',
      aliases: ['진단서'],
    },
    {
      baseKey: 'surgery_confirmation',
      reissueKey: 'surgery_confirmation_reissue',
      aliases: ['수술확인서', '수술 확인서'],
    },
    {
      baseKey: 'admission_discharge',
      reissueKey: 'admission_discharge_reissue',
      aliases: ['입퇴원확인서', '입원확인서', '퇴원확인서'],
    },
  ];

  const matchedTarget = targets.find((target) => (
    target.aliases.some((alias) => normalizedMessage.includes(normalizeSearchTextSafe(alias)))
  ));

  if (!matchedTarget) {
    return null;
  }

  const entryKey = wantsReissue ? matchedTarget.reissueKey : matchedTarget.baseKey;
  const matchedEntry = runtimeData.certificateFeeEntries.find((entry) => entry.key === entryKey);
  if (!matchedEntry) {
    return null;
  }

  return {
    type: 'certificate_fee',
    answer: `${matchedEntry.title} 비용은 ${matchedEntry.price}원입니다.`,
    followUp: [
      '기준 문서: 기타-비급여비용.txt',
      wantsReissue ? '재발급 또는 재발행 기준 금액으로 안내했습니다.' : '발급 기준 금액으로 안내했습니다.',
      '세부 기준은 원무과 또는 대표전화 02-6925-1111로 다시 확인해 주세요.',
    ],
    sources: [{
      title: '기타-비급여비용',
      url: `local://docs/${encodeURIComponent(path.basename(CERTIFICATE_FEES_DOC_PATH || '기타-비급여비용.txt'))}`,
    }],
  };
}

function buildFaqDocuments(entries) {
  return entries.map((entry) => {
    const sourceInfo = getFaqSourceInfo(entry);

    return {
      title: `FAQ - ${entry.category}`,
      url: sourceInfo.url,
      sourceTitle: sourceInfo.title,
      text: `${entry.answer}\n${entry.followUp.join('\n')}`,
      keywords: entry.keywords,
      sourceType: 'official',
    };
  });
}

function readLocalDocumentText(filePath, extension) {
  if (extension === '.txt') {
    return fs.readFileSync(filePath, 'utf8');
  }

  if (extension === '.xls' || extension === '.xlsx') {
    const workbook = XLSX.readFile(filePath);
    const sheetTexts = workbook.SheetNames.map((sheetName) => {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
      const body = rows
        .map((row) => row.map((cell) => String(cell || '').trim()).filter(Boolean).join(' | '))
        .filter(Boolean)
        .join('\n');

      return body ? `${sheetName}\n${body}` : '';
    }).filter(Boolean);

    return sheetTexts.join('\n\n');
  }

  return '';
}

function buildLocalDocuments() {
  if (!fs.existsSync(DOCS_DIR)) {
    return [];
  }

  const supportedExtensions = new Set(['.txt', '.xls', '.xlsx']);
  const files = fs.readdirSync(DOCS_DIR, { withFileTypes: true });
  const docs = [];

  for (const file of files) {
    if (!file.isFile()) {
      continue;
    }

    const extension = path.extname(file.name).toLowerCase();
    if (!supportedExtensions.has(extension)) {
      continue;
    }

    const filePath = path.join(DOCS_DIR, file.name);
    const fileStem = path.parse(file.name).name.replace(/\s+/g, ' ').trim();
    const rawText = readLocalDocumentText(filePath, extension);
    const text = String(rawText || '')
      .replace(/\r/g, '')
      .replace(/\t/g, ' ')
      .replace(/\n\s*\n+/g, '\n')
      .trim();

    if (!text) {
      continue;
    }

    const chunks = splitIntoChunks(text, 700);
    const keywords = [...new Set(tokenizeSafe(`${fileStem} ${text}`))].slice(0, 120);

    chunks.forEach((chunk, index) => {
      docs.push({
        title: '내부 문서',
        sourceTitle: '내부 문서',
        url: '',
        text: chunk,
        keywords,
        sourceType: 'local',
        hiddenSource: true,
        chunkLabel: `${file.name}${chunks.length > 1 ? ` #${index + 1}` : ''}`,
      });
      const lastDoc = docs[docs.length - 1];
      lastDoc.title = `Local doc - ${fileStem}`;
      lastDoc.sourceTitle = fileStem;
      lastDoc.url = `local://docs/${encodeURIComponent(file.name)}`;
      lastDoc.hiddenSource = false;
    });
  }

  docs.forEach((doc) => {
    const label = String(doc.chunkLabel || '').split(' #')[0];
    const fileStem = path.parse(label).name.replace(/\s+/g, ' ').trim();

    doc.title = `로컬 문서 - ${fileStem}`;
    doc.sourceTitle = fileStem;
    doc.url = `local://docs/${encodeURIComponent(label)}`;
    doc.hiddenSource = false;
  });

  docs.forEach((doc) => {
    const label = String(doc.chunkLabel || '').split(' #')[0];
    const fileStem = path.parse(label).name.replace(/\s+/g, ' ').trim();
    doc.title = `Local doc - ${fileStem}`;
  });

  return docs;
}

function extractHomepageDiseaseName(sourceTitle) {
  const value = String(sourceTitle || '').trim();
  if (!value.startsWith('홈페이지-')) {
    return '';
  }

  const diseaseName = value.replace(/^홈페이지-/, '').trim();
  const excludedTitles = new Set([
    '셔틀버스 및 오시는길',
    '외래진료안내',
    '의료진 정보',
    '입퇴원 안내',
  ]);

  if (!diseaseName || excludedTitles.has(diseaseName)) {
    return '';
  }

  return diseaseName;
}

function buildHomepageDiseaseTerms(docs) {
  const terms = new Set();

  (docs || []).forEach((doc) => {
    const diseaseName = extractHomepageDiseaseName(doc.sourceTitle || doc.title);
    if (!diseaseName) {
      return;
    }

    expandSearchAliases(diseaseName).forEach((term) => {
      if (term) {
        terms.add(term);
      }
    });
  });

  return [...terms];
}

function getMatchedHomepageDiseaseTerms(question) {
  const expandedState = buildExpandedSearchState(question);

  return runtimeData.homepageDiseaseTerms.filter((term) => (
    expandedState.normalizedVariants.some((variant) => (
      variant.includes(term) || term.includes(variant)
    ))
  ));
}

runtimeData = createRuntimeData();

function getFaqSourceInfo(entry) {
  const categoryHint = faqCategoryUrlHints[entry.category];
  if (categoryHint) {
    const matchedSource = siteSources.find((source) => (
      source.type === 'official' && String(source.url || '').includes(categoryHint)
    ));
    if (matchedSource?.url) {
      return {
        title: matchedSource.title || matchedSource.url,
        url: matchedSource.url,
      };
    }
  }

  const keywordMatchedSource = siteSources.find((source) => {
    if (source.type !== 'official') {
      return false;
    }

    const sourceKeywords = source.keywords || [];
    const entryKeywords = entry.keywords || [];
    return entryKeywords.some((keyword) => sourceKeywords.includes(keyword));
  });

  if (keywordMatchedSource?.url) {
    return {
      title: keywordMatchedSource.title || keywordMatchedSource.url,
      url: keywordMatchedSource.url,
    };
  }

  return {
    title: 'FAQ',
    url: LOCAL_FAQ_URL,
  };
}

function resolvePublicSourceForDoc(doc) {
  if (isPublicHttpUrl(doc.url)) {
    return {
      title: doc.sourceTitle || doc.title,
      url: doc.url,
    };
  }

  const sourceTitle = String(doc.sourceTitle || doc.title || '').trim();
  const normalizedTitle = normalizeSearchTextSafe(sourceTitle.replace(/^홈페이지-/, ''));
  if (!normalizedTitle) {
    return null;
  }

  const matchedOfficialSource = siteSources.find((source) => {
    if (source.type !== 'official' || !isPublicHttpUrl(source.url)) {
      return false;
    }

    const normalizedSourceTitle = normalizeSearchTextSafe(source.title || '');
    if (
      normalizedSourceTitle.includes(normalizedTitle)
      || normalizedTitle.includes(normalizedSourceTitle)
    ) {
      return true;
    }

    return (source.keywords || []).some((keyword) => {
      const normalizedKeyword = normalizeSearchTextSafe(keyword);
      return normalizedKeyword && (
        normalizedTitle.includes(normalizedKeyword)
        || normalizedKeyword.includes(normalizedTitle)
      );
    });
  });

  if (!matchedOfficialSource) {
    return null;
  }

  return {
    title: matchedOfficialSource.title || sourceTitle,
    url: matchedOfficialSource.url,
  };
}

function extractPageTitle(html, fallbackTitle) {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch) {
    return fallbackTitle;
  }

  const title = stripHtml(titleMatch[1]).trim();
  return title || fallbackTitle;
}

function isAllowedOfficialUrl(urlString) {
  try {
    const url = new URL(urlString);
    if (!allowedHostnames.includes(url.hostname)) {
      return false;
    }

    const excludedPatterns = [
      '/member/',
      '/login',
      '/join',
      '/privacy',
      '/policy',
      '/admin',
      '.jpg',
      '.png',
      '.gif',
      '.pdf',
      '.zip',
      'javascript:',
      'mailto:',
    ];

    return !excludedPatterns.some((pattern) => urlString.includes(pattern));
  } catch (error) {
    return false;
  }
}

async function loadTrustedExternalDocuments() {
  const externalSources = siteSources.filter((source) => source.type === 'external');
  const tasks = externalSources.map(async (source) => {
    try {
      const html = await fetchText(source.url);
      const text = stripHtml(html);
      const chunks = splitIntoChunks(text);

      return chunks.map((chunk, index) => ({
        title: `${source.title}${chunks.length > 1 ? ` #${index + 1}` : ''}`,
        url: source.url,
        text: chunk,
        keywords: source.keywords || [],
        sourceType: source.type || 'external',
      }));
    } catch (error) {
      return [{
        title: `${source.title} (로드 실패)`,
        url: source.url,
        text: '',
        keywords: source.keywords || [],
      }];
    }
  });

  return (await Promise.all(tasks)).flat().filter((doc) => doc.text);
}

async function crawlOfficialSite() {
  const seedSources = siteSources.filter((source) => source.type === 'official');
  const queue = seedSources.map((source) => ({
    url: normalizeUrl(source.url),
    title: source.title,
    keywords: source.keywords || [],
  })).filter((item) => item.url);

  const visited = new Set();
  const docs = [];
  const maxPages = 18;

  while (queue.length > 0 && visited.size < maxPages) {
    const current = queue.shift();
    if (!current || visited.has(current.url) || !isAllowedOfficialUrl(current.url)) {
      continue;
    }

    visited.add(current.url);

    try {
      const html = await fetchText(current.url);
      const pageTitle = extractPageTitle(html, current.title || current.url);
      const text = stripHtml(html);
      const chunks = splitIntoChunks(text);

      chunks.forEach((chunk, index) => {
        docs.push({
          title: `${pageTitle}${chunks.length > 1 ? ` #${index + 1}` : ''}`,
          url: current.url,
          text: chunk,
          keywords: current.keywords || [],
          sourceType: 'official',
        });
      });

      const links = extractLinks(html, current.url);
      for (const link of links) {
        if (!visited.has(link) && isAllowedOfficialUrl(link)) {
          queue.push({
            url: link,
            title: pageTitle,
            keywords: current.keywords || [],
          });
        }
      }
    } catch (error) {
      continue;
    }
  }

  return docs;
}

async function getKnowledgeDocuments() {
  const maxAgeMs = 6 * 60 * 60 * 1000;
  const now = Date.now();

  if (documentCache.docs.length > 0 && now - documentCache.loadedAt < maxAgeMs) {
    return documentCache.docs;
  }

  if (!documentCache.pendingPromise) {
    documentCache.pendingPromise = (async () => {
      const docs = [
        ...runtimeData.faqDocuments,
        ...runtimeData.localDocuments,
        ...(await crawlOfficialSite()),
        ...(await loadTrustedExternalDocuments()),
      ];

      documentCache.docs = docs;
      documentCache.loadedAt = Date.now();
      documentCache.pendingPromise = null;
      return docs;
    })().catch((error) => {
      documentCache.pendingPromise = null;
      if (documentCache.docs.length > 0) {
        return documentCache.docs;
      }
      throw error;
    });
  }

  return documentCache.pendingPromise;
}

async function getDocumentsForRequest() {
  const maxAgeMs = 6 * 60 * 60 * 1000;
  const now = Date.now();

  if (documentCache.docs.length > 0 && now - documentCache.loadedAt < maxAgeMs) {
    return documentCache.docs;
  }

  warmupKnowledgeDocuments();
  return [...runtimeData.faqDocuments, ...runtimeData.localDocuments];
}

function warmupKnowledgeDocuments() {
  if (warmupStarted) {
    return;
  }

  warmupStarted = true;
  getKnowledgeDocuments().catch((error) => {
    console.error('[warmup-error]', error);
    warmupStarted = false;
  });
}

function rankDocuments(question, docs, limit = 7) {
  const expandedSearchState = buildExpandedSearchState(question);
  const matchedDiseaseTerms = getMatchedHomepageDiseaseTerms(question);
  const normalizedQuestion = normalizeSearchTextSafe(question);
  const compactQuestion = compactSearchTextSafe(question);
  const tokens = expandedSearchState.tokens;
  const normalizedQuestionVariants = expandedSearchState.normalizedVariants;
  const compactQuestionVariants = expandedSearchState.compactVariants;

  return docs
    .map((doc) => {
      const normalizedTitle = normalizeSearchTextSafe(`${doc.title} ${doc.sourceTitle || ''}`);
      const compactTitle = normalizedTitle.replace(/\s+/g, '');
      const normalizedText = normalizeSearchTextSafe(doc.text);
      const compactText = normalizedText.replace(/\s+/g, '');
      const diseaseName = extractHomepageDiseaseName(doc.sourceTitle || doc.title);
      const normalizedDiseaseName = normalizeSearchTextSafe(diseaseName);
      const diseaseDocBonus = normalizedDiseaseName && matchedDiseaseTerms.includes(normalizedDiseaseName) ? 24 : 0;
      const keywordScore = (doc.keywords || []).reduce((score, keyword) => {
        const normalizedKeyword = normalizeSearchTextSafe(keyword);
        const matched = normalizedQuestionVariants.some((variant) => variant.includes(normalizedKeyword));
        return matched ? score + 1 : score;
      }, 0);
      const titleScore = tokens.reduce((score, token) => (
        normalizedTitle.includes(token) ? score + 3 : score
      ), 0);
      const tokenScore = tokens.reduce((score, token) => (
        normalizedText.includes(token) ? score + 1 : score
      ), 0);
      const phraseScore = normalizedQuestionVariants.some((variant) => variant && normalizedText.includes(variant)) ? 10 : 0;
      const titlePhraseScore = normalizedQuestionVariants.some((variant) => variant && normalizedTitle.includes(variant)) ? 14 : 0;
      const compactScore = compactQuestionVariants.some((variant) => (
        variant && (compactTitle.includes(variant) || compactText.includes(variant))
      )) ? 8 : 0;
      const localDocBonus = doc.sourceType === 'local' && (titleScore > 0 || phraseScore > 0 || compactScore > 0) ? 3 : 0;
      const sourceWeight = sourceTypeWeights[doc.sourceType] ?? 0.1;
      const rawScore = keywordScore * 4 + titleScore + tokenScore + phraseScore + titlePhraseScore + compactScore + localDocBonus + diseaseDocBonus;

      return {
        ...doc,
        score: rawScore * sourceWeight,
        rawScore,
      };
    })
    .filter((doc) => doc.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function getSessionHistory(sessionId) {
  if (!sessionId) {
    return [];
  }

  return sessions.get(sessionId) || [];
}

function saveSessionHistory(sessionId, history) {
  if (!sessionId) {
    return;
  }

  sessions.set(sessionId, history.slice(-8));
}

async function callOpenAI(question, history, contextDocs) {
  const contextText = contextDocs.map((doc, index) => (
    `[문서 ${index + 1}] ${doc.title}\n출처 유형: ${doc.sourceType}\n출처: ${doc.url}\n내용: ${doc.text}`
  )).join('\n\n');

  const input = history.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  input.push({
    role: 'user',
    content: [
      '다음 질문에 답해 주세요.',
      `질문: ${question}`,
      '',
      '반드시 아래 참고 문서만 근거로 답하세요.',
      '문서에 없는 내용은 추측하지 말고 "홈페이지에서 확인되지 않습니다"라고 답하세요.',
      '',
      contextText,
    ].join('\n'),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  let response;

  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: [
        '당신은 하나이비인후과병원 환자 안내 AI입니다.',
        '역할: 병원 공식 홈페이지와 FAQ에 있는 내용만 근거로 자연스럽고 간결하게 답변합니다.',
        '공식 홈페이지와 FAQ를 최우선 근거로 사용하고, external은 보조 참고만 하며, low_trust는 10% 비중의 참고 정보로만 취급합니다.',
        '서로 충돌하면 official > external > low_trust 순으로 우선합니다.',
        '금지: 진단, 응급 최종판단, 처방 변경, 약 복용 지시, 추측성 정보.',
        '스타일: 존댓말, 3~5문장, 필요한 경우 마지막 문장에 대표전화 02-6925-1111 안내.',
      ].join(' '),
        input,
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const payload = await response.json();
  const outputText = extractOutputText(payload);

  if (!outputText) {
    throw new Error('OpenAI API returned empty output_text');
  }

  return formatAssistantAnswer(outputText);
}

function extractOutputText(payload) {
  if (typeof payload.output_text === 'string' && payload.output_text.trim()) {
    return payload.output_text;
  }

  if (!Array.isArray(payload.output)) {
    return '';
  }

  const pieces = [];

  for (const item of payload.output) {
    if (!Array.isArray(item.content)) {
      continue;
    }

    for (const contentItem of item.content) {
      if (contentItem.type === 'output_text' && contentItem.text) {
        pieces.push(contentItem.text);
      }
    }
  }

  return pieces.join('\n').trim();
}

function formatAssistantAnswer(text) {
  return String(text || '')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/([.!?][\]\)'"]?)(\s+)/g, '$1\n')
    .replace(/([.!?][\]\)'"]?)(?=[가-힣A-Za-z0-9])/g, '$1\n')
    .replace(/([가-힣])([A-Za-z0-9])/g, '$1 $2')
    .replace(/([A-Za-z0-9])([가-힣])/g, '$1 $2')
    .replace(/(\uC785\uB2C8\uB2E4|\uB429\uB2C8\uB2E4|\uBCF4\uC785\uB2C8\uB2E4|\uAD8C\uC7A5\uD569\uB2C8\uB2E4|\uC548\uB0B4\uB429\uB2C8\uB2E4|\uAC00\uB2A5\uD569\uB2C8\uB2E4|\uC5B4\uB835\uC2B5\uB2C8\uB2E4|\uBC14\uB78D\uB2C8\uB2E4)\s+(?=[\uAC00-\uD7A3])/g, '$1\n')
    .replace(/\s+\n/g, '\n')
    .replace(/\n\s+/g, '\n')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function simplifyMedicalTerms(text) {
  const replacements = [
    { pattern: /\bFESS\s*\+\s*S\s*\+\s*SMT\b/gi, replacement: '축농증 수술과 비중격 교정, 비염 수술' },
    { pattern: /\bESS\s*\+\s*S\s*\+\s*SMT\b/gi, replacement: '축농증 수술과 비중격 교정, 비염 수술' },
    { pattern: /\bFESS\s*\+\s*SMT\b/gi, replacement: '축농증 수술과 비염 수술' },
    { pattern: /\bESS\s*\+\s*SMT\b/gi, replacement: '축농증 수술과 비염 수술' },
    { pattern: /\bFESS\s*\+\s*septoplasty\b/gi, replacement: '축농증 수술과 비중격 교정 수술' },
    { pattern: /\bS\s*\+\s*SMT\b/gi, replacement: '비중격 교정과 비염 수술' },
    { pattern: /\bSeptoturbinoplasty\b/gi, replacement: '비중격 교정과 비염 수술' },
    { pattern: /\bSeptoplasty\b/gi, replacement: '비중격 교정 수술' },
    { pattern: /\bFESS\b/gi, replacement: '축농증 내시경 수술' },
    { pattern: /\bESS\b/gi, replacement: '축농증 내시경 수술' },
    { pattern: /\bSMT\b/gi, replacement: '비염 수술' },
    { pattern: /\bUPPP\b/gi, replacement: '코골이 또는 수면호흡 관련 구강 수술' },
    { pattern: /\bPSG\b/gi, replacement: '수면다원검사' },
    { pattern: /\bLMS\b/gi, replacement: '후두 미세 수술' },
    { pattern: /\bKTP\b/gi, replacement: '레이저 시술' },
    { pattern: /\bT&A\b/gi, replacement: '편도와 아데노이드 수술' },
    { pattern: /\bAdenoidectomy\b/gi, replacement: '아데노이드 수술' },
    { pattern: /\bTonsillectomy\b/gi, replacement: '편도 수술' },
    { pattern: /\bV-?tube\b/gi, replacement: '고막 환기관 삽입술' },
    { pattern: /\bNavigation\b/gi, replacement: '영상 유도 장비를 사용하는 방식' },
    { pattern: /\bBalloon catheter Sinus Plasty\b/gi, replacement: '풍선 카테터를 이용한 부비동 시술' },
    { pattern: /\btympanotomy\b/gi, replacement: '고막 절개술' },
    { pattern: /\bfrenotomy\b/gi, replacement: '설소대 절제술' },
    { pattern: /\bfistulectomy\b/gi, replacement: '누공 절제술' },
    { pattern: /\bClosed reduction\b/gi, replacement: '비수술 정복술' },
    { pattern: /\bepiglottectomy\b/gi, replacement: '후두개 절제술' },
  ];

  return replacements.reduce((result, { pattern, replacement }) => (
    result.replace(pattern, replacement)
  ), String(text || ''))
    .replace(/\(\s*편측\s*\)/g, ' (한쪽)')
    .replace(/\(\s*양측\s*\)/g, ' (양쪽)')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function applyPatientFriendlyTemplate(text, question) {
  const normalizedQuestion = normalizeSearchTextSafe(question);
  const isSinusQuestion = /축농증|부비동염/.test(normalizedQuestion);
  const isRhinitisQuestion = /비염|하비갑개|비갑개/.test(normalizedQuestion);
  const isSeptumQuestion = /비중격|비중격만곡/.test(normalizedQuestion);

  let result = simplifyMedicalTerms(text);

  const commonReplacements = [
    { pattern: /부비동염/gi, replacement: '축농증' },
    { pattern: /기능적 내시경 부비동 수술/gi, replacement: '축농증 내시경 수술' },
    { pattern: /내시경 부비동 수술/gi, replacement: '축농증 내시경 수술' },
    { pattern: /비중격 교정술/gi, replacement: '비중격 교정 수술' },
    { pattern: /하비갑개 점막하 절제술/gi, replacement: '비염 수술' },
    { pattern: /비갑개 축소술/gi, replacement: '비염 수술' },
  ];

  result = commonReplacements.reduce((value, item) => (
    value.replace(item.pattern, item.replacement)
  ), result);

  if (isSinusQuestion) {
    result = result
      .replace(/부비동/gi, '코 안 빈 공간')
      .replace(/용종/gi, '물혹')
      .replace(/농성 분비물/gi, '고름 섞인 콧물')
      .replace(/염증 병변/gi, '염증');
  }

  if (isRhinitisQuestion) {
    result = result
      .replace(/하비갑개/gi, '코 안 점막')
      .replace(/비갑개/gi, '코 안 점막')
      .replace(/점막하 절제/gi, '점막을 줄이는 수술')
      .replace(/점막 비후/gi, '점막이 많이 부은 상태');
  }

  if (isSeptumQuestion) {
    result = result
      .replace(/비중격만곡증/gi, '코 안 벽이 휜 상태')
      .replace(/비중격/gi, '코 안 벽')
      .replace(/만곡/gi, '휘어짐');
  }

  return result
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function getSmallTalkIntent(message) {
  const normalized = normalizeSearchTextSafe(message);
  const compact = compactSearchTextSafe(message);

  if (!normalized) {
    return null;
  }

  if (
    ['안녕하세요', '안녕', '반가워요', '반갑습니다', '처음 왔어요'].includes(normalized)
    || compact === '안녕하세요'
    || compact === '안녕'
  ) {
    return 'greeting';
  }

  if (
    ['고마워', '고마워요', '감사합니다', '감사해요', 'thanks', 'thank you'].includes(normalized)
    || compact === '감사합니다'
  ) {
    return 'thanks';
  }

  if (
    ['잘 있어', 'bye', 'goodbye', '종료', '끝', '그만', '수고하세요'].includes(normalized)
    || compact === '수고하세요'
  ) {
    return 'closing';
  }

  return null;
}

function createSmallTalkResponse(intent) {
  if (intent === 'greeting') {
    return {
      type: 'smalltalk',
      answer: '안녕하세요. 하나이비인후과병원 상담 도우미입니다. 예약, 진료시간, 의료진, 입원, 셔틀버스 같은 병원 안내를 편하게 물어보시면 됩니다.',
      followUp: ['진료시간 알려줘', '셔틀버스 시간표 알려줘', '입원 안내 알려줘'],
    };
  }

  if (intent === 'thanks') {
    return {
      type: 'smalltalk',
      answer: '네, 필요하신 내용 있으면 이어서 말씀해 주세요. 병원 안내 관련 질문이면 바로 도와드리겠습니다.',
      followUp: [],
    };
  }

  if (intent === 'closing') {
    return {
      type: 'smalltalk',
      answer: '네, 필요하실 때 다시 말씀해 주세요. 급한 문의는 대표전화 02-6925-1111로 바로 연락하셔도 됩니다.',
      followUp: [],
    };
  }

  return null;
}

async function callOpenAI(question, history, contextDocs) {
  const contextText = contextDocs.map((doc, index) => (
    `[문서 ${index + 1}] ${doc.title}\n출처 유형: ${doc.sourceType}\n출처: ${doc.url}\n내용: ${doc.text}`
  )).join('\n\n');

  const input = history.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  input.push({
    role: 'user',
    content: [
      '다음 질문에 답해 주세요.',
      `질문: ${question}`,
      '',
      '아래 참고 문서를 우선 근거로 사용해 주세요.',
      '병원 정보가 문서에 없으면 단정하지 말고, 확인이 어렵다고 자연스럽게 안내해 주세요.',
      '단순 인사, 감사, 연결 멘트는 상담원처럼 부드럽게 답해도 됩니다.',
      '',
      contextText,
    ].join('\n'),
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  let response;

  try {
    response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: [
          '당신은 하나이비인후과병원 안내 상담 도우미입니다.',
          '답변 톤은 딱딱한 챗봇보다 실제 상담원에 가깝게, 짧고 자연스럽게 유지하세요.',
          '병원 운영 정보는 제공된 문서를 최우선 근거로 사용하세요.',
          'local 문서와 FAQ를 가장 우선하고, official 홈페이지는 그 다음, external은 보조 참고만 사용하세요.',
          '문서에 없는 병원 정보는 추측하지 말고 확인이 어렵다고 자연스럽게 안내하세요.',
          '단순 인사, 감사, 대화 연결 문장은 문서 인용 없이도 자연스럽게 응답해도 됩니다.',
          '금지: 진단, 응급 최종판단, 처방 변경, 약 복용 지시, 추측성 의료정보.',
          '답변은 보통 2~4문장으로 하고, 필요할 때만 대표전화 02-6925-1111을 안내하세요.',
        ].join(' '),
        input,
      }),
    });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error ${response.status}: ${errorText}`);
  }

  const payload = await response.json();
  const outputText = extractOutputText(payload);

  if (!outputText) {
    throw new Error('OpenAI API returned empty output_text');
  }

  return outputText.trim();
}

async function buildChatResponse(rawMessage, sessionId) {
  const message = String(rawMessage || '').trim();
  const lowerMessage = message.toLowerCase();

  if (!message) {
    return enrichResponsePayload(createWelcomeResponse(), message);
  }

  if (matchesAnyPattern(lowerMessage, emergencyPatterns)) {
    return enrichResponsePayload(createEmergencyResponse(), message);
  }

  const certificateFeeResponse = findCertificateFeeResponse(message);
  if (certificateFeeResponse) {
    return enrichResponsePayload(certificateFeeResponse, message);
  }

  const floorGuideResponse = findFloorGuideResponse(message);
  if (floorGuideResponse) {
    return enrichResponsePayload(floorGuideResponse, message);
  }

  if (
    matchesAnyPattern(lowerMessage, medicalRestrictionPatterns)
    && !matchesAnyPattern(message, certificateDocumentQuestionPatterns)
  ) {
    return enrichResponsePayload(createRestrictedMedicalResponse(), message);
  }

  if (matchesAnyPattern(message, personalInfoPatterns)) {
    return enrichResponsePayload(createPersonalInfoWarningResponse(), message);
  }

  if (matchesAnyPattern(message, lateArrivalPatterns)) {
    return enrichResponsePayload(createLateArrivalResponse(), message);
  }

  if (matchesAnyPattern(message, inpatientMealPolicyPatterns)) {
    return enrichResponsePayload(createInpatientMealPolicyResponse(), message);
  }

  if (matchesAnyPattern(message, rhinitisPostOpVisitPatterns)) {
    return enrichResponsePayload(createRhinitisPostOpVisitResponse(), message);
  }

  const smallTalkIntent = getSmallTalkIntent(message);
  if (smallTalkIntent) {
    return enrichResponsePayload(createSmallTalkResponse(smallTalkIntent), message);
  }

  const cachedResponse = getCachedResponse(message);
  if (cachedResponse) {
    return cachedResponse;
  }

  const matchedDiseaseTerms = getMatchedHomepageDiseaseTerms(message);
  const shouldPrioritizeDiseaseDocs = matchedDiseaseTerms.length > 0;

  const directFaqResponse = shouldPrioritizeDiseaseDocs ? null : findDirectFaqMatch(message);
  if (directFaqResponse) {
    const simplifiedFaqResponse = {
      ...directFaqResponse,
      answer: appendSupportLinks(applyPatientFriendlyTemplate(directFaqResponse.answer, message), message),
      followUp: (directFaqResponse.followUp || []).map((item) => applyPatientFriendlyTemplate(item, message)),
      images: findRelevantImages(message),
    };
    setCachedResponse(message, simplifiedFaqResponse);
    return simplifiedFaqResponse;
  }

  if (!OPENAI_API_KEY) {
    return enrichResponsePayload(createApiKeyMissingResponse(), message);
  }

  const docs = await getDocumentsForRequest();
  const contextDocs = rankDocuments(message, docs);

  if (contextDocs.length === 0) {
    return enrichResponsePayload(createFallbackResponse([]), message);
  }

  const history = getSessionHistory(sessionId);
  const answer = appendSupportLinks(
    applyPatientFriendlyTemplate(await callOpenAI(message, history, contextDocs), message),
    message
  );

  const nextHistory = [
    ...history,
    { role: 'user', content: message },
    { role: 'assistant', content: answer },
  ];
  saveSessionHistory(sessionId, nextHistory);

  const responsePayload = {
    type: 'ai',
    answer,
    followUp: [],
    sources: dedupeSources(contextDocs).slice(0, 3),
    images: findRelevantImages(message, contextDocs),
  };

  setCachedResponse(message, responsePayload);
  return responsePayload;
}

function dedupeSources(docs) {
  const seen = new Set();
  const sources = [];

  for (const doc of docs) {
    if (doc.hiddenSource) {
      continue;
    }

    const resolvedSource = resolvePublicSourceForDoc(doc);
    if (!resolvedSource || !isPublicHttpUrl(resolvedSource.url)) {
      continue;
    }

    const key = `${resolvedSource.title}::${resolvedSource.url}`;
    if (seen.has(key) || seen.has(resolvedSource.url)) {
      continue;
    }

    seen.add(key);
    seen.add(resolvedSource.url);
    sources.push(resolvedSource);
  }

  return sources;
}

function handleApiChat(req, res) {
  let body = '';

  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', async () => {
    try {
      const parsed = JSON.parse(body || '{}');
      const requestGuardResult = getRequestGuardResult(req);
      if (!requestGuardResult.allowed) {
        sendJson(res, requestGuardResult.statusCode || 403, {
          type: 'request_blocked',
          answer: requestGuardResult.answer,
          followUp: requestGuardResult.followUp || [],
          detail: requestGuardResult.detail,
        });
        return;
      }

      const rateLimitResult = getRateLimitResult(req, parsed.sessionId);
      if (!rateLimitResult.allowed) {
        if (rateLimitResult.retryAfterMs) {
          res.setHeader('Retry-After', Math.ceil(rateLimitResult.retryAfterMs / 1000));
        }

        sendJson(res, rateLimitResult.statusCode || 429, {
          type: 'rate_limited',
          answer: rateLimitResult.answer,
          followUp: rateLimitResult.followUp || [],
          detail: rateLimitResult.detail,
        });
        return;
      }

      if (!matchesAnyPattern(String(parsed.message || ''), personalInfoPatterns)) {
        recordPopularQuestion(parsed.message);
      }
      const response = await buildChatResponse(parsed.message, parsed.sessionId);
      appendChatLog({
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        sessionId: parsed.sessionId || '',
        question: String(parsed.message || '').trim(),
        answer: response.answer || '',
        followUp: response.followUp || [],
        answerFull: [
          response.answer || '',
          ...((response.followUp || []).map((item) => `- ${item}`)),
        ].filter(Boolean).join('\n'),
        type: response.type || 'unknown',
        sources: response.sources || [],
        flag: 'normal',
        note: '',
      });
      sendJson(res, 200, response);
    } catch (error) {
      console.error('[chat-error]', error);
      sendJson(res, 500, {
        type: 'error',
        answer: 'AI 응답 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
        detail: error.message,
      });
    }
  });
}

function handleApiAdminLogFlag(req, res) {
  let body = '';

  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', () => {
    try {
      const parsed = JSON.parse(body || '{}');
      const updated = updateChatLogFlag(parsed.id, parsed.flag, parsed.note);
      if (!updated) {
        sendJson(res, 404, {
          ok: false,
          error: 'Log not found',
        });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        item: updated,
      });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error.message,
      });
    }
  });
}

function handleApiAdminLogin(req, res) {
  let body = '';

  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', () => {
    try {
      const parsed = JSON.parse(body || '{}');
      const username = String(parsed.username || '').trim();
      const password = String(parsed.password || '');

      if (username !== ADMIN_LOGIN_USERNAME || password !== ADMIN_LOGIN_PASSWORD) {
        sendJson(res, 401, {
          ok: false,
          error: 'Invalid credentials',
        });
        return;
      }

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Set-Cookie': `${ADMIN_SESSION_COOKIE}=${encodeURIComponent(ADMIN_SESSION_VALUE)}; Path=/; HttpOnly; SameSite=Lax`,
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ ok: true }));
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: error.message,
      });
    }
  });
}

function handleApiAdminLogout(req, res) {
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Set-Cookie': `${ADMIN_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify({ ok: true }));
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host}`);
  const pathname = decodeURIComponent(requestUrl.pathname);

  const isAdminPageRequest = pathname === '/admin';
  const isAdminApiRequest = pathname.startsWith('/api/admin/');
  const isAdminLoginRequest = pathname === '/admin/login' || pathname === '/api/admin/login';

  if ((isAdminPageRequest || isAdminApiRequest) && !isAdminLoginRequest && !isAuthorizedAdminRequest(req)) {
    if (isAdminPageRequest) {
      redirectToAdminLogin(res);
    } else {
      sendJson(res, 401, {
        ok: false,
        error: 'Unauthorized',
      });
    }
    return;
  }

  if (req.method === 'POST' && pathname === '/api/chat') {
    handleApiChat(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/login') {
    handleApiAdminLogin(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/logout') {
    handleApiAdminLogout(req, res);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/logs/flag') {
    handleApiAdminLogFlag(req, res);
    return;
  }

  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, {
      ok: true,
      aiEnabled: Boolean(OPENAI_API_KEY),
      model: OPENAI_MODEL,
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/popular-questions') {
    sendJson(res, 200, {
      ok: true,
      items: getPopularQuestions(),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/admin/logs') {
    sendJson(res, 200, {
      ok: true,
      items: getChatLogsForAdmin(requestUrl.searchParams),
      total: getChatLogCount(),
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const safePath = pathname === '/'
    ? '/index.html'
    : (pathname === '/admin'
      ? '/admin.html'
      : (pathname === '/admin/login' ? '/admin-login.html' : pathname));
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  sendFile(res, filePath);
});

server.on('error', (error) => {
  console.error('[server-error]', error);
});

server.listen(PORT, () => {
  console.log(`Patient AI bot server running at http://localhost:${PORT}`);
  console.log(`AI enabled: ${OPENAI_API_KEY ? 'yes' : 'no'} (${OPENAI_MODEL})`);
  watchDocsDirectory();
  warmupKnowledgeDocuments();
});
