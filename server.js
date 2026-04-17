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
const PERSISTENT_DATA_DIR = process.env.PERSISTENT_DATA_DIR
  ? path.resolve(process.env.PERSISTENT_DATA_DIR)
  : path.join(__dirname, 'data');
const NONPAY_PAGE_URL = 'https://hanaent.co.kr/nonpay.html';
const ADMIN_LOGIN_USERNAME = 'hanaent';
const ADMIN_LOGIN_PASSWORD = 'hana1120@@';
const ADMIN_SESSION_COOKIE = 'admin_session';
const ADMIN_SESSION_VALUE = 'hanaent-admin-authenticated';
const PUBLIC_DIR = path.join(__dirname, 'public');
const FAQ_PATH = path.join(__dirname, 'data', 'faq.json');
const FAQ_EXTENDED_PATH = path.join(__dirname, 'data', 'faq-extended.json');
const SITE_SOURCES_PATH = path.join(__dirname, 'data', 'site-sources.json');
const IMAGE_GUIDES_PATH = path.join(__dirname, 'data', 'image-guides.json');
const POPULAR_QUESTIONS_PATH = path.join(PERSISTENT_DATA_DIR, 'popular-question-stats.json');
const CHAT_LOGS_PATH = path.join(PERSISTENT_DATA_DIR, 'chat-logs.json');
const CHAT_LOGS_DB_PATH = path.join(PERSISTENT_DATA_DIR, 'chat-logs.db');
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
const conversationStates = new Map();
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
const NASAL_IRRIGATION_QUERY_PATTERNS = [
  /코\s*세척/u,
  /비강\s*세척/u,
  /코\s*세정/u,
  /세척기/u,
  /세척\s*분말/u,
  /생리식염수\s*분말/u,
];
const NASAL_IRRIGATION_DOC_NAMES = ['외래-코세척 방법'];
const MEDICATION_STOP_IMAGE_PATH_FRAGMENT = '입원전%20복용중단%20약물%20리스트.jpg';
const MEDICATION_STOP_DIRECT_QUERY_PATTERNS = [
  /복용\s*중단/u,
  /중단\s*약물/u,
  /금지\s*약물/u,
  /중단해야\s*되는\s*약/u,
  /중단해야\s*하는\s*약/u,
  /끊어야\s*하는\s*약/u,
  /복용하면\s*안\s*되는\s*약/u,
  /먹으면\s*안\s*되는\s*약/u,
  /먹지\s*말아야\s*하는\s*약/u,
  /아스피린/u,
  /항응고/u,
  /항혈소판/u,
];
const MEDICATION_STOP_PREP_QUERY_PATTERNS = [
  /입원\s*전/u,
  /수술\s*전/u,
];
const MEDICATION_STOP_MEDICATION_QUERY_PATTERNS = [
  /약/u,
  /약물/u,
  /복용약/u,
  /먹는\s*약/u,
];
const MEDICATION_STOP_ACTION_QUERY_PATTERNS = [
  /중단/u,
  /금지/u,
  /끊/u,
  /복용\s*중단/u,
  /먹으면\s*안/u,
  /먹지\s*말/u,
];

const PARKING_QUERY_PATTERNS = [/주차/u, /발렛/u, /주차권/u, /영수증/u];
const PARKING_OUTPATIENT_PATTERNS = [/외래/u, /방문객/u, /보호자/u, /내원/u, /통원/u];
const PARKING_INPATIENT_PATTERNS = [/입원/u, /수술/u, /퇴원/u];
const NASAL_IRRIGATION_SURGERY_PATTERNS = [/수술/u, /퇴원/u, /수술후/u, /수술 후/u];
const NASAL_IRRIGATION_GENERAL_PATTERNS = [/일반/u, /평소/u, /비수술/u];
const PREP_BROAD_PATTERNS = [
  /입원\s*준비/u,
  /수술\s*준비/u,
  /입원.*뭐/u,
  /수술.*뭐/u,
  /입원.*알아/u,
  /수술.*알아/u,
  /입원.*챙기/u,
  /수술.*챙기/u,
];
const PREP_DETAIL_PATTERNS = [/준비물/u, /주차/u, /보호자/u, /검사/u, /약/u, /금식/u, /퇴원/u];

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

const inpatientOutingPatterns = [
  /입원.{0,10}(외출|외박)/u,
  /(외출|외박).{0,10}입원/u,
  /병동.{0,10}(외출|외박)/u,
];

const shuttleBusPatterns = [
  /셔틀/u,
  /셔틀버스/u,
  /역삼역.{0,10}(버스|셔틀)/u,
  /(버스|셔틀).{0,10}시간표/u,
  /(버스|셔틀).{0,10}운행/u,
];

const dischargeProcedurePatterns = [
  /퇴원.{0,10}(절차|수속|안내)/u,
  /(절차|수속|안내).{0,10}퇴원/u,
  /퇴원\s*어떻게/u,
  /퇴원\s*순서/u,
];

const hospitalPhonePatterns = [
  /병원.{0,12}(전화번호|번호|대표번호|대표전화|연락처)/u,
  /(전화번호|번호|대표번호|대표전화|연락처).{0,12}병원/u,
  /대표전화/u,
  /대표번호/u,
  /연락처/u,
];

const floorGuidePatterns = [
  /\d+\s*번\s*진료실/u,
  /\d+\s*진료실/u,
  /지하\s*\d+\s*층/u,
  /\d+\s*층/u,
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

const surgeryDurationPatterns = [
  /수술\s*소요\s*시간/u,
  /수술\s*시간/u,
  /수술.{0,8}(얼마나|몇\s*시간|얼마)/u,
  /수술.{0,8}(걸리|걸려|걸립)/u,
  /수술실.{0,10}(얼마나|몇\s*시간|걸리)/u,
];

const surgerySchedulePatterns = [
  /수술.{0,8}(언제|몇\s*시)/u,
  /수술\s*(일정|날짜)/u,
  /수술\s*시간.{0,8}(언제|몇\s*시|알)/u,
  /몇\s*시.{0,8}수술/u,
];

const postOpBleedingPatterns = [
  /수술\s*후.{0,12}(출혈|피)/u,
  /(출혈|피).{0,12}수술\s*후/u,
  /코수술\s*후.{0,12}(출혈|피)/u,
  /목수술\s*후.{0,12}(출혈|피)/u,
  /편도.{0,12}수술\s*후.{0,12}(출혈|피)/u,
];

const postOpCarePatterns = [
  /수술\s*후.{0,12}(주의사항|주의 사항|관리|조심|주의)/u,
  /(주의사항|주의 사항|관리|조심|주의).{0,12}수술\s*후/u,
  /퇴원\s*후.{0,12}(주의사항|관리)/u,
];

const surgeryCostPatterns = [
  /수술.{0,10}(비용|금액|가격|얼마)/u,
  /(비용|금액|가격|얼마).{0,10}수술/u,
  /수술비/u,
  /수술\s*비/u,
];

const sameDayExamAvailabilityPatterns = [
  /진료.{0,8}검사.{0,8}(가능|되나|되나요|할수|할 수)/u,
  /검사.{0,8}(가능|되나|되나요|할수|할 수).{0,8}진료/u,
  /당일.{0,8}검사.{0,8}(가능|되나|되나요|할수|할 수)/u,
  /검사.{0,8}(당일|바로)/u,
  /진료시\s*검사/u,
  /진료\s*시\s*검사/u,
];

const receiptIssuancePatterns = [
  /영수증.{0,8}(발급|출력|방법|어떻게|어디)/u,
  /(발급|출력|방법|어떻게|어디).{0,8}영수증/u,
  /진료상세내역.{0,8}(발급|출력|방법|어떻게|어디)/u,
  /(발급|출력|방법|어떻게|어디).{0,8}진료상세내역/u,
  /진료비.{0,8}(상세내역|세부내역|상세내역서|세부내역서)/u,
  /(상세내역|세부내역|상세내역서|세부내역서).{0,8}(발급|출력|방법)/u,
];

const complaintPatterns = [
  /불만/u,
  /고충/u,
  /컴플레인/u,
  /민원/u,
  /고객\s*의견함/u,
  /의견함/u,
  /고객\s*소리함/u,
  /불편\s*사항/u,
  /건의/u,
  /제안/u,
];

const guardianShiftPatterns = [
  /상주\s*보호자\s*교대/u,
  /보호자\s*교대/u,
  /교대\s*가능/u,
  /보호자.{0,8}바꿔/u,
  /보호자.{0,8}교체/u,
];

const wifiPatterns = [
  /와이파이/u,
  /wifi/i,
  /wi-?fi/i,
  /무선\s*인터넷/u,
  /인터넷.{0,8}비밀번호/u,
  /비밀번호.{0,8}(와이파이|wifi|wi-?fi|인터넷)/iu,
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
const POPULAR_QUESTION_ACTIVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_POPULAR_QUESTIONS = [
  { label: '진료시간', question: '진료시간 알려줘' },
  { label: '셔틀버스', question: '셔틀버스시간 알려줘' },
  { label: '입원전 약물', question: '입원전 금지 약물 알려줘' },
  { label: '병원 진료시간', question: '진료시간 안내해줘' },
  { label: '예약 변경', question: '예약 변경 방법 알려줘' },
  { label: '코골이 상담', question: '코골이 진료 과를 알려줘' },
];
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;
const RATE_LIMIT_IP_PER_MINUTE = 10;
const RATE_LIMIT_SESSION_PER_MINUTE = 10;
const RATE_LIMIT_SESSION_PER_DAY = 40;
const MAX_SESSION_HISTORY_TURNS = 8;
const MAX_SESSION_MESSAGE_ENTRIES = MAX_SESSION_HISTORY_TURNS * 2;
const ipRateWindow = new Map();
const sessionMinuteRateWindow = new Map();
const sessionDailyRateWindow = new Map();
let warmupStarted = false;
const MAX_CHAT_LOG_ENTRIES = 5000;
ensurePersistentDataDir();
warnIfRenderPersistenceIsMisconfigured();
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

function ensurePersistentDataDir() {
  fs.mkdirSync(PERSISTENT_DATA_DIR, { recursive: true });
}

function warnIfRenderPersistenceIsMisconfigured() {
  if (!IS_RENDER || process.env.PERSISTENT_DATA_DIR) {
    return;
  }

  console.warn('[persistence] PERSISTENT_DATA_DIR is not set. Chat logs will be lost when the Render service restarts.');
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
    nonpayItemEntries: buildNonpayItemEntries(),
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
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_timestamp
      ON chat_messages(session_id, timestamp DESC);
  `);

  migrateChatLogsJsonToSqlite(db);
  trimChatLogs(db);
  trimChatMessages(db);
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

function trimChatMessages(db, sessionId = '') {
  const normalizedSessionId = String(sessionId || '').trim();
  if (normalizedSessionId) {
    db.prepare(`
      DELETE FROM chat_messages
      WHERE session_id = ?
        AND id NOT IN (
          SELECT id FROM chat_messages
          WHERE session_id = ?
          ORDER BY datetime(timestamp) DESC, id DESC
          LIMIT ?
        )
    `).run(normalizedSessionId, normalizedSessionId, MAX_SESSION_MESSAGE_ENTRIES);
    return;
  }

  db.exec(`
    DELETE FROM chat_messages
    WHERE session_id IN (
      SELECT session_id
      FROM chat_messages
      GROUP BY session_id
      HAVING COUNT(*) > ${MAX_SESSION_MESSAGE_ENTRIES}
    )
    AND id NOT IN (
      SELECT id
      FROM (
        SELECT id,
               ROW_NUMBER() OVER (
                 PARTITION BY session_id
                 ORDER BY datetime(timestamp) DESC, id DESC
               ) AS row_number
        FROM chat_messages
      )
      WHERE row_number <= ${MAX_SESSION_MESSAGE_ENTRIES}
    );
  `);
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

function appendSessionMessage(sessionId, role, content, timestamp = new Date().toISOString()) {
  const normalizedSessionId = String(sessionId || '').trim();
  const normalizedRole = String(role || '').trim();
  const normalizedContent = String(content || '').trim();
  if (!normalizedSessionId || !normalizedRole || !normalizedContent) {
    return;
  }

  chatLogDb.prepare(`
    INSERT INTO chat_messages (
      id, session_id, role, content, timestamp
    ) VALUES (?, ?, ?, ?, ?)
  `).run(
    `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    normalizedSessionId,
    normalizedRole,
    normalizedContent,
    String(timestamp)
  );

  trimChatMessages(chatLogDb, normalizedSessionId);
}

function getStoredSessionHistory(sessionId) {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) {
    return [];
  }

  const rows = chatLogDb.prepare(`
    SELECT role, content, timestamp
    FROM chat_messages
    WHERE session_id = ?
    ORDER BY datetime(timestamp) ASC, id ASC
    LIMIT ?
  `).all(normalizedSessionId, MAX_SESSION_MESSAGE_ENTRIES);

  return rows.map((row) => ({
    role: String(row.role || ''),
    content: String(row.content || ''),
  })).filter((row) => row.role && row.content);
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
  const startAt = String(getQueryValue('startAt') || '').trim();
  const endAt = String(getQueryValue('endAt') || '').trim();

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

  if (startAt) {
    conditions.push('timestamp >= ?');
    params.push(startAt);
  }

  if (endAt) {
    conditions.push('timestamp < ?');
    params.push(endAt);
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }

  sql += ' ORDER BY datetime(timestamp) DESC LIMIT ?';
  params.push(limit);

  return chatLogDb.prepare(sql).all(...params).map(mapChatLogRow);
}

function getChatLogCount(query) {
  const getQueryValue = (key) => (typeof query?.get === 'function' ? query.get(key) : query?.[key]);
  const search = normalizeSearchTextSafe(getQueryValue('q') || '');
  const flag = String(getQueryValue('flag') || '').trim();
  const startAt = String(getQueryValue('startAt') || '').trim();
  const endAt = String(getQueryValue('endAt') || '').trim();

  let sql = 'SELECT COUNT(*) AS count FROM chat_logs';
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

  if (startAt) {
    conditions.push('timestamp >= ?');
    params.push(startAt);
  }

  if (endAt) {
    conditions.push('timestamp < ?');
    params.push(endAt);
  }

  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(' AND ')}`;
  }

  const row = chatLogDb.prepare(sql).get(...params);
  return Number(row?.count || 0);
}

function getSessionMessagesForAdmin(sessionId, limit = MAX_SESSION_MESSAGE_ENTRIES) {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) {
    return [];
  }

  const normalizedLimit = Math.min(Math.max(Number(limit) || MAX_SESSION_MESSAGE_ENTRIES, 1), 40);
  const rows = chatLogDb.prepare(`
    SELECT role, content, timestamp
    FROM chat_messages
    WHERE session_id = ?
    ORDER BY datetime(timestamp) ASC, id ASC
    LIMIT ?
  `).all(normalizedSessionId, normalizedLimit);

  return rows.map((row) => ({
    role: String(row.role || ''),
    content: String(row.content || ''),
    timestamp: String(row.timestamp || ''),
  })).filter((row) => row.role && row.content);
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
  const now = Date.now();
  const dynamicItems = [...popularQuestionStats.values()]
    .filter((item) => (
      item
      && String(item.question || '').trim()
      && Number(item.updatedAt) > 0
      && now - Number(item.updatedAt) <= POPULAR_QUESTION_ACTIVE_WINDOW_MS
    ))
    .sort((a, b) => (
      b.updatedAt - a.updatedAt || b.count - a.count
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

  const payload = cached.payload;
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const images = Array.isArray(payload.images) && payload.images.length > 0
    ? payload.images
    : findRelevantImages(message);

  return {
    ...payload,
    images,
  };
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
      followUp: ['한 세션에서는 1분에 10회까지 질문할 수 있습니다.'],
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
  const normalizedQuestion = normalizeSearchTextSafe(question);
  const normalizedAnswer = normalizeSearchTextSafe(result);

  if (!result) {
    return result;
  }

  const youtubeLink = findRelevantYoutubeLink(question, result);
  if (youtubeLink && !result.includes(youtubeLink.url)) {
    result = `${result}\n\n${youtubeLink.topic} 관련 영상 보기: ${youtubeLink.url}`;
  }

  if (
    (normalizedQuestion.includes('비급여') || normalizedAnswer.includes('비급여'))
    && !result.includes(NONPAY_PAGE_URL)
  ) {
    result = `${result}\n\n비급여 안내 페이지: ${NONPAY_PAGE_URL}`;
  }

  return result.replace(/(?:대표전화\s*)?02-6925-1111/g, '대표전화 02-6925-1111');
}

function enrichResponsePayload(payload, question) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const localizedPayload = localizeFixedResponsePayload(payload, question);
  const images = Array.isArray(localizedPayload.images) && localizedPayload.images.length > 0
    ? localizedPayload.images
    : findRelevantImages(question);

  return {
    ...localizedPayload,
    answer: appendSupportLinks(localizedPayload.answer, question),
    images,
  };
}

function localizeFixedResponsePayload(payload, question) {
  if (!isEnglishDominantText(question)) {
    return payload;
  }

  if (payload.type === 'guided_question') {
    const defaultGuidedAnswer = Array.isArray(payload.followUp) && payload.followUp.length > 2
      ? 'Please choose the topic you want help with so I can guide you more accurately.'
      : 'Please choose one of the options below so I can guide you more accurately.';
    let defaultGuidedFollowUp = payload.followUp || [];

    if (!Array.isArray(payload.followUpEn) || payload.followUpEn.length === 0) {
      if (Array.isArray(payload.followUp) && payload.followUp.length === 2) {
        defaultGuidedFollowUp = ['Outpatient visit', 'Admission'];
      } else if (Array.isArray(payload.followUp) && payload.followUp.length >= 5) {
        defaultGuidedFollowUp = ['Preparation items', 'Parking', 'Guardian stay', 'Pre-op tests', 'Medication stop'];
      }
    }

    return {
      ...payload,
      answer: payload.answerEn || defaultGuidedAnswer,
      followUp: Array.isArray(payload.followUpEn) && payload.followUpEn.length > 0
        ? payload.followUpEn
        : defaultGuidedFollowUp,
    };
  }

  if (payload.type === 'smalltalk') {
    if (Array.isArray(payload.followUp) && payload.followUp.length > 0) {
      return {
        ...payload,
        answer: 'Hello. This is the Hana ENT Hospital assistant. You can ask about appointments, clinic hours, doctors, admission, or the shuttle bus.',
        followUp: ['Show me clinic hours', 'Show me the shuttle bus schedule', 'Tell me about admission'],
      };
    }

    if (String(payload.answer || '').includes('02-6925-1111')) {
      return {
        ...payload,
        answer: 'Please contact me again anytime you need help. For urgent inquiries, you can call 02-6925-1111.',
        followUp: [],
      };
    }

    return {
      ...payload,
      answer: 'You are welcome. If you need anything else, please continue your question and I will help with hospital information.',
      followUp: [],
    };
  }

  const englishByType = {
    restricted: {
      answer: 'This assistant cannot make diagnoses, decide whether to stop medications, or change treatment plans. For symptom or medication questions, please contact the clinic or a staff member.',
      followUp: ['Main phone number: 02-6925-1111', 'Phone appointment or appointment change', 'If symptoms are urgent, call 119 or visit the nearest emergency room'],
    },
    emergency: {
      answer: 'This may be an emergency. Please do not delay care through the chat and contact 119 or the nearest emergency room immediately.',
      followUp: ['Severe breathing trouble, heavy bleeding, or loss of consciousness requires immediate emergency care', 'Main phone number: 02-6925-1111', 'After hours, use the emergency care system if needed'],
    },
    privacy_warning: {
      answer: 'Please do not enter personal or sensitive health information. Ask your question without details such as resident number, phone number, email address, or full address.',
      followUp: ['You can ask about fees, appointment changes, or clinic hours without personal information', 'If you already entered personal information, rewrite the question in a general way'],
    },
    welcome: {
      answer: 'Hello. This is the Hana ENT Hospital AI assistant. Based on hospital website information, I can help with appointments, clinic hours, doctors, admission, and document issuance.',
      followUp: ['Show me clinic hours', 'Show me a doctor schedule', 'Tell me about admission'],
    },
    config_error: {
      answer: 'The OpenAI API key is not configured, so AI responses are currently unavailable. Set OPENAI_API_KEY in PowerShell and restart the server.',
      followUp: ['$env:OPENAI_API_KEY="your_api_key"', 'node .\\server.js', 'Main phone number: 02-6925-1111'],
    },
    late_arrival: {
      answer: 'If you expect to arrive late after making an appointment, please call 02-6925-1111 first and let the staff know. Based on the documents, the hospital may guide you as a walk-in or recheck appointment availability depending on your arrival time and outpatient waiting status.',
      followUp: ['If you are less than one hour late, you may be guided as a walk-in visit', 'If you will be more than one hour late, it is safer to confirm appointment availability by phone first', 'Main phone number: 02-6925-1111'],
    },
    inpatient_meal_policy: {
      answer: 'According to the admission guide, there is no microwave available in the hospital, and cooking or food delivery is not allowed.',
      followUp: ['Meal times are breakfast at 8:00 AM, lunch at 12:00 PM, and dinner at 5:30 PM', 'For details, please check with the ward staff or call 02-6925-1111'],
    },
    inpatient_outing: {
      answer: 'During hospitalization, going out or staying out overnight is generally restricted unless there is a special reason. If it is necessary, you must submit a request form and receive approval from the attending doctor.',
      followUp: ['Please return within the approved time given by the ward', 'Leaving without approval is not allowed', 'Unauthorized outings may lead to discharge or interruption of treatment'],
    },
    shuttle_bus: {
      answer: 'According to the shuttle schedule, the bus runs about every 15 minutes on weekdays. It operates from 8:55 AM to 12:25 PM in the morning and from 1:40 PM to 5:40 PM in the afternoon.',
      followUp: ['On Saturdays, it runs about every 30 minutes from 8:55 AM to 12:55 PM', 'The shuttle stop is near Exit 1 of Yeoksam Station', 'Example weekday departures: 8:55, 9:10, 9:25 AM / 1:40, 1:55, 2:10 PM'],
    },
    discharge_procedure: {
      answer: 'According to the document, discharge usually proceeds in this order: discharge guidance, bill review, payment, and then leaving the hospital. On the day of discharge, the medical team checks the surgical area and explains aftercare and precautions.',
      followUp: ['If you need a certificate, ask the ward nurse in advance', 'If there is a payment balance, it will be explained separately', 'After payment on the first floor, the next outpatient visit can be scheduled'],
    },
    hospital_phone: {
      answer: 'The main phone number for Hana ENT Hospital is 02-6925-1111.',
      followUp: ['You can receive guidance for phone appointments or appointment changes through the main number'],
    },
    rhinitis_postop_visit: {
      answer: 'According to the document, follow-up visits after rhinitis surgery are usually guided as about 8 to 12 visits.',
      followUp: ['The recovery period is usually about 3 to 4 weeks', 'The exact number of visits may vary depending on the procedure and recovery, so it is safest to follow the doctor’s final guidance'],
    },
    fallback: {
      answer: 'Based on the information currently confirmed on the website, it is hard to give a precise answer right away. Please ask in a more specific way or call 02-6925-1111.',
      followUp: ['Clinic hours', 'Doctor schedule', 'Document issuance'],
    },
  };

  const localized = englishByType[payload.type];
  if (!localized) {
    return payload;
  }

  return {
    ...payload,
    answer: localized.answer,
    followUp: localized.followUp,
  };
}

function scoreImageGuide(guide, normalizedQuestion, compactQuestion, contextDocs) {
  if (isMedicationStopImageGuide(guide) && !isMedicationStopQuestion(normalizedQuestion)) {
    return 0;
  }

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

  if (keywordScore <= 0) {
    return 0;
  }

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
      display: guide.display || '',
      url: resolvePublicImagePath(guide.path),
      score: scoreImageGuide(guide, normalizedQuestion, compactQuestion, contextDocs),
    }))
    .filter((guide) => guide.url && guide.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(({ title, description, display, url }) => ({ title, description, display, url }));
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

function createMedicationStopResponse() {
  return {
    type: 'medication_stop',
    answer: '입원 전이나 수술 전에 복용하면 안 되는 약은 병동 안내 기준으로 별도 리스트를 먼저 확인하시는 것이 가장 정확합니다. 아래에 입원 전 복용 중단 약물 리스트 이미지를 함께 안내드리니, 복용 중인 약이 있으면 해당 목록을 먼저 확인해 주세요.',
    followUp: [
      '이미지에 없는 약이거나 복용 지속 여부가 애매하면 대표전화 02-6925-1111로 꼭 확인해 주세요.',
      '아스피린, 항응고제처럼 출혈과 관련된 약은 특히 임의로 계속 복용하거나 중단하지 말고 병원 안내를 따르는 것이 안전합니다.',
      '질문을 더 구체적으로 주시면 입원 준비나 수술 전 검사 안내와 함께 이어서 도와드릴 수 있습니다.',
    ],
    sources: [{
      title: '蹂묐룞-FAQ',
      url: 'local://docs/%EB%B3%91%EB%8F%99-FAQ.txt',
    }],
    images: [{
      title: '입원 전 복용 중단 약물 리스트',
      description: '입원 전 중단해야 하는 약물 질문에 함께 보여주는 이미지',
      display: 'document',
      url: resolvePublicImagePath('/images/%EC%9E%85%EC%9B%90%EC%A0%84%20%EB%B3%B5%EC%9A%A9%EC%A4%91%EB%8B%A8%20%EC%95%BD%EB%AC%BC%20%EB%A6%AC%EC%8A%A4%ED%8A%B8.jpg'),
    }],
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

function createInpatientOutingResponse() {
  return {
    type: 'inpatient_outing',
    answer: '입원 중 외출과 외박은 특별한 사유가 없는 한 원칙적으로 제한됩니다. 다만 외출이나 외박이 필요하면 외출·외박 신청서를 작성하고, 담당의사 또는 주치의의 허가를 받은 경우에만 가능합니다.',
    followUp: [
      '외출·외박 시에는 병동에서 안내한 정해진 시간을 반드시 지켜야 합니다.',
      '담당의사 허가 없이 무단 외출·외박은 인정되지 않습니다.',
      '무단 외출·외박 등 준수의무 위반 시 즉시 퇴원 및 치료 중단이 될 수 있습니다.',
    ],
    sources: [{
      title: '병동-FAQ',
      url: 'local://docs/%EB%B3%91%EB%8F%99-FAQ.txt',
    }],
  };
}

function createInpatientMealPolicyResponseFixed() {
  return {
    type: 'inpatient_meal_policy',
    answer: '입원생활 안내문 기준으로 원내 전자레인지는 비치되어 있지 않으며 취사는 금지입니다. 배달음식은 가능하지만 외부 음식 섭취 시 소화 불편이나 합병증 가능성을 고려해 주문해 주시기 바랍니다.',
    followUp: [
      '식사시간은 조식 8시, 중식 12시, 석식 오후 5시 30분으로 안내되어 있습니다.',
      '배달음식 가능시간은 오전 7시부터 오후 9시까지이며 지하 1층에서 수령합니다.',
      '추가 안내는 병동 간호사실이나 대표전화 02-6925-1111로 확인해 주세요.',
    ],
    sources: [{
      title: '입원-입원생활안내문',
      url: 'local://docs/%EC%9E%85%EC%9B%90-%EC%9E%85%EC%9B%90%EC%83%9D%ED%99%9C%EC%95%88%EB%82%B4%EB%AC%B8.txt',
    }],
  };
}

function createShuttleBusResponse() {
  return {
    type: 'shuttle_bus',
    answer: '셔틀버스 시간표 기준으로 평일은 약 15분 간격으로 운행합니다. 오전은 08:55부터 12:25까지, 오후는 13:40부터 17:40까지 병원에서 출발해 역삼역을 거쳐 다시 병원으로 운행합니다.',
    followUp: [
      '토요일은 08:55부터 12:55까지 약 30분 간격으로 운행합니다.',
      '셔틀 승차 위치는 역삼역 1번 출구 인근입니다.',
      '예: 평일 오전 08:55, 09:10, 09:25 / 오후 13:40, 13:55, 14:10',
    ],
    sources: [
      {
        title: '기타-병원셔틀시간표',
        url: 'local://docs/%EA%B8%B0%ED%83%80-%EB%B3%91%EC%9B%90%EC%85%94%ED%8B%80%EC%8B%9C%EA%B0%84%ED%91%9C.txt',
      },
      {
        title: '홈페이지-셔틀버스 및 오시는길',
        url: 'local://docs/%ED%99%88%ED%8E%98%EC%9D%B4%EC%A7%80-%EC%85%94%ED%8B%80%EB%B2%84%EC%8A%A4%20%EB%B0%8F%20%EC%98%A4%EC%8B%9C%EB%8A%94%EA%B8%B8.txt',
      },
    ],
  };
}

function createDischargeProcedureResponse() {
  return {
    type: 'discharge_procedure',
    answer: '퇴원 절차는 문서 기준으로 퇴원안내, 진료비 심사, 진료비 수납, 귀가 순서로 진행됩니다. 퇴원 당일 오전에는 해당 의료진이 수술부위를 확인하고 수술 후 관리법과 주의사항을 안내합니다.',
    followUp: [
      '제증명서류가 필요하면 퇴원 하루 전 간호사실에 미리 말씀해 주세요.',
      '퇴원약이 있으면 설명을 듣고 수령합니다.',
      '진료비 심사가 끝나면 1층 원무과에서 수납하고 다음 통원치료 날짜를 예약합니다.',
    ],
    sources: [{
      title: '홈페이지-입퇴원 안내',
      url: 'local://docs/%ED%99%88%ED%8E%98%EC%9D%B4%EC%A7%80-%EC%9E%85%ED%87%B4%EC%9B%90%20%EC%95%88%EB%82%B4.txt',
    }],
  };
}

function createSurgeryDurationResponse() {
  return {
    type: 'surgery_duration',
    answer: '수술 소요시간은 수술 종류와 환자 상태에 따라 다릅니다. 문서 기준으로는 수술실 입실 후 대기시간이 생길 수 있고, 특히 코 수술은 국소마취 후 효과를 기다리는 시간이 있어 실제 설명받은 수술시간보다 더 길어질 수 있습니다.',
    followUp: [
      '목이나 귀 수술은 대기시간이 비교적 길지 않지만 코 수술은 30분에서 1시간 정도 대기 후 시작될 수 있습니다.',
      '수술 종료 후에도 회복실에서 30분에서 1시간 정도 회복한 뒤 퇴실합니다.',
      '정확한 예상 시간은 수술 설명 시 의료진 안내를 다시 확인해 주세요.',
    ],
    sources: [
      {
        title: '병동-FAQ',
        url: 'local://docs/%EB%B3%91%EB%8F%99-FAQ.txt',
      },
      {
        title: '입원-입원생활안내문',
        url: 'local://docs/%EC%9E%85%EC%9B%90-%EC%9E%85%EC%9B%90%EC%83%9D%ED%99%9C%EC%95%88%EB%82%B4%EB%AC%B8.txt',
      },
    ],
  };
}

function createSurgeryScheduleResponse() {
  return {
    type: 'surgery_schedule',
    answer: '수술 시작 시간은 수술 동의서 설명 때 안내되지만, 당일 상황이나 환자 상태에 따라 변경될 수 있습니다.',
    followUp: [
      '정확한 시간은 입원 후 병동 또는 수술 안내 과정에서 다시 확인해 주세요.',
      '변경 가능성이 있어 고정된 시간으로 미리 확정해서 안내되지는 않을 수 있습니다.',
      '추가 확인이 필요하면 대표전화 02-6925-1111로 문의해 주세요.',
    ],
    sources: [{
      title: '병동-FAQ',
      url: 'local://docs/%EB%B3%91%EB%8F%99-FAQ.txt',
    }],
  };
}

function createPostOpBleedingResponse() {
  return {
    type: 'postop_bleeding',
    answer: '문서 기준으로 수술 후 출혈이 있으면 먼저 출혈 양과 지속 여부를 보셔야 합니다. 침에 피가 조금 섞이는 정도라면 시원한 얼음물로 20~30분 정도 가글해 볼 수 있지만, 출혈이 계속되거나 양이 많으면 대표전화 02-6925-1111로 바로 연락해 주세요.',
    followUp: [
      '즉시 내원이 어렵거나 원거리인 경우에는 이비인후과 의사가 있는 가까운 응급실 내원을 권고합니다.',
      '코수술 후에는 출혈양이 많고 계속되면 바로 연락하거나 가까운 응급실로 안내되어 있습니다.',
      '퇴원 시 받은 주치의 연락처가 있으면 그 번호로 먼저 연락하셔도 됩니다.',
    ],
    sources: [
      {
        title: '?낆썝-?섏닠 ??二쇱쓽?ы빆',
        url: 'local://docs/%EC%9E%85%EC%9B%90-%EC%88%98%EC%88%A0%20%ED%9B%84%20%EC%A3%BC%EC%9D%98%EC%82%AC%ED%95%AD.txt',
      },
      {
        title: '?낆썝-?낆썝?앺솢?덈궡臾?',
        url: 'local://docs/%EC%9E%85%EC%9B%90-%EC%9E%85%EC%9B%90%EC%83%9D%ED%99%9C%EC%95%88%EB%82%B4%EB%AC%B8.txt',
      },
    ],
  };
}

function createSurgeryCostResponse() {
  return {
    type: 'surgery_cost',
    answer: `수술 금액은 수술 종류, 질환명, 보험 적용 여부에 따라 달라서 한 가지 금액으로 안내하기 어렵습니다. 문서 기준으로는 질환별 홈페이지에 수술비용 범위가 안내되어 있고, 자세한 기준은 비급여 안내 페이지에서 다시 확인하실 수 있습니다.\n\n비급여 안내 페이지: ${NONPAY_PAGE_URL}`,
    followUp: [
      '어떤 수술인지 알려주시면 비염, 비중격만곡증, 편도, 축농증처럼 해당 질환 기준 문서로 다시 안내해 드릴 수 있습니다.',
      '대표전화 02-6925-1111로 문의하면 보험 적용 여부와 함께 더 정확한 안내를 받을 수 있습니다.',
      '질환별 안내 금액은 환자 상태와 적용 기준에 따라 실제 진료 시 달라질 수 있습니다.',
    ],
    sources: [
      {
        title: '기타-비급여비용',
        url: `local://docs/${encodeURIComponent(path.basename(CERTIFICATE_FEES_DOC_PATH || '기타-비급여비용.txt'))}`,
      },
      {
        title: '비급여 안내 페이지',
        url: NONPAY_PAGE_URL,
      },
    ],
  };
}

function createSameDayExamAvailabilityResponse() {
  return {
    type: 'same_day_exam_availability',
    answer: '문서 기준으로 하나이비인후과병원은 원스톱 시스템을 운영해 대부분의 검사를 진료 당일 1~2시간 이내에 진행하고 결과를 확인할 수 있다고 안내되어 있습니다. 다만 귀 검사는 진행 상황에 따라 예약 검사로 바뀔 수 있고, 코골이·수면무호흡 검사는 1박 2일 입원으로 진행됩니다.',
    followUp: [
      '코 검사는 약 20분 정도 소요되고 당일 결과 확인이 가능하다고 안내되어 있습니다.',
      '귀 검사는 당일 검사와 결과 상담이 원칙이지만 상황에 따라 예약으로 진행될 수 있습니다.',
      '정확한 검사 가능 여부는 내원 전 대표전화 02-6925-1111로 확인하시면 가장 안전합니다.',
    ],
    sources: [{
      title: 'FAQ',
      url: LOCAL_FAQ_URL,
    }],
  };
}

function createReceiptIssuanceResponse() {
  return {
    type: 'receipt_issuance',
    answer: '영수증과 진료상세내역 같은 서류는 외래에서는 원무과에서 본인 확인 후 발급받으시면 됩니다. 입원 환자는 퇴원 하루 전 주치의나 병동 간호사에게 미리 신청서를 제출하고, 퇴원 수납 시 원무과에서 서류를 받는 방식으로 안내되어 있습니다.',
    followUp: [
      '퇴원 후에는 외래 방문 시 다시 신청할 수 있습니다.',
      '환자 본인 외 발급은 동의서, 신분증 사본, 관계증명서류 또는 위임장 같은 구비서류가 필요할 수 있습니다.',
      '정확한 발급 가능 여부는 대표전화 02-6925-1111로 먼저 확인하시면 가장 안전합니다.',
    ],
    sources: [
      {
        title: 'FAQ',
        url: LOCAL_FAQ_URL,
      },
      {
        title: '홈페이지-입퇴원 안내',
        url: 'local://docs/%ED%99%88%ED%8E%98%EC%9D%B4%EC%A7%80-%EC%9E%85%ED%87%B4%EC%9B%90%20%EC%95%88%EB%82%B4.txt',
      },
    ],
  };
}

function createTypedPostOpCareResponse(kind) {
  const source = {
    title: '?낆썝-?섏닠 ??二쇱쓽?ы빆',
    url: 'local://docs/%EC%9E%85%EC%9B%90-%EC%88%98%EC%88%A0%20%ED%9B%84%20%EC%A3%BC%EC%9D%98%EC%82%AC%ED%95%AD.txt',
  };

  const responses = {
    nose: {
      type: 'postop_care_nose',
      answer: '코 수술 후 주의사항 안내드립니다. 문서 기준으로 수술 후 1~3개월 정도 외래 통원치료가 필요할 수 있고, 처음 1~2주 정도는 코를 세게 풀거나 코를 건드리는 행동을 피하는 것이 좋습니다. 코세척 후에도 코를 무리하게 자극하지 말고, 출혈이 있거나 응급치료가 필요하면 02-6925-1111로 바로 연락해 주세요.',
      followUp: [
        '최소 2주간은 사우나, 심한 운동, 무리한 야외활동을 피하는 쪽으로 안내되어 있습니다.',
        '수영은 최소 4주 정도 피하고, 금연·금주는 최소 2개월 정도 권고됩니다.',
        '비행기 탑승은 수술 후 약 1개월간 피하는 쪽으로 안내되어 있습니다.',
      ],
      sources: [source],
    },
    throat: {
      type: 'postop_care_throat',
      answer: '목 수술 후 주의사항 안내드립니다. 문서 기준으로 상처가 안정될 때까지 2~3주 정도는 너무 뜨겁거나 자극적인 음식, 딱딱한 음식보다 부드러운 음식 위주로 드시는 것이 좋습니다. 출혈 예방을 위해 빨대 사용은 피하고, 피가 계속 섞여 나오거나 양이 많으면 병원에 연락 후 진료를 받으셔야 합니다.',
      followUp: [
        '수술 후 5~10일 정도까지 출혈 가능성이 있어 침에 피가 계속 섞이거나 선홍색 출혈이 많으면 바로 확인이 필요합니다.',
        '수술 후 1~2주 정도는 심한 운동이나 무리한 야외활동을 피하고 충분히 쉬는 것이 좋습니다.',
        '통증이나 출혈감이 있을 때는 시원한 얼음물로 잠깐 가글하는 방법이 안내되어 있습니다.',
      ],
      sources: [source],
    },
    ear: {
      type: 'postop_care_ear',
      answer: '귀 수술 후 주의사항 안내드립니다. 문서 기준으로 수술 부위를 부딪치지 않도록 조심하고, 코를 세게 풀거나 무거운 물건을 드는 행동은 피하는 것이 좋습니다. 재채기나 기침을 할 때는 입을 벌리고 하고, 머리를 감을 때도 수술 부위가 자극되지 않게 주의해 주세요.',
      followUp: [
        '누런 고름 같은 분비물이 나오거나 어지럼이 계속되면 내원 확인이 필요합니다.',
        '갑자기 입이 돌아가는 느낌 같은 안면마비 증상이 있으면 바로 병원에 연락하셔야 합니다.',
        '기타 출혈이나 응급치료가 필요하면 02-6925-1111로 연락하도록 안내되어 있습니다.',
      ],
      sources: [source],
    },
    thyroid: {
      type: 'postop_care_thyroid',
      answer: '갑상선 수술 후 주의사항 안내드립니다. 문서 기준으로 수술 후 2~3일 정도는 목과 어깨 움직임을 조심하고, 무리한 목 운동이나 강한 활동은 피하는 것이 좋습니다. 일상생활은 가능하지만 강도가 높은 운동이나 무거운 물건을 드는 행동은 약 4주 정도 피하도록 안내되어 있습니다.',
      followUp: [
        '샤워는 보통 수술 후 3~5일 뒤부터 가능하다고 안내되어 있습니다.',
        '목의 당김감, 삼킴 불편감, 수술 부위 감각 이상은 일시적으로 느껴질 수 있습니다.',
        '상처 회복 기간에는 금연·금주가 권고됩니다.',
      ],
      sources: [source],
    },
    salivary: {
      type: 'postop_care_salivary',
      answer: '침샘 수술 후 주의사항 안내드립니다. 문서 기준으로 수술 부위와 귀 주변을 긁거나 자극하지 말고, 처음 2주 정도는 부드럽고 자극이 적은 음식 위주로 드시는 것이 좋습니다. 수술 부위 붓기는 있을 수 있지만 심해지거나 열이 나면 병원 확인이 필요합니다.',
      followUp: [
        '비행기 탑승은 보통 수술 후 3~4주 뒤부터 가능하다고 안내되어 있습니다.',
        '실밥 제거 전후 상처 관리와 샤워 시점은 문서 기준에 맞춰 조심해서 진행해야 합니다.',
        '무거운 물건을 들거나 강한 운동은 약 4주 정도 피하고, 가벼운 걷기 정도부터 시작하는 것이 좋습니다.',
      ],
      sources: [source],
    },
  };

  return responses[kind] || null;
}

function findPostOpCareResponse(message) {
  const text = String(message || '');
  if (!matchesAnyPattern(text, postOpCarePatterns)) {
    return null;
  }

  if (/(코|비염|축농증|비중격|코물혹)/u.test(text)) {
    return createTypedPostOpCareResponse('nose');
  }

  if (/(목|편도)/u.test(text)) {
    return createTypedPostOpCareResponse('throat');
  }

  if (/귀/u.test(text)) {
    return createTypedPostOpCareResponse('ear');
  }

  if (/갑상선/u.test(text)) {
    return createTypedPostOpCareResponse('thyroid');
  }

  if (/(침샘|이하선|악하선)/u.test(text)) {
    return createTypedPostOpCareResponse('salivary');
  }

  return null;
}

function createComplaintGuideResponse() {
  return {
    type: 'complaint_guide',
    answer: '불만, 고충, 컴플레인 관련 의견은 고객 의견함, 퇴원 시 설문, 병원 홈페이지 고객소리함, 전화로 접수하실 수 있습니다.',
    followUp: [
      '고객 의견함은 1층, 2층, 4층, 5층에 있습니다.',
      '퇴원 시 설문을 통해서도 의견을 남기실 수 있습니다.',
      '병원 홈페이지 고객소리함 또는 전화 3002로 알려 주세요.',
    ],
    sources: [{
      title: '입원-입원생활안내문',
      url: 'local://docs/%EC%9E%85%EC%9B%90-%EC%9E%85%EC%9B%90%EC%83%9D%ED%99%9C%EC%95%88%EB%82%B4%EB%AC%B8.txt',
    }],
  };
}

function createGuardianShiftResponse() {
  return {
    type: 'guardian_shift',
    answer: '상주 보호자 교대는 가능합니다. 다만 간호간병통합서비스 병동 특성상 보호자 상주는 원칙적으로 제한되며, 불가피하게 상주가 허용된 경우에도 치료와 감염 예방을 위해 꼭 필요한 경우에만 교대해 주셔야 합니다.',
    followUp: [
      '보호자 상주가 필요한 경우에는 의료진 판단에 따라 한시적으로 허용됩니다.',
      '교대가 필요한 상황이면 병동에서 현재 안내 기준을 함께 확인해 주세요.',
    ],
    sources: [{
      title: '입원-입원생활안내문',
      url: 'local://docs/%EC%9E%85%EC%9B%90-%EC%9E%85%EC%9B%90%EC%83%9D%ED%99%9C%EC%95%88%EB%82%B4%EB%AC%B8.txt',
    }],
  };
}

function createWifiResponse() {
  return {
    type: 'wifi_info',
    answer: '와이파이 비밀번호는 HANA로 시작하는 0269251111입니다.',
    followUp: [
      '모든 층에서 동일하게 안내됩니다.',
    ],
    sources: [],
  };
}

function createHospitalPhoneResponse() {
  return {
    type: 'hospital_phone',
    answer: '하나이비인후과병원 대표전화는 02-6925-1111입니다.',
    followUp: [
      '전화 예약이나 예약 변경은 대표전화 연결 후 안내받을 수 있습니다.',
    ],
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

function createFallbackInsufficientEvidenceResponse(contextTitles) {
  return {
    type: 'fallback_insufficient_evidence',
    answer: '현재 확인된 홈페이지 내용만으로는 정확한 안내가 어렵습니다. 대표전화 02-6925-1111로 확인해 주세요.',
    followUp: contextTitles.length > 0 ? contextTitles : ['진료시간 안내', '의료진 일정', '서류 발급 안내'],
  };
}

function createFallbackNeedsClarificationResponse() {
  return {
    type: 'fallback_needs_clarification',
    answer: '질문 범위가 넓어 바로 안내드리기 어렵습니다. 어떤 항목이 궁금하신지 조금만 더 구체적으로 알려주시면 정확히 안내드릴게요.',
    followUp: ['수술 종류를 알려주세요', '검사 종류를 알려주세요', '외래인지 입원인지 알려주세요'],
  };
}

function createFallbackInferenceResponse() {
  return {
    type: 'fallback_inference',
    answer: '문서상 관련 단서는 확인되지만 직접 명시된 안내는 아니라 정확히 단정하기는 어렵습니다. 정확한 운영 방식은 병동 또는 대표전화 02-6925-1111로 확인해 주세요.',
    followUp: ['문서에 나온 관련 항목을 기준으로 안내드렸습니다', '운영 방식은 시점에 따라 달라질 수 있습니다'],
  };
}

function createFallbackRestrictedResponse() {
  return {
    type: 'fallback_restricted',
    answer: '이 부분은 상담봇에서 판단해 드릴 수 없습니다. 의료진 또는 병원으로 직접 확인해 주세요.',
    followUp: ['대표전화 02-6925-1111', '진료과 또는 의료진 상담 권장'],
  };
}

function hasIndirectOperationalEvidence(message) {
  const normalizedMessage = normalizeSearchTextSafe(message);
  const compactMessage = compactSearchTextSafe(message);
  if (!normalizedMessage) {
    return false;
  }

  if (normalizedMessage.includes('보호자') && (normalizedMessage.includes('식사') || normalizedMessage.includes('식대') || normalizedMessage.includes('밥'))) {
    return readNonpayDocLines().some((line) => compactSearchTextSafe(line).includes(compactSearchTextSafe('보호자 식대')));
  }

  return (runtimeData.nonpayItemEntries || []).some((entry) => (
    (entry.aliases || []).some((alias) => (
      normalizedMessage.includes(normalizeSearchTextSafe(alias))
      || compactMessage.includes(compactSearchTextSafe(alias))
    ))
  ));
}

function getFallbackType(message) {
  const text = String(message || '').trim();
  if (!text) {
    return 'insufficient_evidence';
  }

  if (
    matchesAnyPattern(String(text || '').toLowerCase(), medicalRestrictionPatterns)
    && !matchesAnyPattern(text, certificateDocumentQuestionPatterns)
  ) {
    return 'restricted';
  }

  if (
    ((/수술|검사|서류|비용|금액/u.test(text)) && text.length <= 14)
    || /^(수술|검사|서류|비용|금액).{0,4}(알려줘|안내|설명)$/u.test(text)
  ) {
    return 'needs_clarification';
  }

  if (hasIndirectOperationalEvidence(text)) {
    return 'inference';
  }

  return 'insufficient_evidence';
}

function createFallbackResponse(message, contextTitles = []) {
  const fallbackType = getFallbackType(message);

  if (fallbackType === 'restricted') {
    return createFallbackRestrictedResponse();
  }

  if (fallbackType === 'needs_clarification') {
    return createFallbackNeedsClarificationResponse();
  }

  if (fallbackType === 'inference') {
    return createFallbackInferenceResponse();
  }

  return createFallbackInsufficientEvidenceResponse(contextTitles);
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

function buildNonpayItemEntries() {
  if (!CERTIFICATE_FEES_DOC_PATH || !fs.existsSync(CERTIFICATE_FEES_DOC_PATH)) {
    return [];
  }

  const rawLines = fs.readFileSync(CERTIFICATE_FEES_DOC_PATH, 'utf8')
    .split(/\r?\n/)
    .map((line) => String(line || '').replace(/\r/g, '').trim())
    .filter(Boolean);

  const configs = [
    {
      key: 'oxygen_therapy',
      title: '산소치료',
      aliases: ['산소치료', '고압산소', '고압산소치료'],
      matcher: (line) => compactSearchTextSafe(line).includes(compactSearchTextSafe('산소치료')),
    },
    {
      key: 'flu_shot',
      title: '독감주사',
      aliases: ['독감주사', '독감 예방접종', '독감예방접종', '독감백신', '플루아릭스테트라'],
      matcher: (line) => {
        const normalized = compactSearchTextSafe(line);
        return (
          normalized.includes(compactSearchTextSafe('독감 예방접종'))
          || normalized.includes(compactSearchTextSafe('독감예방접종'))
          || normalized.includes(compactSearchTextSafe('플루아릭스테트라'))
        );
      },
    },
  ];

  return configs.map((config) => {
    const matchedLine = rawLines.find((line) => config.matcher(line));
    if (!matchedLine) {
      return null;
    }

    return {
      key: config.key,
      title: config.title,
      aliases: config.aliases,
      price: extractPriceText(matchedLine),
      line: matchedLine,
    };
  }).filter((entry) => entry && entry.price);
}

function buildFloorGuideIndex() {
  const index = {
    byRoomNumber: new Map(),
    byFloorLabel: new Map(),
  };

  if (!fs.existsSync(FLOOR_GUIDE_DOC_PATH)) {
    return index;
  }

  const lines = fs.readFileSync(FLOOR_GUIDE_DOC_PATH, 'utf8')
    .split(/\r?\n/)
    .map((line) => String(line || '').trim())
    .filter(Boolean);

  lines.forEach((line) => {
    const floorMatch = line.match(/(지하\s*\d+\s*층|\d+\s*층)/u);
    if (!floorMatch) {
      return;
    }

    const floorLabel = floorMatch[1].replace(/\s+/g, '');
    const floorNumberMatch = floorLabel.match(/(\d+)/);
    const floor = floorNumberMatch ? Number(floorNumberMatch[1]) : 0;
    index.byFloorLabel.set(floorLabel, {
      floor,
      line,
    });

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

  const floorLabelMatch = String(message || '').match(/(지하\s*\d+\s*층|\d+\s*층)/u);
  if (floorLabelMatch) {
    const floorLabel = floorLabelMatch[1].replace(/\s+/g, '');
    const floorInfo = runtimeData.floorGuideIndex.byFloorLabel.get(floorLabel);
    if (floorInfo) {
      return {
        type: 'floor_guide',
        answer: `${floorLabel}에는 ${floorInfo.line.replace(/^지하\s*\d+\s*층|\d+\s*층/u, '').trim()}가 있습니다.`,
        followUp: [
          '다른 층 안내가 필요하면 1층, 2층, 3층처럼 다시 질문해 주세요.',
        ],
        sources: [{
          title: '기타-층별안내도',
          url: `local://docs/${encodeURIComponent(path.basename(FLOOR_GUIDE_DOC_PATH))}`,
        }],
      };
    }
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

const HOMEPAGE_SURGERY_DOC_CONFIGS = [
  { disease: '비염', aliases: ['비염', '비염수술', '만성비염', '만성비염수술', '알레르기비염', '알레르기비염수술'], filename: '홈페이지-만성비염.txt' },
  { disease: '축농증', aliases: ['축농증', '축농증수술', '부비동염', '부비동염수술', '부비동수술'], filename: '홈페이지-축농증.txt' },
  { disease: '편도', aliases: ['편도', '편도수술', '편도절제술'], filename: '홈페이지-편도.txt' },
  { disease: '비중격만곡증', aliases: ['비중격만곡증', '비중격만곡증수술', '비중격', '비중격수술'], filename: '홈페이지-비중격만곡증.txt' },
  { disease: '코물혹', aliases: ['코물혹', '비용종', '비강용종'], filename: '홈페이지-코물혹.txt' },
  { disease: '중이염', aliases: ['중이염', '만성중이염'], filename: '홈페이지-만성중이염.txt' },
  { disease: '갑상선', aliases: ['갑상선'], filename: '홈페이지-갑상선.txt' },
  { disease: '침샘', aliases: ['침샘', '이하선', '악하선'], filename: '홈페이지-침샘.txt' },
];

function findMatchedHomepageSurgeryDocConfig(message) {
  const normalizedMessage = normalizeSearchTextSafe(message);
  const compactMessage = compactSearchTextSafe(message);

  if (!normalizedMessage) {
    return null;
  }

  return HOMEPAGE_SURGERY_DOC_CONFIGS.find((config) => (
    config.aliases.some((alias) => {
      const normalizedAlias = normalizeSearchTextSafe(alias);
      const compactAlias = compactSearchTextSafe(alias);
      return normalizedMessage.includes(normalizedAlias) || compactMessage.includes(compactAlias);
    })
  )) || null;
}

function normalizeDocLine(line) {
  return String(line || '')
    .replace(/\t+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractHomepageSurgerySectionLines(text, labels, stopLabels) {
  const normalizedLabels = labels.map((label) => normalizeSearchTextSafe(label));
  const normalizedStopLabels = stopLabels.map((label) => normalizeSearchTextSafe(label));
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => normalizeDocLine(line))
    .filter(Boolean);
  const startIndex = lines.findIndex((line) => {
    const normalizedLine = normalizeSearchTextSafe(line);
    return normalizedLabels.some((label) => normalizedLine === label || normalizedLine.includes(label));
  });

  if (startIndex === -1) {
    return [];
  }

  const collected = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const normalizedLine = normalizeSearchTextSafe(line);
    if (
      normalizedStopLabels.some((label) => normalizedLine === label || normalizedLine.includes(label))
      || normalizedLine.includes('장점')
    ) {
      break;
    }
    collected.push(line);
    if (collected.length >= 3) {
      break;
    }
  }

  return collected;
}

function findHomepageSurgeryCostResponse(message) {
  if (!/(수술|절제술)/u.test(String(message || '')) || !/(비용|금액|가격|얼마)/u.test(String(message || ''))) {
    return null;
  }

  const matchedConfig = findMatchedHomepageSurgeryDocConfig(message);

  if (!matchedConfig) {
    return null;
  }

  const docPath = path.join(DOCS_DIR, matchedConfig.filename);
  if (!fs.existsSync(docPath)) {
    return null;
  }

  const text = fs.readFileSync(docPath, 'utf8');
  const stopLabels = ['수술비용', '수술시간', '마취방법', '입원기간', '내원치료', '회복기간', '치료 장점'];
  const costLines = extractHomepageSurgerySectionLines(text, ['수술비용'], stopLabels);
  const timeLines = extractHomepageSurgerySectionLines(text, ['수술시간'], stopLabels);
  const anesthesiaLines = extractHomepageSurgerySectionLines(text, ['마취방법'], stopLabels);
  const admissionLines = extractHomepageSurgerySectionLines(text, ['입원기간'], stopLabels);
  const followupLines = extractHomepageSurgerySectionLines(text, ['내원치료'], stopLabels);
  const recoveryLines = extractHomepageSurgerySectionLines(text, ['회복기간'], stopLabels);

  if (costLines.length === 0) {
    return null;
  }

  const [costValue, ...costExtras] = costLines;
  const cleanedCostExtras = costExtras
    .map((line) => String(line || '').replace(/^\(+/, '').replace(/\)+$/, '').trim())
    .filter(Boolean);
  const sentences = [
    `${matchedConfig.disease} 수술 안내드립니다.`,
    `하나이비인후과병원 기준으로 수술비용은 ${costValue}${cleanedCostExtras.length > 0 ? `(${cleanedCostExtras.join(', ')})` : ''}입니다.`,
  ];

  if (timeLines.length > 0) {
    sentences.push(`수술시간은 ${timeLines.join(' ')}입니다.`);
  }

  if (anesthesiaLines.length > 0) {
    sentences.push(`마취는 ${anesthesiaLines.join(' ')}입니다.`);
  }

  if (admissionLines.length > 0) {
    sentences.push(`입원기간은 ${admissionLines.join(' ')}입니다.`);
  }

  if (followupLines.length > 0) {
    sentences.push(`수술 후 내원치료는 ${followupLines.join(' ')}입니다.`);
  }

  if (recoveryLines.length > 0) {
    sentences.push(`회복기간은 ${recoveryLines.join(' ')}입니다.`);
  }

  sentences.push('정확한 수술 적응증과 비용 방법은 진찰과 검사 후 결정되니 자세한 상담이나 예약은 대표전화 02-6925-1111로 문의해 주세요.');

  return {
    type: 'homepage_surgery_cost',
    answer: sentences.join(' '),
    followUp: [
      '보험 적용 여부와 실제 비용은 질환 상태와 검사 결과에 따라 달라질 수 있습니다.',
      '다른 수술도 질환명을 알려주시면 해당 문서 기준으로 다시 안내해 드릴 수 있습니다.',
    ],
    sources: [{
      title: path.parse(matchedConfig.filename).name,
      url: `local://docs/${encodeURIComponent(matchedConfig.filename)}`,
    }],
  };
}

function findHomepageSurgeryInfoResponse(message) {
  const text = String(message || '');
  if (!/(수술|절제술)/u.test(text)) {
    return null;
  }

  if (/(비용|금액|가격|얼마)/u.test(text)) {
    return null;
  }

  const matchedConfig = findMatchedHomepageSurgeryDocConfig(text);
  if (!matchedConfig) {
    return null;
  }

  const docPath = path.join(DOCS_DIR, matchedConfig.filename);
  if (!fs.existsSync(docPath)) {
    return null;
  }

  const docText = fs.readFileSync(docPath, 'utf8');
  const stopLabels = ['수술비용', '수술시간', '마취방법', '입원기간', '내원치료', '회복기간', '치료 장점'];
  const costLines = extractHomepageSurgerySectionLines(docText, ['수술비용'], stopLabels);
  const timeLines = extractHomepageSurgerySectionLines(docText, ['수술시간'], stopLabels);
  const anesthesiaLines = extractHomepageSurgerySectionLines(docText, ['마취방법'], stopLabels);
  const admissionLines = extractHomepageSurgerySectionLines(docText, ['입원기간'], stopLabels);
  const followupLines = extractHomepageSurgerySectionLines(docText, ['내원치료'], stopLabels);
  const recoveryLines = extractHomepageSurgerySectionLines(docText, ['회복기간'], stopLabels);

  if (
    costLines.length === 0
    && timeLines.length === 0
    && anesthesiaLines.length === 0
    && admissionLines.length === 0
  ) {
    return null;
  }

  const sentences = [`${matchedConfig.disease} 수술 안내드립니다.`];

  if (costLines.length > 0) {
    const [costValue, ...costExtras] = costLines;
    const cleanedCostExtras = costExtras
      .map((line) => String(line || '').replace(/^\(+/, '').replace(/\)+$/, '').trim())
      .filter(Boolean);
    sentences.push(`수술비용은 ${costValue}${cleanedCostExtras.length > 0 ? `(${cleanedCostExtras.join(', ')})` : ''}입니다.`);
  }

  if (timeLines.length > 0) {
    sentences.push(`수술시간은 ${timeLines.join(' ')}입니다.`);
  }

  if (anesthesiaLines.length > 0) {
    sentences.push(`마취방법은 ${anesthesiaLines.join(' ')}입니다.`);
  }

  if (admissionLines.length > 0) {
    sentences.push(`입원기간은 ${admissionLines.join(' ')}입니다.`);
  }

  if (followupLines.length > 0) {
    sentences.push(`수술 후 내원치료는 ${followupLines.join(' ')}입니다.`);
  }

  if (recoveryLines.length > 0) {
    sentences.push(`회복기간은 ${recoveryLines.join(' ')}입니다.`);
  }

  sentences.push('정확한 수술 적응증과 방법은 진찰과 검사 후 결정되니 자세한 상담이나 예약은 대표전화 02-6925-1111로 문의해 주세요.');

  return {
    type: 'homepage_surgery_info',
    answer: sentences.join(' '),
    followUp: [
      '궁금한 수술을 더 구체적으로 말씀해 주시면 비용, 입원기간, 회복기간 기준으로 다시 안내해 드릴 수 있습니다.',
      '보험 적용 여부와 실제 비용은 질환 상태와 검사 결과에 따라 달라질 수 있습니다.',
    ],
    sources: [{
      title: path.parse(matchedConfig.filename).name,
      url: `local://docs/${encodeURIComponent(matchedConfig.filename)}`,
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

function findNonpayItemResponse(message) {
  const normalizedMessage = normalizeSearchTextSafe(message);
  const compactMessage = compactSearchTextSafe(message);
  if (!normalizedMessage) {
    return null;
  }

  if (!/(비용|금액|가격|얼마)/u.test(message)) {
    return null;
  }

  const matchedEntry = (runtimeData.nonpayItemEntries || []).find((entry) => (
    (entry.aliases || []).some((alias) => {
      const normalizedAlias = normalizeSearchTextSafe(alias);
      const compactAlias = compactSearchTextSafe(alias);
      return normalizedMessage.includes(normalizedAlias) || compactMessage.includes(compactAlias);
    })
  ));

  if (!matchedEntry) {
    return null;
  }

  return {
    type: 'nonpay_item_fee',
    answer: `${matchedEntry.title} 비용은 ${matchedEntry.price}원입니다.`,
    followUp: [
      '기준 문서: 기타-비급여비용.txt',
      '세부 적용 기준이나 변경 여부는 대표전화 02-6925-1111로 다시 확인해 주세요.',
      `비급여 안내 페이지: ${NONPAY_PAGE_URL}`,
    ],
    sources: [
      {
        title: '기타-비급여비용',
        url: `local://docs/${encodeURIComponent(path.basename(CERTIFICATE_FEES_DOC_PATH || '기타-비급여비용.txt'))}`,
      },
      {
        title: '비급여 안내 페이지',
        url: NONPAY_PAGE_URL,
      },
    ],
  };
}

function findSingleRoomFeeResponse(message) {
  const text = String(message || '');
  const normalizedMessage = normalizeSearchTextSafe(text);
  const compactMessage = compactSearchTextSafe(text);

  if (!normalizedMessage) {
    return null;
  }

  const asksFee = /(비용|금액|가격|얼마)/u.test(text);
  const asksSingleRoom = /(1인실|일인실)/u.test(text);

  if (!asksFee || !asksSingleRoom) {
    return null;
  }

  if (!CERTIFICATE_FEES_DOC_PATH || !fs.existsSync(CERTIFICATE_FEES_DOC_PATH)) {
    return null;
  }

  const rawLines = fs.readFileSync(CERTIFICATE_FEES_DOC_PATH, 'utf8')
    .split(/\r?\n/)
    .map((line) => String(line || '').replace(/\r/g, '').trim())
    .filter(Boolean);

  const oneNightLine = rawLines.find((line) => {
    const compactLine = compactSearchTextSafe(line);
    return compactLine.includes(compactSearchTextSafe('1인실')) && compactLine.includes(compactSearchTextSafe('1박'));
  });

  const sameDayLine = rawLines.find((line) => {
    const compactLine = compactSearchTextSafe(line);
    return compactLine.includes(compactSearchTextSafe('1인실')) && compactLine.includes(compactSearchTextSafe('당일퇴원'));
  });

  const oneNightPrice = extractPriceText(oneNightLine);
  const sameDayPrice = extractPriceText(sameDayLine);

  if (!oneNightPrice && !sameDayPrice) {
    return null;
  }

  const mentionsSameDay = normalizedMessage.includes('당일퇴원') || compactMessage.includes(compactSearchTextSafe('당일퇴원'));
  const answer = mentionsSameDay && sameDayPrice
    ? `1인실(당일퇴원) 비용은 ${sameDayPrice}원입니다.`
    : `1인실 비용은 ${oneNightPrice}원이며, 당일퇴원 1인실 비용은 ${sameDayPrice}원입니다.`;

  return {
    type: 'single_room_fee',
    answer,
    followUp: [
      '기준 문서: 기타-비급여비용.txt',
      '입원 형태나 적용 기준에 따라 실제 안내는 달라질 수 있으니 대표전화 02-6925-1111로 다시 확인해 주세요.',
      `비급여 안내 페이지: ${NONPAY_PAGE_URL}`,
    ],
    sources: [
      {
        title: '기타-비급여비용',
        url: `local://docs/${encodeURIComponent(path.basename(CERTIFICATE_FEES_DOC_PATH || '기타-비급여비용.txt'))}`,
      },
      {
        title: '비급여 안내 페이지',
        url: NONPAY_PAGE_URL,
      },
    ],
  };
}

function readNonpayDocLines() {
  if (!CERTIFICATE_FEES_DOC_PATH || !fs.existsSync(CERTIFICATE_FEES_DOC_PATH)) {
    return [];
  }

  return fs.readFileSync(CERTIFICATE_FEES_DOC_PATH, 'utf8')
    .split(/\r?\n/)
    .map((line) => String(line || '').replace(/\r/g, '').trim())
    .filter(Boolean);
}

function findOperationalInferenceResponse(message) {
  const text = String(message || '').trim();
  const normalizedMessage = normalizeSearchTextSafe(text);
  const compactMessage = compactSearchTextSafe(text);

  if (!normalizedMessage) {
    return null;
  }

  const asksAvailability = /(가능|되나|되나요|있나|있나요|할 수|먹을 수|신청|되는지)/u.test(text);
  if (!asksAvailability) {
    return null;
  }

  if (/(보호자).{0,8}(식사|식대|밥)/u.test(text)) {
    const matchedLine = readNonpayDocLines().find((line) => (
      compactSearchTextSafe(line).includes(compactSearchTextSafe('보호자 식대'))
    ));

    if (!matchedLine) {
      return null;
    }

    const price = extractPriceText(matchedLine);

    return {
      type: 'operational_inference',
      answer: price
        ? `비급여비용 문서에 보호자 식대 ${price}원 항목이 있어 보호자 식사가 제공되거나 신청 가능한 운영일 가능성이 높습니다. 다만 문서에 신청 방법이나 제공 기준이 직접 적혀 있지는 않아 정확한 운영 방식은 병동 또는 대표전화 02-6925-1111로 확인해 주세요.`
        : '비급여비용 문서에 보호자 식대 항목이 있어 보호자 식사가 제공되거나 신청 가능한 운영일 가능성이 높습니다. 다만 문서에 신청 방법이나 제공 기준이 직접 적혀 있지는 않아 정확한 운영 방식은 병동 또는 대표전화 02-6925-1111로 확인해 주세요.',
      followUp: [
        `문서 근거: ${matchedLine}`,
        '이 답변은 문서의 간접 근거를 바탕으로 한 추정입니다.',
        '정확한 신청 방법이나 제공 기준은 병동 또는 대표전화 02-6925-1111로 확인해 주세요.',
      ],
      sources: [{
        title: '기타-비급여비용',
        url: `local://docs/${encodeURIComponent(path.basename(CERTIFICATE_FEES_DOC_PATH || '기타-비급여비용.txt'))}`,
      }],
    };
  }

  const matchedEntry = (runtimeData.nonpayItemEntries || []).find((entry) => (
    (entry.aliases || []).some((alias) => {
      const normalizedAlias = normalizeSearchTextSafe(alias);
      const compactAlias = compactSearchTextSafe(alias);
      return normalizedMessage.includes(normalizedAlias) || compactMessage.includes(compactAlias);
    })
  ));

  if (!matchedEntry) {
    return null;
  }

  return {
    type: 'operational_inference',
    answer: `비급여비용 문서에 ${matchedEntry.title} 비용 항목이 있어 해당 서비스는 운영 중일 가능성이 높습니다. 다만 이용 기준이나 적용 대상은 문서에 직접 정리돼 있지 않을 수 있어 정확한 운영 방식은 대표전화 02-6925-1111로 확인해 주세요.`,
    followUp: [
      `문서 근거: ${matchedEntry.line}`,
      '이 답변은 문서의 간접 근거를 바탕으로 한 추정입니다.',
      `비급여 안내 페이지: ${NONPAY_PAGE_URL}`,
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

function isNasalIrrigationQuestion(question) {
  const value = String(question || '').trim();

  if (!value) {
    return false;
  }

  return NASAL_IRRIGATION_QUERY_PATTERNS.some((pattern) => pattern.test(value));
}

function isNasalIrrigationDoc(doc) {
  const normalizedTitle = normalizeSearchTextSafe(`${doc?.title || ''} ${doc?.sourceTitle || ''}`);
  const compactTitle = compactSearchTextSafe(`${doc?.title || ''} ${doc?.sourceTitle || ''}`);

  return NASAL_IRRIGATION_DOC_NAMES.some((name) => {
    const normalizedName = normalizeSearchTextSafe(name);
    const compactName = compactSearchTextSafe(name);
    return normalizedTitle.includes(normalizedName) || compactTitle.includes(compactName);
  });
}

function isMedicationStopImageGuide(guide) {
  const pathValue = String(guide?.path || '');
  return pathValue.includes(MEDICATION_STOP_IMAGE_PATH_FRAGMENT);
}

function isMedicationStopQuestion(question) {
  const value = String(question || '').trim();
  const normalizedValue = normalizeSearchTextSafe(value);
  const compactValue = compactSearchTextSafe(value);

  if (!value) {
    return false;
  }

  if (MEDICATION_STOP_DIRECT_QUERY_PATTERNS.some((pattern) => pattern.test(value))) {
    return true;
  }

  const hasPrepContext = MEDICATION_STOP_PREP_QUERY_PATTERNS.some((pattern) => pattern.test(value));
  const hasMedicationTerm = MEDICATION_STOP_MEDICATION_QUERY_PATTERNS.some((pattern) => pattern.test(value));
  const hasStopAction = MEDICATION_STOP_ACTION_QUERY_PATTERNS.some((pattern) => pattern.test(value));

  if (
    normalizedValue.includes('입원전 복용중단 약물 리스트')
    || normalizedValue.includes('입원 전 복용중단 약물 리스트')
    || compactValue.includes('입원전복용중단약물리스트')
  ) {
    return true;
  }

  if (
    hasPrepContext
    && hasMedicationTerm
    && (
      normalizedValue.includes('하면 안되는')
      || normalizedValue.includes('먹으면 안되는')
      || normalizedValue.includes('복용 하면 안되는')
      || normalizedValue.includes('복용하면 안되는')
    )
  ) {
    return true;
  }

  return hasPrepContext && hasMedicationTerm && hasStopAction;
}

function prioritizeDocumentsForQuestion(question, rankedDocs, allDocs, limit = 7) {
  if (!isNasalIrrigationQuestion(question)) {
    return rankedDocs.slice(0, limit);
  }

  const prioritizedDocs = allDocs
    .filter((doc) => isNasalIrrigationDoc(doc))
    .sort((a, b) => (b.score || 0) - (a.score || 0));
  const merged = [];
  const seen = new Set();

  [...prioritizedDocs, ...rankedDocs].forEach((doc) => {
    const key = `${doc.url}::${doc.chunkLabel || ''}::${doc.text}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    merged.push(doc);
  });

  return merged.slice(0, limit);
}

function rankDocuments(question, docs, limit = 7) {
  const expandedSearchState = buildExpandedSearchState(question);
  const matchedDiseaseTerms = getMatchedHomepageDiseaseTerms(question);
  const normalizedQuestion = normalizeSearchTextSafe(question);
  const compactQuestion = compactSearchTextSafe(question);
  const tokens = expandedSearchState.tokens;
  const normalizedQuestionVariants = expandedSearchState.normalizedVariants;
  const compactQuestionVariants = expandedSearchState.compactVariants;
  const shouldPrioritizeNasalIrrigation = isNasalIrrigationQuestion(question);

  const rankedDocs = docs
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
      const nasalIrrigationDocBonus = shouldPrioritizeNasalIrrigation && isNasalIrrigationDoc(doc) ? 120 : 0;
      const sourceWeight = sourceTypeWeights[doc.sourceType] ?? 0.1;
      const rawScore = keywordScore * 4 + titleScore + tokenScore + phraseScore + titlePhraseScore + compactScore + localDocBonus + diseaseDocBonus + nasalIrrigationDocBonus;

      return {
        ...doc,
        score: rawScore * sourceWeight,
        rawScore,
      };
    })
    .filter((doc) => doc.score > 0)
    .sort((a, b) => b.score - a.score);

  return prioritizeDocumentsForQuestion(question, rankedDocs, docs, limit);
}

function getConversationState(sessionId) {
  if (!sessionId) {
    return null;
  }

  return conversationStates.get(sessionId) || null;
}

function setConversationState(sessionId, state) {
  if (!sessionId) {
    return;
  }

  conversationStates.set(sessionId, state);
}

function clearConversationState(sessionId) {
  if (!sessionId) {
    return;
  }

  conversationStates.delete(sessionId);
}

function createGuidedQuestionResponse(answer, followUp = [], answerEn = '', followUpEn = []) {
  return {
    type: 'guided_question',
    answer,
    followUp,
    answerEn,
    followUpEn,
    sources: [],
    images: [],
  };
}

function detectGuidedFlowStart(message) {
  if (
    matchesAnyPattern(message, PARKING_QUERY_PATTERNS)
    && !matchesAnyPattern(message, receiptIssuancePatterns)
    && !matchesAnyPattern(message, PARKING_OUTPATIENT_PATTERNS)
    && !matchesAnyPattern(message, PARKING_INPATIENT_PATTERNS)
  ) {
    return {
      topic: 'parking',
      prompt: createGuidedQuestionResponse(
        '주차 안내는 외래 방문인지 입원인지에 따라 달라집니다. 외래 방문이신가요, 입원이신가요?',
        ['외래 방문이에요', '입원 예정이에요']
      ),
    };
  }

  if (
    isNasalIrrigationQuestion(message)
    && !matchesAnyPattern(message, NASAL_IRRIGATION_SURGERY_PATTERNS)
    && !matchesAnyPattern(message, NASAL_IRRIGATION_GENERAL_PATTERNS)
  ) {
    return {
      topic: 'nasal_irrigation',
      prompt: createGuidedQuestionResponse(
        '코세척 안내는 수술 후인지 일반 코세척인지에 따라 달라집니다. 수술 후 코세척인지, 일반 코세척인지 알려주세요.',
        ['수술 후 코세척이에요', '일반 코세척이에요']
      ),
    };
  }

  if (matchesAnyPattern(message, PREP_BROAD_PATTERNS) && !matchesAnyPattern(message, PREP_DETAIL_PATTERNS)) {
    return {
      topic: 'admission_prep',
      originalMessage: message,
      prompt: createGuidedQuestionResponse(
        '입원이나 수술 준비는 항목이 나뉘어 있습니다. 준비물, 주차, 보호자, 수술 전 검사, 복용 중단 약 중 어떤 내용이 궁금하신가요?',
        ['준비물이 궁금해요', '주차가 궁금해요', '보호자가 궁금해요', '수술 전 검사가 궁금해요', '복용 중단 약이 궁금해요']
      ),
    };
  }

  if (
    matchesAnyPattern(message, postOpCarePatterns)
    && !/(코|비염|축농증|비중격|코물혹|목|편도|귀|갑상선|침샘)/u.test(String(message || ''))
  ) {
    return {
      topic: 'postop_care',
      prompt: createGuidedQuestionResponse(
        '수술 후 주의사항은 수술 종류에 따라 달라집니다. 어떤 수술 후 주의사항이 필요한지 알려주세요.',
        ['코 수술 후 주의사항', '목 수술 후 주의사항', '귀 수술 후 주의사항', '갑상선 수술 후 주의사항', '침샘 수술 후 주의사항']
      ),
    };
  }

  return null;
}

function resolveGuidedFlowMessage(message, state) {
  if (!state || !state.topic) {
    return { resolved: false };
  }

  if (state.topic === 'parking') {
    if (matchesAnyPattern(message, PARKING_OUTPATIENT_PATTERNS)) {
      return { resolved: true, message: '외래 방문객 주차 안내' };
    }

    if (matchesAnyPattern(message, PARKING_INPATIENT_PATTERNS)) {
      return { resolved: true, message: '입원 환자 주차 안내' };
    }

    return {
      resolved: false,
      prompt: createGuidedQuestionResponse(
        '주차 안내를 정확히 드리려면 외래 방문인지 입원인지 먼저 확인이 필요합니다. 외래 방문이신가요, 입원이신가요?',
        ['외래 방문이에요', '입원 예정이에요']
      ),
    };
  }

  if (state.topic === 'nasal_irrigation') {
    if (matchesAnyPattern(message, NASAL_IRRIGATION_SURGERY_PATTERNS)) {
      return { resolved: true, message: '수술 환자 코세척 방법' };
    }

    if (matchesAnyPattern(message, NASAL_IRRIGATION_GENERAL_PATTERNS)) {
      return { resolved: true, message: '일반 환자 코세척 방법' };
    }

    return {
      resolved: false,
      prompt: createGuidedQuestionResponse(
        '코세척 안내를 맞춰 드리려면 수술 후인지 일반 코세척인지 확인이 필요합니다. 어느 경우인지 알려주세요.',
        ['수술 후 코세척이에요', '일반 코세척이에요']
      ),
    };
  }

  if (state.topic === 'admission_prep') {
    if (/준비물/u.test(message)) {
      return { resolved: true, message: `${state.originalMessage || '입원 준비'} 준비물` };
    }

    if (/주차/u.test(message)) {
      return { resolved: true, message: `${state.originalMessage || '입원 준비'} 주차` };
    }

    if (/보호자/u.test(message)) {
      return { resolved: true, message: `${state.originalMessage || '입원 준비'} 보호자 상주` };
    }

    if (/검사/u.test(message)) {
      return { resolved: true, message: `${state.originalMessage || '수술 준비'} 수술 전 검사` };
    }

    if (/약/u.test(message)) {
      return { resolved: true, message: `${state.originalMessage || '수술 준비'} 복용 중단 약물` };
    }

    return {
      resolved: false,
      prompt: createGuidedQuestionResponse(
        '원하시는 준비 항목을 한 가지만 먼저 알려주세요. 준비물, 주차, 보호자, 수술 전 검사, 복용 중단 약 중에서 선택해 주세요.',
        ['준비물', '주차', '보호자', '수술 전 검사', '복용 중단 약']
      ),
    };
  }

  if (state.topic === 'postop_care') {
    if (/(코|비염|축농증|비중격|코물혹)/u.test(message)) {
      return { resolved: true, message: '코 수술 후 주의사항' };
    }

    if (/(목|편도)/u.test(message)) {
      return { resolved: true, message: '목 수술 후 주의사항' };
    }

    if (/귀/u.test(message)) {
      return { resolved: true, message: '귀 수술 후 주의사항' };
    }

    if (/갑상선/u.test(message)) {
      return { resolved: true, message: '갑상선 수술 후 주의사항' };
    }

    if (/(침샘|이하선|악하선)/u.test(message)) {
      return { resolved: true, message: '침샘 수술 후 주의사항' };
    }

    return {
      resolved: false,
      prompt: createGuidedQuestionResponse(
        '수술 후 주의사항을 정확히 안내하려면 수술 종류를 먼저 알아야 합니다. 아래 중에서 골라 주세요.',
        ['코 수술 후 주의사항', '목 수술 후 주의사항', '귀 수술 후 주의사항', '갑상선 수술 후 주의사항', '침샘 수술 후 주의사항']
      ),
    };
  }

  return { resolved: false };
}

function shouldResetGuidedFlowForNewTopic(message) {
  const current = String(message || '').trim();
  if (!current) {
    return false;
  }

  if (/^(외래|입원|네|아니오|아니요|맞아요|맞습니다|수술 후|일반)/u.test(current)) {
    return false;
  }

  return /(오늘|내일|모레|이번주|토요일|일요일|월요일|화요일|수요일|목요일|금요일|진료|예약|접수|의사|원장|의료진|셔틀|주차|입원|퇴원|수술|서류|영수증|비용|금액|검사|코세척|약물|진단서)/u.test(current);
}

function classifyUserIntent(message) {
  const text = String(message || '').trim();

  if (!text) {
    return { type: 'welcome' };
  }

  const normalized = normalizeSearchTextSafe(text);
  const lowered = text.toLowerCase();

  if (matchesAnyPattern(lowered, emergencyPatterns)) {
    return { type: 'emergency' };
  }

  if (
    matchesAnyPattern(lowered, medicalRestrictionPatterns)
    && !matchesAnyPattern(text, certificateDocumentQuestionPatterns)
  ) {
    return { type: 'restricted' };
  }

  if (matchesAnyPattern(text, personalInfoPatterns)) {
    return { type: 'personal_info' };
  }

  if (matchesAnyPattern(text, receiptIssuancePatterns)) {
    return { type: 'receipt_issuance' };
  }

  if (matchesAnyPattern(text, sameDayExamAvailabilityPatterns)) {
    return { type: 'same_day_exam_availability' };
  }

  if (isMedicationStopQuestion(text)) {
    return { type: 'medication_stop' };
  }

  if (matchesAnyPattern(text, postOpBleedingPatterns)) {
    return { type: 'postop_bleeding' };
  }

  if (matchesAnyPattern(text, postOpCarePatterns)) {
    return { type: 'postop_care' };
  }

  if (findHomepageSurgeryCostResponse(text)) {
    return { type: 'homepage_surgery_cost' };
  }

  if (findHomepageSurgeryInfoResponse(text)) {
    return { type: 'homepage_surgery_info' };
  }

  if (matchesAnyPattern(text, surgeryCostPatterns)) {
    return { type: 'surgery_cost' };
  }

  if (matchesAnyPattern(text, surgerySchedulePatterns)) {
    return { type: 'surgery_schedule' };
  }

  if (matchesAnyPattern(text, surgeryDurationPatterns)) {
    return { type: 'surgery_duration' };
  }

  if (findCertificateFeeResponse(text)) {
    return { type: 'certificate_fee' };
  }

  if (findSingleRoomFeeResponse(text)) {
    return { type: 'single_room_fee' };
  }

  if (findNonpayItemResponse(text)) {
    return { type: 'nonpay_item_fee' };
  }

  if (matchesAnyPattern(text, hospitalPhonePatterns)) {
    return { type: 'hospital_phone' };
  }

  if (matchesAnyPattern(text, lateArrivalPatterns)) {
    return { type: 'late_arrival' };
  }

  if (matchesAnyPattern(text, inpatientMealPolicyPatterns)) {
    return { type: 'inpatient_meal_policy' };
  }

  if (matchesAnyPattern(text, inpatientOutingPatterns)) {
    return { type: 'inpatient_outing' };
  }

  if (matchesAnyPattern(text, shuttleBusPatterns)) {
    return { type: 'shuttle_bus' };
  }

  if (matchesAnyPattern(text, dischargeProcedurePatterns)) {
    return { type: 'discharge_procedure' };
  }

  if (matchesAnyPattern(text, rhinitisPostOpVisitPatterns)) {
    return { type: 'rhinitis_postop_visit' };
  }

  if (matchesAnyPattern(text, guardianShiftPatterns)) {
    return { type: 'guardian_shift' };
  }

  if (matchesAnyPattern(text, wifiPatterns)) {
    return { type: 'wifi_info' };
  }

  if (matchesAnyPattern(text, complaintPatterns)) {
    return { type: 'complaint_guide' };
  }

  if (findFloorGuideResponse(text)) {
    return { type: 'floor_guide' };
  }

  if (normalized.includes('예약') || normalized.includes('접수')) {
    return { type: 'reservation_or_reception' };
  }

  return { type: 'unknown' };
}

function resolveIntentResponse(intentType, message) {
  switch (intentType) {
    case 'welcome':
      return createWelcomeResponse();
    case 'emergency':
      return createEmergencyResponse();
    case 'restricted':
      return createRestrictedMedicalResponse();
    case 'personal_info':
      return createPersonalInfoWarningResponse();
    case 'receipt_issuance':
      return createReceiptIssuanceResponse();
    case 'same_day_exam_availability':
      return createSameDayExamAvailabilityResponse();
    case 'medication_stop':
      return createMedicationStopResponse();
    case 'postop_bleeding':
      return createPostOpBleedingResponse();
    case 'postop_care':
      return findPostOpCareResponse(message);
    case 'homepage_surgery_cost':
      return findHomepageSurgeryCostResponse(message);
    case 'homepage_surgery_info':
      return findHomepageSurgeryInfoResponse(message);
    case 'surgery_cost':
      return createSurgeryCostResponse();
    case 'surgery_schedule':
      return createSurgeryScheduleResponse();
    case 'surgery_duration':
      return createSurgeryDurationResponse();
    case 'certificate_fee':
      return findCertificateFeeResponse(message);
    case 'single_room_fee':
      return findSingleRoomFeeResponse(message);
    case 'nonpay_item_fee':
      return findNonpayItemResponse(message);
    case 'hospital_phone':
      return createHospitalPhoneResponse();
    case 'late_arrival':
      return createLateArrivalResponse();
    case 'inpatient_meal_policy':
      return createInpatientMealPolicyResponseFixed();
    case 'inpatient_outing':
      return createInpatientOutingResponse();
    case 'shuttle_bus':
      return createShuttleBusResponse();
    case 'discharge_procedure':
      return createDischargeProcedureResponse();
    case 'rhinitis_postop_visit':
      return createRhinitisPostOpVisitResponse();
    case 'guardian_shift':
      return createGuardianShiftResponse();
    case 'wifi_info':
      return createWifiResponse();
    case 'complaint_guide':
      return createComplaintGuideResponse();
    case 'floor_guide':
      return findFloorGuideResponse(message);
    default:
      return null;
  }
}

function getSessionHistory(sessionId) {
  if (!sessionId) {
    return [];
  }

  const cached = sessions.get(sessionId);
  if (Array.isArray(cached) && cached.length > 0) {
    return cached;
  }

  const restored = getStoredSessionHistory(sessionId);
  if (restored.length > 0) {
    sessions.set(sessionId, restored);
  }

  return restored;
}

function saveSessionHistory(sessionId, history) {
  if (!sessionId) {
    return;
  }

  sessions.set(sessionId, history.slice(-MAX_SESSION_MESSAGE_ENTRIES));
}

function recordSessionTurn(sessionId, userMessage, answer) {
  if (!sessionId) {
    return;
  }

  const history = getSessionHistory(sessionId);
  const nextHistory = [
    ...history,
    { role: 'user', content: String(userMessage || '') },
    { role: 'assistant', content: String(answer || '') },
  ];

  saveSessionHistory(sessionId, nextHistory);
  const timestamp = new Date().toISOString();
  appendSessionMessage(sessionId, 'user', userMessage, timestamp);
  appendSessionMessage(sessionId, 'assistant', answer, timestamp);
}

function buildContextualUserMessage(message, history) {
  const current = String(message || '').trim();
  if (!current || !Array.isArray(history) || history.length === 0) {
    return current;
  }

  if (/(지하\s*\d+\s*층|\d+\s*층).{0,12}(뭐|어디|있|안내|위치)/u.test(current) || /(\d+)\s*번?\s*진료실/u.test(current)) {
    return current;
  }

  const normalized = normalizeSearchTextSafe(current);
  const tokenCount = tokenizeSafe(normalized).length;
  const hasExplicitFollowUpCue = /^(그거|그건|그건요|그럼|그럼요|그때|그건데|그 이후|그 다음|그 다음은)/u.test(current);
  const hasTopicCarryOverCue = /^(퇴원은|입원은|주차는|준비물은|비용은|시간은|위치는|일정은)/u.test(current);
  const hasStandaloneTopic = /(오늘|내일|모레|이번주|토요일|일요일|월요일|화요일|수요일|목요일|금요일|진료|예약|접수|의사|원장|의료진|셔틀|주차|입원|퇴원|수술|서류|비용|금액|검사|코세척|약물|진단서)/u.test(current);
  const isShortQuestion = current.length <= 18 || tokenCount <= 3;
  const needsContext = (
    hasExplicitFollowUpCue
    || (hasTopicCarryOverCue && !hasStandaloneTopic)
    || (
      isShortQuestion
      && !hasStandaloneTopic
      && /(언제|어디|어떻게|얼마|가능해|가능한가|가능해요|돼|되나요|있어|있나요|필요해|필요한가|필요해요)$/u.test(current)
    )
  );

  if (!needsContext) {
    return current;
  }

  const lastUserMessage = [...history].reverse().find((item) => item?.role === 'user' && item.content)?.content;
  if (!lastUserMessage) {
    return current;
  }

  return `${lastUserMessage}\n후속 질문: ${current}`;
}

function extractDoctorName(text) {
  const value = String(text || '');
  if (!value) {
    return '';
  }

  const doctorNames = [
    '동헌종',
    '이상덕',
    '정도광',
    '남순열',
    '주형로',
    '장선오',
    '장정훈',
    '김태현',
    '정종인',
    '김종세',
    '장규선',
    '김병길',
    '이영미',
    '강매화',
    '문보은',
    '이용배',
  ];

  return doctorNames.find((name) => value.includes(name)) || '';
}

function isDoctorCareerQuestion(text) {
  return /(경력|약력|이력|프로필|학력|논문|연구실적|전공|전문분야)/u.test(String(text || ''));
}

function buildDoctorContextualUserMessage(message, history) {
  const current = String(message || '').trim();
  if (!current || !Array.isArray(history) || history.length === 0) {
    return current;
  }

  if (!isDoctorCareerQuestion(current) || extractDoctorName(current)) {
    return current;
  }

  const lastUserMessage = [...history]
    .reverse()
    .find((item) => item?.role === 'user' && item.content)?.content;

  const doctorName = extractDoctorName(lastUserMessage);
  if (!doctorName) {
    return current;
  }

  return `${doctorName} ${current}`;
}

function isEnglishDominantText(text) {
  const value = String(text || '');
  const latinMatches = value.match(/[A-Za-z]/g) || [];
  const koreanMatches = value.match(/[\uAC00-\uD7A3]/g) || [];

  return latinMatches.length >= 6 && latinMatches.length > koreanMatches.length * 2;
}

async function buildKoreanRetrievalQuery(question, history = []) {
  const value = String(question || '').trim();
  if (!value || !OPENAI_API_KEY || !isEnglishDominantText(value)) {
    return value;
  }

  const recentHistory = Array.isArray(history) ? history.slice(-4) : [];
  const historyText = recentHistory
    .map((item) => `${item.role === 'assistant' ? 'Assistant' : 'User'}: ${String(item.content || '').trim()}`)
    .filter(Boolean)
    .join('\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: [
          'Convert the user question into a short Korean retrieval query for matching Korean hospital FAQ and documents.',
          'Return only one concise Korean query.',
          'Keep doctor names, symptoms, departments, admission, surgery, schedule, shuttle, parking, documents, and fees explicit when present.',
          'Do not answer the user.',
        ].join(' '),
        input: [{
          role: 'user',
          content: [
            historyText ? `Recent conversation:\n${historyText}` : '',
            `English question: ${value}`,
          ].filter(Boolean).join('\n\n'),
        }],
      }),
    });

    if (!response.ok) {
      return value;
    }

    const payload = await response.json();
    const outputText = extractOutputText(payload).trim();
    return outputText || value;
  } catch (error) {
    return value;
  } finally {
    clearTimeout(timeout);
  }
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
      '답변 언어는 사용자의 마지막 질문 언어를 그대로 따르세요. 영어 질문에는 영어로, 한국어 질문에는 한국어로 답하세요.',
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
          '답변 언어는 사용자의 마지막 질문 언어를 그대로 따르세요. 영어 질문에는 영어로, 한국어 질문에는 한국어로 답하세요.',
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

function parseValidationResult(text) {
  const value = String(text || '').trim();
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[0]);
    } catch (innerError) {
      return null;
    }
  }
}

async function validateAIAnswer(question, answer, contextDocs) {
  if (!OPENAI_API_KEY) {
    return { valid: true, reason: 'api_key_missing_skip_validation' };
  }

  const docSummaries = (contextDocs || []).slice(0, 3).map((doc, index) => (
    `[문서 ${index + 1}] ${doc.title}\n출처: ${doc.url}\n내용 요약: ${String(doc.text || '').slice(0, 700)}`
  )).join('\n\n');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  try {
    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        instructions: [
          'You are validating a hospital chatbot answer.',
          'Check only two things: whether the answer matches the user intent, and whether the answer is supported by the provided documents.',
          'Return JSON only.',
          'Schema: {"valid": boolean, "reason": string}.',
          'Mark valid=false if the answer shifts to a different topic, answers the wrong question, or cites details not supported by the documents.',
          'Be strict about topic mismatch.',
        ].join(' '),
        input: [{
          role: 'user',
          content: [
            `질문: ${question}`,
            `답변: ${answer}`,
            '',
            docSummaries,
          ].join('\n'),
        }],
      }),
    });

    if (!response.ok) {
      return { valid: true, reason: `validation_skipped_${response.status}` };
    }

    const payload = await response.json();
    const parsed = parseValidationResult(extractOutputText(payload));
    if (!parsed || typeof parsed.valid !== 'boolean') {
      return { valid: true, reason: 'validation_parse_failed' };
    }

    return {
      valid: parsed.valid,
      reason: String(parsed.reason || '').trim() || (parsed.valid ? 'ok' : 'validator_rejected'),
    };
  } catch (error) {
    return { valid: true, reason: 'validation_fetch_failed' };
  } finally {
    clearTimeout(timeout);
  }
}

async function buildChatResponse(rawMessage, sessionId) {
  const message = String(rawMessage || '').trim();
  const conversationState = getConversationState(sessionId);
  const history = getSessionHistory(sessionId);
  let effectiveMessage = message;
  const rawIntent = classifyUserIntent(message);

  if (!message) {
    return enrichResponsePayload(createWelcomeResponse(), message);
  }

  if (conversationState) {
    if (shouldResetGuidedFlowForNewTopic(message) || rawIntent.type !== 'unknown') {
      clearConversationState(sessionId);
    } else {
      const guidedResolution = resolveGuidedFlowMessage(message, conversationState);

      if (!guidedResolution.resolved) {
        if (guidedResolution.prompt) {
          return enrichResponsePayload(guidedResolution.prompt, message);
        }
      } else {
        clearConversationState(sessionId);
        effectiveMessage = guidedResolution.message;
      }
    }
  } else {
    const guidedFlow = rawIntent.type === 'unknown' ? detectGuidedFlowStart(message) : null;
    if (guidedFlow) {
      setConversationState(sessionId, {
        topic: guidedFlow.topic,
        originalMessage: guidedFlow.originalMessage || message,
      });
      return enrichResponsePayload(guidedFlow.prompt, message);
    }
  }

  effectiveMessage = buildContextualUserMessage(effectiveMessage, history);
  effectiveMessage = buildDoctorContextualUserMessage(effectiveMessage, history);
  const retrievalMessage = await buildKoreanRetrievalQuery(effectiveMessage, history);
  const intent = classifyUserIntent(retrievalMessage);

  const intentResponse = resolveIntentResponse(intent.type, retrievalMessage);
  if (intentResponse) {
    return enrichResponsePayload(intentResponse, message);
  }

  const smallTalkIntent = getSmallTalkIntent(retrievalMessage);
  if (smallTalkIntent) {
    return enrichResponsePayload(createSmallTalkResponse(smallTalkIntent), message);
  }

  const cachedResponse = getCachedResponse(retrievalMessage);
  if (cachedResponse) {
    return cachedResponse;
  }

  const matchedDiseaseTerms = getMatchedHomepageDiseaseTerms(retrievalMessage);
  const shouldPrioritizeDiseaseDocs = matchedDiseaseTerms.length > 0;
  const shouldPrioritizeNasalIrrigationDocs = isNasalIrrigationQuestion(retrievalMessage);

  const directFaqResponse = shouldPrioritizeDiseaseDocs || shouldPrioritizeNasalIrrigationDocs
    ? null
    : findDirectFaqMatch(retrievalMessage);
  if (directFaqResponse) {
    const simplifiedFaqResponse = {
      ...directFaqResponse,
      answer: appendSupportLinks(applyPatientFriendlyTemplate(directFaqResponse.answer, effectiveMessage), message),
      followUp: (directFaqResponse.followUp || []).map((item) => applyPatientFriendlyTemplate(item, message)),
      images: findRelevantImages(message),
    };
    setCachedResponse(retrievalMessage, simplifiedFaqResponse);
    return simplifiedFaqResponse;
  }

  const operationalInferenceResponse = findOperationalInferenceResponse(retrievalMessage);
  if (operationalInferenceResponse) {
    return enrichResponsePayload(operationalInferenceResponse, message);
  }

  if (!OPENAI_API_KEY) {
    return enrichResponsePayload(createApiKeyMissingResponse(), message);
  }

  const docs = await getDocumentsForRequest();
  const contextDocs = rankDocuments(retrievalMessage, docs);

  if (contextDocs.length === 0) {
    return enrichResponsePayload(createFallbackResponse(retrievalMessage, []), message);
  }

  const generatedAnswer = appendSupportLinks(
    applyPatientFriendlyTemplate(await callOpenAI(effectiveMessage, history, contextDocs), effectiveMessage),
    message
  );
  const validationResult = await validateAIAnswer(effectiveMessage, generatedAnswer, contextDocs);

  if (!validationResult.valid) {
    return enrichResponsePayload(
      createFallbackResponse(retrievalMessage, dedupeSources(contextDocs).slice(0, 3).map((source) => source.title)),
      message
    );
  }

  const responsePayload = {
    type: 'ai',
    answer: generatedAnswer,
    followUp: [],
    sources: dedupeSources(contextDocs).slice(0, 3),
    images: findRelevantImages(message, contextDocs),
  };

  setCachedResponse(retrievalMessage, responsePayload);
  return responsePayload;
}

function dedupeSources(docs) {
  const seen = new Set();
  const sources = [];
  const normalizedFaqUrl = String(LOCAL_FAQ_URL || '').trim().toLowerCase();

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

  if (sources.length <= 1 || !normalizedFaqUrl) {
    return sources;
  }

  const faqSources = [];
  const nonFaqSources = [];

  sources.forEach((source) => {
    if (String(source.url || '').trim().toLowerCase() === normalizedFaqUrl) {
      faqSources.push(source);
      return;
    }

    nonFaqSources.push(source);
  });

  // FAQ overview is a useful fallback, but it should not dominate source citations
  // when a more specific hospital page is already available for the answer.
  return nonFaqSources.length > 0 ? nonFaqSources : faqSources.slice(0, 1);
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
      recordSessionTurn(parsed.sessionId, parsed.message, response.answer);
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

function handleApiAdminSessionHistory(req, res, requestUrl) {
  const sessionId = String(requestUrl.searchParams.get('sessionId') || '').trim();
  if (!sessionId) {
    sendJson(res, 400, {
      ok: false,
      error: 'sessionId is required',
    });
    return;
  }

  sendJson(res, 200, {
    ok: true,
    sessionId,
    items: getSessionMessagesForAdmin(sessionId, requestUrl.searchParams.get('limit')),
    timestamp: new Date().toISOString(),
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

  if (req.method === 'GET' && pathname === '/api/admin/session-history') {
    handleApiAdminSessionHistory(req, res, requestUrl);
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
      total: getChatLogCount(requestUrl.searchParams),
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
  console.log(`Persistent data directory: ${PERSISTENT_DATA_DIR}`);
  watchDocsDirectory();
  warmupKnowledgeDocuments();
});
