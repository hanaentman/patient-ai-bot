const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { DatabaseSync } = require('node:sqlite');
const XLSX = require('xlsx');
const CPEXCEL = require('xlsx/dist/cpexcel.js');

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
const DOCSS_DIR = path.join(__dirname, 'DOCSS');
const DOCTOR_LIST_DOC_FILENAME = '외래-의료진 명단.txt';
const DOCTOR_INFO_DOC_FILENAME = '홈페이지-의료진 정보.txt';
const DOCTOR_SPECIALTY_DOC_PATH = path.join(DOCS_DIR, DOCTOR_INFO_DOC_FILENAME);
const DOCTOR_SYNC_SCRIPT_PATH = path.join(__dirname, 'scripts', 'sync_doctor_schedule_faq.js');
const FLOOR_GUIDE_DOC_PATH = path.join(DOCS_DIR, '기타-층별안내도.txt');
const CERTIFICATE_FEES_DOC_PATH = findDocPathByKeyword('비급여비용');
const YOUTUBE_LINKS_PATH = path.join(DOCS_DIR, '유튜브-링크.txt');
const DOCTOR_NAME_FALLBACK_LIST = [
  '동헌종', '이상덕', '정도광', '남순열', '주형로', '장선오', '장정훈',
  '김태현', '정종인', '김종세', '장규선', '김병길', '이영미', '강매화',
  '문보은',
];

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
  docss: 2.2,
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
  /금기/u,
  /복용\s*중단/u,
  /먹으면\s*안/u,
  /먹지\s*마/u,
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
  /입원.*챙겨/u,
  /수술.*챙겨/u,
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
  /열이\s*높/u,
  /119/u,
];

const medicalRestrictionPatterns = [
  /진단/u,
  /처방/u,
  /병명/u,
  /원인/u,
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
  /통원\s*확인서/u,
  /소견서/u,
  /진료확인서/u,
  /입퇴원\s*확인서/u,
  /처방전/u,
  /서류\s*발급/u,
  /보험금/u,
  /의무기록/u,
];

const inpatientMealPolicyPatterns = [
  /취사/u,
  /환자\s*본인인지/u,
  /환자본인인지/u,
  /환자\s*식사/u,
];

const inpatientOutingPatterns = [
  /입원.{0,10}(외출|외박)/u,
  /(외출|외박).{0,10}입원/u,
  /병동.{0,10}(외출|외박)/u,
];

const shuttleBusPatterns = [
  /셔틀/u,
  /셔틀버스/u,
  /삼성.{0,10}(버스|셔틀)/u,
  /(버스|셔틀).{0,10}시간표/u,
  /(버스|셔틀).{0,10}운행/u,
];

const dischargeProcedurePatterns = [
  /퇴원.{0,10}(수납|절차|안내)/u,
  /(수납|절차|안내).{0,10}퇴원/u,
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
  /수술.{0,8}(걸려|걸리|걸림)/u,
  /수술후?.{0,10}(얼마나|몇\s*시간|걸리)/u,
];

const surgerySchedulePatterns = [
  /수술.{0,8}(언제|몇\s*일|날짜)/u,
  /수술\s*(일정|날짜)/u,
  /수술\s*시간.{0,8}(언제|몇\s*시)/u,
  /몇\s*일.{0,8}수술/u,
];

const postOpBleedingPatterns = [
  /수술\s*후.{0,12}(출혈|피)/u,
  /(출혈|피).{0,12}수술\s*후/u,
  /코수술\s*후.{0,12}(출혈|피)/u,
  /목수술\s*후.{0,12}(출혈|피)/u,
  /편도.{0,12}수술\s*후.{0,12}(출혈|피)/u,
];

const postOpCarePatterns = [
  /수술\s*후.{0,12}(주의사항|주의\s*사항|관리|조절|주의)/u,
  /(주의사항|주의\s*사항|관리|조절|주의).{0,12}수술\s*후/u,
  /퇴원\s*후.{0,12}(주의사항|관리)/u,
];

const surgeryCostPatterns = [
  /수술.{0,10}(비용|금액|가격|얼마)/u,
  /(비용|금액|가격|얼마).{0,10}수술/u,
  /수술비/u,
  /수술\s*비/u,
];

const sameDayExamAvailabilityPatterns = [
  /진료.{0,8}검사.{0,8}(가능|되나|하나|할수|할 수)/u,
  /검사.{0,8}(가능|되나|하나|할수|할 수).{0,8}진료/u,
  /당일.{0,8}검사.{0,8}(가능|되나|하나|할수|할 수)/u,
  /검사.{0,8}(당일|바로)/u,
  /진료시\s*검사/u,
  /진료\s*중\s*검사/u,
];

const examPreparationPatterns = [
  /검사.{0,8}(준비|준비물|준비해야|챙겨|챙길)/u,
  /(준비|준비물|준비해야|챙겨|챙길).{0,8}검사/u,
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
  /고객\s*의견/u,
  /의견/u,
  /고객\s*소리/u,
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
  /(주민등록번호|주민번호|여권번호|핸드폰번호|전화번호|이메일|메일주소|상세주소|집주소|우편번호)/u,
];

const documentCache = {
  loadedAt: 0,
  docs: [],
  pendingPromise: null,
};
const responseCache = new Map();
const DOCUMENT_REQUEST_WARMUP_WAIT_MS = 2500;
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
  { label: '코질환 상담', question: '코질환 진료 과목 알려줘' },
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
  const localDocuments = buildPreferredLocalDocuments();

  return {
    faqEntries,
    faqDocuments: buildFaqDocuments(faqEntries),
    localDocuments,
    certificateFeeEntries: buildCertificateFeeEntries(),
    nonpayItemEntries: buildNonpayItemEntries(),
    floorGuideIndex: buildFloorGuideIndex(),
    homepageDiseaseTerms: buildHomepageDiseaseTerms(localDocuments),
    doctorSpecialtyEntries: buildDoctorSpecialtyEntries(),
    doctorNames: extractDoctorNamesFromText(fs.existsSync(DOCTOR_SPECIALTY_DOC_PATH) ? fs.readFileSync(DOCTOR_SPECIALTY_DOC_PATH, 'utf8') : ''),
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
    CREATE TABLE IF NOT EXISTS session_notes (
      session_id TEXT PRIMARY KEY,
      flag TEXT NOT NULL DEFAULT 'normal',
      note TEXT NOT NULL DEFAULT '',
      reviewed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_session_notes_flag ON session_notes(flag);
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

function getChatLogsForAdmin(query, options = {}) {
  const getQueryValue = (key) => (typeof query.get === 'function' ? query.get(key) : query[key]);
  const disableLimit = Boolean(options.disableLimit);
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

  sql += ' ORDER BY datetime(timestamp) DESC';
  if (!disableLimit) {
    sql += ' LIMIT ?';
    params.push(limit);
  }

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

function getSessionNoteForAdmin(sessionId) {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) {
    return {
      sessionId: '',
      flag: 'normal',
      note: '',
      reviewedAt: '',
    };
  }

  const row = chatLogDb.prepare(`
    SELECT session_id, flag, note, reviewed_at
    FROM session_notes
    WHERE session_id = ?
  `).get(normalizedSessionId);

  return {
    sessionId: normalizedSessionId,
    flag: String(row?.flag || 'normal'),
    note: String(row?.note || ''),
    reviewedAt: String(row?.reviewed_at || ''),
  };
}

function updateSessionNoteForAdmin(sessionId, flag, note = '') {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) {
    return null;
  }

  chatLogDb.prepare(`
    INSERT INTO session_notes (session_id, flag, note, reviewed_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      flag = excluded.flag,
      note = excluded.note,
      reviewed_at = excluded.reviewed_at
  `).run(
    normalizedSessionId,
    String(flag || 'normal'),
    String(note || '').trim(),
    new Date().toISOString()
  );

  return getSessionNoteForAdmin(normalizedSessionId);
}

function buildWrongAnswerExportRows(query) {
  const exportQuery = new URLSearchParams();
  const getQueryValue = (key) => (typeof query?.get === 'function' ? query.get(key) : query?.[key]);
  const search = String(getQueryValue('q') || '').trim();
  const startAt = String(getQueryValue('startAt') || '').trim();
  const endAt = String(getQueryValue('endAt') || '').trim();

  exportQuery.set('flag', 'needs_review');
  if (search) {
    exportQuery.set('q', search);
  }
  if (startAt) {
    exportQuery.set('startAt', startAt);
  }
  if (endAt) {
    exportQuery.set('endAt', endAt);
  }

  return getChatLogsForAdmin(exportQuery, { disableLimit: true }).map((item) => {
    const sessionNote = getSessionNoteForAdmin(item.sessionId);
    return {
    timestamp: item.timestamp || '',
    session_id: item.sessionId || '',
    question: item.question || '',
    actual_answer: item.answerFull || item.answer || '',
    status: '?섏젙?꾩슂',
    flag: item.flag || 'needs_review',
    type: item.type || 'unknown',
    question_note: item.note || '',
    session_flag: sessionNote.flag || 'normal',
    session_note: sessionNote.note || '',
    reviewed_at: item.reviewedAt || '',
    session_reviewed_at: sessionNote.reviewedAt || '',
    sources: Array.isArray(item.sources)
      ? item.sources.map((source) => ({
          title: source?.title || '',
          url: source?.url || '',
        }))
      : [],
    };
  });
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

function getSessionLogsForAdmin(sessionId, limit = MAX_SESSION_MESSAGE_ENTRIES) {
  const normalizedSessionId = String(sessionId || '').trim();
  if (!normalizedSessionId) {
    return [];
  }

  const normalizedLimit = Math.min(Math.max(Number(limit) || MAX_SESSION_MESSAGE_ENTRIES, 1), 40);
  const rows = chatLogDb.prepare(`
    SELECT *
    FROM chat_logs
    WHERE session_id = ?
    ORDER BY datetime(timestamp) ASC, id ASC
    LIMIT ?
  `).all(normalizedSessionId, normalizedLimit);

  return rows.map(mapChatLogRow).filter((row) => row && (row.question || row.answer || row.answerFull));
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
  res.end(JSON.stringify(repairChatPayloadFields(payload)));
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

  return value.length > 18 ? `${value.slice(0, 18)}...` : value;
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
    '좀', '더', '관련', '문의', '확인', '부탁', '설명',
    '알려줘', '알려주세요', '말해줘', '말해주세요', '가르쳐줘', '보여줘',
    '가능해', '가능한가요', '가능할까요', '하나요', '하나', '요', '주세요',
    '있어', '있나요', '있을까요', '어떻게', '뭐야', '무엇', '궁금해요',
    '궁금합니다', '자세히', '도와줘', '주세요',
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
      answer: '?묎렐???쒗븳?섏뿀?듬땲?? 釉뚮씪?곗??먯꽌 ?ㅼ떆 ?쒕룄??二쇱꽭??',
      followUp: [],
    };
  }

  if (!isAllowedRequestOrigin(req)) {
    return {
      allowed: false,
      statusCode: 403,
      detail: 'invalid_origin',
      answer: '吏곸젒 ?몄텧? ?쒗븳?섏뼱 ?덉뒿?덈떎. ?쒕퉬???붾㈃?먯꽌 ?ㅼ떆 ?쒕룄??二쇱꽭??',
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
      answer: '?붿껌???덈Т 留롮뒿?덈떎. ?좎떆 ???ㅼ떆 ?쒕룄??二쇱꽭??',
      followUp: ['媛숈? ?ㅽ듃?뚰겕?먯꽌 ?붿껌??留롮씠 諛쒖깮?섎㈃ ?좎떆 ?쒗븳?????덉뒿?덈떎.'],
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
      answer: '吏덈Ц???덈Т 鍮좊Ⅴ寃??댁뼱吏怨??덉뒿?덈떎. 1遺??뺣룄 ???ㅼ떆 ?쒕룄??二쇱꽭??',
      followUp: ['???몄뀡?먯꽌??1遺꾩뿉 10?뚭퉴吏 吏덈Ц?????덉뒿?덈떎.'],
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
      answer: '?ㅻ뒛 ????붿쓽 ?ъ슜 ?쒕룄???꾨떖?덉뒿?덈떎. ?댁씪 ?ㅼ떆 ?댁슜??二쇱꽭??',
      followUp: ['???몄뀡?먯꽌???섎（ 40?뚭퉴吏 吏덈Ц?????덉뒿?덈떎.'],
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

function looksLikeBrokenKoreanText(value) {
  const text = String(value || '');
  return /[\uF900-\uFAFF]|(?:\?[가-힣])|(?:[가-힣]\?)|(?:\?{2,})/.test(text);
}

function decodeCompatMojibakeToken(token) {
  try {
    return Buffer.from(CPEXCEL.utils.encode(949, token)).toString('utf8').replace(/\u0000/g, '');
  } catch (error) {
    return token;
  }
}

function repairBrokenKoreanText(value) {
  let result = String(value || '');
  if (!result || !looksLikeBrokenKoreanText(result)) {
    return result;
  }

  result = result.replace(/[\uF900-\uFAFF가-힣]{2,}/g, (token) => (
    /[\uF900-\uFAFF]/.test(token) ? decodeCompatMojibakeToken(token) : token
  ));

  const replacements = [
    ['?덈뀞?섏꽭??', '안녕하세요'],
    ['?섎굹?대퉬?명썑怨쇰퀝???곷떞 ?꾩슦誘몄엯?덈떎', '하나이비인후과병원 상담 도우미입니다'],
    ['?섎굹?대퉬?명썑怨쇰퀝??', '하나이비인후과병원'],
    ['臾몄꽌 湲곗??쇰줈', '문서 기준으로'],
    ['??쒖쟾??02-6925-1111', '대표전화 02-6925-1111'],
    ['??쒖쟾??', '대표전화 '],
    ['?섎즺吏??뺣낫', '의료진 정보'],
    ['?몃옒吏꾨즺?덈궡', '외래진료 안내'],
    ['?낇눜???덈궡', '입퇴원 안내'],
    ['鍮꾧툒???덈궡 ?섏씠吏', '비급여 안내 페이지'],
    ['?섏닠 ??二쇱쓽?ы빆', '수술 후 주의사항'],
    ['肄붿꽭泥?諛⑸쾿', '코세척 방법'],
    ['?먯옣', '원장'],
    ['??쒖썝', '대표원장'],
    ['蹂묒썝??', '병원장'],
    ['吏꾨즺遺??', '진료부장'],
    ['遺?먯옣', '부원장'],
    ['遺??', '부장'],
    ['怨쇱옣', '과장'],
    ['?쇳꽣??', '센터장'],
    ['?곷떞遊뉗?', '상담봇은'],
    ['蹂듭슜 以묐떒', '복용 중단'],
    ['?좊텇利', '신분증'],
    ['?묒닔 ?곗뒪?', '접수 데스크'],
    ['?묒닔?섏떊 ???대떦', '접수하신 뒤 해당'],
    ['吏꾨즺?ㅼ뿉??', '진료실에서'],
    ['吏꾨즺瑜?諛쏆쑝?쒕㈃ ?⑸땲??', '진료를 받으시면 됩니다'],
    ['?낃컧 ?덈갑?묒쥌', '독감 예방접종'],
    ['?낃컧?덈갑?묒쥌', '독감예방접종'],
    ['?곗냼移섎즺', '산소치료'],
    ['鍮꾩뿼', '비염'],
    ['異뺣냽利?', '축농증'],
    ['鍮꾩쨷寃⑸쭔怨≪쬆', '비중격만곡증'],
    ['肄붾쭑??', '코물혹'],
    ['媛묒긽??', '갑상선'],
    ['移⑥깦', '침샘'],
    ['?섏닠鍮꾩슜', '수술비용'],
    ['留덉랬諛⑸쾿', '마취방법'],
    ['?댁썝移섎즺', '내원치료'],
    ['?뚮났湲곌컙', '회복기간'],
    ['肄?吏덊솚 ?섏궗', '코 질환 의사'],
    ['洹 吏덊솚 ?섏궗', '귀 질환 의사'],
    ['紐㈑룸몢寃쎈?쨌?섎㈃?대━??', '목·두경부·수면클리닉'],
    ['?꾨Ц遺꾩빞', '전문분야'],
    ['?덈궡 ?대?吏', '안내 이미지'],
    ['?좎껌', '요청'],
    ['?덉빟', '예약'],
    ['?꾪솕', '전화'],
    ['諛⑸Ц', '방문'],
    ['?⑤씪??', '온라인'],
    ['?곷떞', '상담'],
    ['?꾩슦誘', '도우미'],
    ['吏꾨즺?쒓컙', '진료시간'],
    ['吏꾨즺?쇱젙', '진료일정'],
    ['吏꾨즺怨?', '진료과'],
    ['吏꾨떒', '진단'],
    ['泥섎갑', '처방'],
    ['蹂寃', '변경'],
    ['?먮떒', '판단'],
    ['利앹긽', '증상'],
    ['?섎즺吏?', '의료진'],
    ['?낆썝', '입원'],
    ['?댁썝', '내원'],
    ['?덈궡', '안내'],
    ['?뺤씤', '확인'],
    ['?뺤젙', '확정'],
    ['?곹솴', '상황'],
    ['吏꾪뻾', '진행'],
    ['吏李명븯怨', '지참하고'],
    ['泥섏쓬', '처음'],
    ['?뷀?踰꾩뒪', '셔틀버스'],
    ['媛숈?', '같은'],
    ['蹂묒썝', '병원'],
    ['?뱀씪', '당일'],
    ['?붿씪', '요일'],
    ['?ㅽ썑', '오후'],
    ['二쇱꽭??', '주세요'],
    ['?덉뒿?덈떎', '있습니다'],
    ['?딆뒿?덈떎', '않습니다'],
    ['?꾩슂?⑸땲??', '필요합니다.'],
    ['?덉쟾?⑸땲??', '안전합니다.'],
    ['?낅땲??', '입니다.'],
    ['?⑸땲??', '됩니다.'],
    ['媛?ν빀?덈떎', '가능합니다'],
    ['沅뚯옣', '권장'],
  ];

  for (const [from, to] of replacements) {
    result = result.split(from).join(to);
  }

  return result
    .replace(/\u0000/g, '')
    .replace(/([가-힣])\?{1,2}(?=\s|$|[.,!:\n])/g, '$1')
    .replace(/(^|\s)\?{1,2}(?=[가-힣])/g, '$1')
    .replace(/\?{2,}/g, '?')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function repairChatPayloadFields(payload) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const repaired = { ...payload };

  if (typeof repaired.answer === 'string') {
    repaired.answer = repairBrokenKoreanText(repaired.answer);
  }

  if (Array.isArray(repaired.followUp)) {
    repaired.followUp = repaired.followUp.map((item) => repairBrokenKoreanText(item));
  }

  if (Array.isArray(repaired.sources)) {
    repaired.sources = repaired.sources.map((source) => ({
      ...source,
      title: repairBrokenKoreanText(source.title),
      sourceTitle: repairBrokenKoreanText(source.sourceTitle),
      description: repairBrokenKoreanText(source.description),
    }));
  }

  if (Array.isArray(repaired.images)) {
    repaired.images = repaired.images.map((image) => ({
      ...image,
      title: repairBrokenKoreanText(image.title),
      description: repairBrokenKoreanText(image.description),
      display: repairBrokenKoreanText(image.display),
    }));
  }

  return repaired;
}

function enrichResponsePayload(payload, question) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const localizedPayload = repairChatPayloadFields(localizeFixedResponsePayload(payload, question));
  const images = Array.isArray(localizedPayload.images) && localizedPayload.images.length > 0
    ? localizedPayload.images
    : findRelevantImages(question);

  return repairChatPayloadFields({
    ...localizedPayload,
    answer: appendSupportLinks(localizedPayload.answer, question),
    images,
  });
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
      followUp: ['The recovery period is usually about 3 to 4 weeks', 'The exact number of visits may vary depending on the procedure and recovery, so it is safest to follow the doctor?셲 final guidance'],
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
      title: guide.title || '?덈궡 ?대?吏',
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
    || /(맞는데|같아|같은데|하려고|되나|하나|어떻게|왜|가능할까요|일까요|해도 되나요)/u.test(message)
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
    matchMeta: {
      score: bestMatch.score,
      scoreGap,
      exactKeywordMatch: bestMatch.exactKeywordMatch,
      isConversationalQuestion,
      category: bestMatch.entry.category || '',
    },
    sources: [{
      title: sourceInfo.title,
      url: sourceInfo.url,
    }],
  };
}

function getFaqResponseByCategory(category) {
  const entry = (runtimeData?.faqEntries || []).find((item) => item.category === category);
  if (!entry) {
    return null;
  }

  const sourceInfo = getFaqSourceInfo(entry);
  return {
    type: 'faq',
    answer: entry.answer,
    followUp: entry.followUp || [],
    sources: [{
      title: sourceInfo.title,
      url: sourceInfo.url,
    }],
  };
}

function readDoctorOverviewEntriesFromDocss() {
  const docssPath = path.join(DOCSS_DIR, '홈페이지-의료진 정보.md');
  if (!fs.existsSync(docssPath)) {
    return [];
  }

  const text = fs.readFileSync(docssPath, 'utf8');
  const blockPattern = /^###\s+(.+)\n([\s\S]*?)(?=^###\s+|(?![\s\S]))/gm;
  const entries = [];

  for (const match of text.matchAll(blockPattern)) {
    const name = String(match[1] || '').trim();
    const body = String(match[2] || '');
    if (!name) {
      continue;
    }

    const profile = (body.match(/- 소개: (.+)/) || [])[1] || '';
    const center = (body.match(/- 소속\/진료과: (.+)/) || [])[1] || '';
    const specialty = (body.match(/- 전문분야: (.+)/) || [])[1] || '';
    const role = (body.match(/- 직함: (.+)/) || [])[1] || '';

    entries.push({
      name,
      profile: profile.trim(),
      center: center.trim(),
      specialty: specialty.trim(),
      role: role.trim(),
    });
  }

  return entries;
}

function formatDoctorOverviewDisplayName(entry) {
  const name = String(entry?.name || '').trim();
  const profile = String(entry?.profile || '').trim();
  const role = String(entry?.role || '').trim();

  if (!name) {
    return '';
  }

  if (profile) {
    const title = profile
      .replace(name, '')
      .replace(/이비인후과\s*전문의/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (title) {
      return `${name} ${title}`;
    }
  }

  return role ? `${name} ${role}` : name;
}

function buildDynamicDoctorOverviewResponse() {
  const entries = readDoctorOverviewEntriesFromDocss();
  if (!entries.length) {
    return null;
  }

  const uniqueByName = [];
  const seen = new Set();
  entries.forEach((entry) => {
    if (seen.has(entry.name)) {
      return;
    }
    seen.add(entry.name);
    uniqueByName.push(entry);
  });

  const matchBy = (entry, patterns) => {
    const haystack = `${entry.center} ${entry.specialty} ${entry.profile}`.replace(/\s+/g, ' ');
    return patterns.some((pattern) => pattern.test(haystack));
  };

  const noseDoctors = uniqueByName.filter((entry) => matchBy(entry, [/코\s*센터/u, /비염|부비동염|축농증|비중격|코막힘|코성형/u]));
  const throatSleepDoctors = uniqueByName.filter((entry) => matchBy(entry, [/두경부/u, /수면클리닉/u, /음성|인후두|갑상선|후두|구강암|침샘/u]));
  const earDoctors = uniqueByName.filter((entry) => matchBy(entry, [/귀\s*센터/u, /난청|이명|어지럼|중이염|보청기|메니에르/u]));
  const internalDoctors = uniqueByName.filter((entry) => matchBy(entry, [/내과/u]));

  const representativeDoctors = uniqueByName
    .slice(0, 10)
    .map((entry) => formatDoctorOverviewDisplayName(entry))
    .filter(Boolean);

  const formatNames = (list) => [...new Set(list.map((entry) => entry.name))].join(', ');

  const followUp = [];
  if (noseDoctors.length > 0) {
    followUp.push(`코 질환 의사: ${formatNames(noseDoctors)}`);
  }
  if (throatSleepDoctors.length > 0) {
    followUp.push(`목·두경부·수면클리닉: ${formatNames(throatSleepDoctors)}`);
  }
  if (earDoctors.length > 0) {
    followUp.push(`귀 질환 의사: ${formatNames(earDoctors)}`);
  }
  if (internalDoctors.length > 0) {
    followUp.push(`내과: ${formatNames(internalDoctors)}`);
  }
  followUp.push('세부 일정은 내원 전 대표전화 02-6925-1111로 확인해 주세요.');

  return {
    type: 'doctor_overview',
    answer: representativeDoctors.length > 0
      ? `하나이비인후과병원 홈페이지 기준으로 현재 의료진 정보를 확인할 수 있습니다. 대표 의료진으로는 ${representativeDoctors.join(', ')} 등이 있습니다.`
      : '하나이비인후과병원 홈페이지 기준으로 현재 의료진 정보를 확인할 수 있습니다.',
    followUp,
    sources: [{
      title: '홈페이지-의료진 정보',
      url: 'local://docss/%ED%99%88%ED%8E%98%EC%9D%B4%EC%A7%80-%EC%9D%98%EB%A3%8C%EC%A7%84%20%EC%A0%95%EB%B3%B4.md',
    }],
  };
}

function isGenerativeFriendlyQuestion(message) {
  const text = String(message || '').trim();
  if (!text) {
    return false;
  }

  const normalized = normalizeSearchTextSafe(text);
  const tokens = tokenizeSafe(text);

  if (normalized.length >= 18 || tokens.length >= 5) {
    return true;
  }

  return /(어떻게|언제부터|언제까지|어떤|무슨|설명|자세히|궁금|관련|가이드|준비|주의|관리|회복|과정|수납|차이|비교|추천|알려줘|알려주세요|문의하고 싶)/u.test(text);
}

function shouldPreferGenerativeDocAnswer(message, directFaqResponse) {
  if (!OPENAI_API_KEY || !directFaqResponse || !directFaqResponse.matchMeta) {
    return false;
  }

  const meta = directFaqResponse.matchMeta;
  const shortSimpleQuestion = normalizeSearchTextSafe(message).length <= 12 && tokenizeSafe(message).length <= 3;

  if (meta.exactKeywordMatch && meta.score >= 20 && !meta.isConversationalQuestion && shortSimpleQuestion) {
    return false;
  }

  if (meta.category && /doctors_overview|doctor_schedule/i.test(meta.category)) {
    return false;
  }

  return isGenerativeFriendlyQuestion(message) || !meta.exactKeywordMatch || meta.isConversationalQuestion;
}

function findDoctorOverviewResponse(message) {
  const text = String(message || '').trim();
  if (!text) {
    return null;
  }

  const normalized = normalizeSearchTextSafe(text);
  const compact = compactSearchTextSafe(text);
  const hasDoctorCue = /(의사|의료진|원장)/u.test(text);
  const hasExplicitOverviewCue = /(소개|알려|누가 있어|누구 있어|전체|목록|정보)/u.test(text);
  const isStandaloneDoctorTopic = [
    '의료진',
    '의사',
    '원장',
    '원장님',
    '의료진 정보',
    '의사 정보',
    '원장 정보',
  ].includes(normalized) || [
    '의료진',
    '의사',
    '원장',
    '원장님',
    '의료진정보',
    '의사정보',
    '원장정보',
  ].includes(compact);

  const isDoctorOverviewQuestion = hasDoctorCue && (hasExplicitOverviewCue || isStandaloneDoctorTopic);

  if (!isDoctorOverviewQuestion) {
    return null;
  }

  return buildDynamicDoctorOverviewResponse() || getFaqResponseByCategory('doctors_overview');
}

function findLooseTopicResponse(message) {
  const text = String(message || '').trim();
  if (!text) {
    return null;
  }

  const normalized = normalizeSearchTextSafe(text);
  const compact = compactSearchTextSafe(text);
  const tokenCount = tokenizeSafe(text).length;

  if (tokenCount > 3 || normalized.length > 18) {
    return null;
  }

  const isStandaloneTopic = (candidates) => (
    candidates.includes(normalized) || candidates.includes(compact)
  );

  if (isStandaloneTopic(['의료진', '의사', '원장', '원장님', '의료진정보', '의사정보', '원장정보', '의료진 정보', '의사 정보', '원장 정보'])) {
    return buildDynamicDoctorOverviewResponse() || getFaqResponseByCategory('doctors_overview');
  }

  if (isStandaloneTopic(['수술', '수술안내', '수술정보', '수술 안내', '수술 정보'])) {
    return createGuidedQuestionResponse(
      '수술 관련해서는 비용, 입원기간, 주의사항, 준비사항처럼 자주 묻는 항목이 나뉘어 있습니다. 궁금하신 내용을 말씀해 주시면 그 부분부터 바로 안내해 드릴게요.',
      ['수술 비용 알려줘', '수술 후 주의사항 알려줘', '수술 전 준비사항 알려줘']
    );
  }

  if (isStandaloneTopic(['입원', '입원안내', '입원정보', '입원 안내', '입원 정보'])) {
    return createGuidedQuestionResponse(
      '입원 관련해서는 절차, 준비물, 보호자, 퇴원 수납처럼 나뉘어 안내해 드릴 수 있습니다. 궁금하신 항목을 말씀해 주세요.',
      ['입원 절차 알려줘', '입원 준비물 알려줘', '퇴원 수납 알려줘']
    );
  }

  if (isStandaloneTopic(['검사', '검사안내', '검사정보', '검사 안내', '검사 정보'])) {
    return createGuidedQuestionResponse(
      '검사 관련해서는 당일 검사 가능 여부, 검사 준비사항, 검사 종류 안내처럼 나눠서 설명드릴 수 있습니다. 어떤 내용이 궁금하신가요?',
      ['당일 검사 가능한가요?', '검사 준비사항 알려줘', '외래 검사 종류 알려줘']
    );
  }

  if (isStandaloneTopic(['서류', '서류안내', '서류발급', '서류 안내', '서류 발급'])) {
    return createGuidedQuestionResponse(
      '서류는 영수증, 진단서, 진료상세내역처럼 종류가 나뉘어 있습니다. 필요한 서류를 말씀해 주시면 발급 방법을 안내해 드릴게요.',
      ['영수증 발급 방법 알려줘', '진단서 발급 방법 알려줘', '진료상세내역 발급 방법 알려줘']
    );
  }

  return null;
}

function createRestrictedMedicalResponse() {
  return {
    type: 'restricted',
    answer: '???곷떞遊뉗? 吏꾨떒, 泥섎갑 蹂寃? ??蹂듭슜 以묐떒 ?щ?瑜??먮떒?섏? ?딆뒿?덈떎. 利앹긽?대굹 ??愿??吏덈Ц? 吏꾨즺怨??먮뒗 ?곷떞 吏곸썝?먭쾶 ?곌껐??二쇱꽭??',
    followUp: [
      '??쒖쟾??02-6925-1111',
      '紐⑤컮???먮뒗 ?꾪솕濡?吏꾨즺 ?덉빟',
      '利앹긽??湲됲븯硫?媛源뚯슫 ?묎툒???먮뒗 119 ?댁슜',
    ],
  };
}

function createEmergencyResponse() {
  return {
    type: 'emergency',
    answer: '?묎툒 ?곹솴???섏떖?⑸땲?? ???곷떞遊뉗쑝濡?吏?고븯吏 留먭퀬 利됱떆 119 ?먮뒗 媛源뚯슫 ?묎툒?ㅻ줈 ?곕씫??二쇱꽭??',
    followUp: [
      '?섏떇 ??? ?명씉怨ㅻ?, ?ы븳 異쒗삁? 利됱떆 ?묎툒??沅뚭퀬',
      '??쒖쟾??02-6925-1111',
      '?쇨컙?먮뒗 ?묎툒 ???泥닿퀎濡??곌껐 ?꾩슂',
    ],
  };
}

function createPersonalInfoWarningResponse() {
  return {
    type: 'privacy_warning',
    answer: '媛쒖씤?뺣낫??誘쇨컧??嫄닿컯?뺣낫???낅젰?섏? 留먯븘 二쇱꽭?? 二쇰??깅줉踰덊샇, ?꾪솕踰덊샇, ?대찓?? ?곸꽭 二쇱냼 媛숈? ?뺣낫 ?놁씠 吏덈Ц??二쇱꽭??',
    followUp: [
      '?? 吏꾨떒??鍮꾩슜, ?덉빟 蹂寃?諛⑸쾿, 吏꾨즺?쒓컙泥섎읆 媛쒖씤?뺣낫 ?놁씠 吏덈Ц??二쇱꽭??',
      '?대? ?낅젰??媛쒖씤?뺣낫媛 ?덈떎硫??ㅼ떆 ?곸? 留먭퀬 ?쇰컲?곸씤 ?쒗쁽?쇰줈 諛붽퓭 吏덈Ц??二쇱꽭??',
    ],
  };
}

function createWelcomeResponse() {
  return {
    type: 'welcome',
    answer: '안녕하세요. 하나이비인후과병원 AI 상담원입니다. 병원 홈페이지와 내부 문서를 바탕으로 예약, 진료시간, 의료진, 입원, 서류 발급 등을 안내해 드립니다.',
    followUp: [
      '진료시간 알려줘',
      '동헌종 원장 진료시간 알려줘',
      '입원 절차 알려줘',
    ],
  };
}

function createApiKeyMissingResponse() {
  return {
    type: 'config_error',
    answer: '현재 OpenAI API 키가 설정되지 않아 AI 기반 상담 기능을 사용할 수 없습니다. PowerShell에서 OPENAI_API_KEY를 설정한 뒤 서버를 다시 실행해 주세요.',
    followUp: [
      '$env:OPENAI_API_KEY="발급받은키"',
      'node .\\server.js',
      '대표전화 02-6925-1111',
    ],
  };
}

function createReservationOrReceptionResponse() {
  return {
    type: 'reservation_or_reception',
    answer: '臾몄꽌 湲곗??쇰줈 ?덉빟? 諛⑸Ц ?덉빟, ?⑤씪???덉빟, ?꾪솕 ?덉빟??媛?ν빀?덈떎. ?⑤씪???덉빟? 蹂묒썝 ?덊럹?댁??먯꽌 ?좎껌?섏떆硫??곷떞?먯씠 ?덉빟 ?곹솴???뺤씤?????꾪솕濡??덉빟???뺤젙?섍퀬, ?꾪솕 ?덉빟?대굹 ?덉빟 蹂寃쎌? ??쒖쟾??02-6925-1111 ?곌껐 ???곷떞?먯쓣 ?듯빐 吏꾪뻾?섏떎 ???덉뒿?덈떎. 泥섏쓬 ?댁썝?섏떆??寃쎌슦?먮뒗 ?좊텇利앹쓣 吏李명븯怨?1痢??묒닔 ?곗뒪?ъ뿉???묒닔?섏떊 ???대떦 吏꾨즺?ㅼ뿉??吏꾨즺瑜?諛쏆쑝?쒕㈃ ?⑸땲??',
    followUp: [
      '?뱀씪 ?덉빟?대굹 ?묒닔 媛???щ????몃옒 ?湲??곹솴???곕씪 ?щ씪吏????덉뒿?덈떎.',
      '??쒖쟾??02-6925-1111',
      '?⑤씪???덉빟? 蹂묒썝 ?덊럹?댁??먯꽌 吏꾪뻾 媛?ν빀?덈떎.',
    ],
    sources: [
      {
        title: '?덊럹?댁?-FAQ',
        url: 'local://docs/%ED%99%88%ED%8E%98%EC%9D%B4%EC%A7%80-FAQ.txt',
      },
      {
        title: '?덊럹?댁?-?몃옒吏꾨즺?덈궡',
        url: 'local://docs/%ED%99%88%ED%8E%98%EC%9D%B4%EC%A7%80-%EC%99%B8%EB%9E%98%EC%A7%84%EB%A3%8C%EC%95%88%EB%82%B4.txt',
      },
    ],
  };
}

function createLateArrivalResponse() {
  return {
    type: 'late_arrival',
    answer: '?덉빟 ????쾶 ?꾩갑??寃?媛숈쑝硫???쒖쟾??02-6925-1111濡?癒쇱? ?곕씫???곷떞?먯뿉寃??곹솴???뚮젮 二쇱꽭?? 臾몄꽌 湲곗??쇰줈 ?꾩갑 ?덉젙 ?쒓컙怨??몃옒 ?湲??곹솴???곕씪 諛⑸Ц ?묒닔濡??덈궡?섍굅???덉빟 媛???щ?瑜??ㅼ떆 ?뺤씤???덈궡?????덉뒿?덈떎.',
    followUp: [
      '1?쒓컙 ?대궡 ?꾩갑 媛?ν븯硫?諛⑸Ц ?묒닔濡??덈궡?????덉뒿?덈떎.',
      '1?쒓컙 ?댁긽 ??뼱吏?寃?媛숈쑝硫??꾪솕濡??덉빟 媛???щ?瑜?癒쇱? ?뺤씤?섎뒗 ?몄씠 ?덉쟾?⑸땲??',
      '??쒖쟾?? 02-6925-1111',
    ],
  };
}

function createMedicationStopResponse() {
  return {
    type: 'medication_stop',
    answer: '?낆썝 ?꾩씠???섏닠 ?꾩뿉 蹂듭슜?섎㈃ ???섎뒗 ?쎌? 蹂묐룞 ?덈궡 湲곗??쇰줈 蹂꾨룄 由ъ뒪?몃? 癒쇱? ?뺤씤?섏떆??寃껋씠 媛???뺥솗?⑸땲?? ?꾨옒???낆썝 ??蹂듭슜 以묐떒 ?쎈Ъ 由ъ뒪???대?吏瑜??④퍡 ?덈궡?쒕━?? 蹂듭슜 以묒씤 ?쎌씠 ?덉쑝硫??대떦 紐⑸줉??癒쇱? ?뺤씤??二쇱꽭??',
    followUp: [
      '?대?吏???녿뒗 ?쎌씠嫄곕굹 蹂듭슜 吏???щ?媛 ?좊ℓ?섎㈃ ??쒖쟾??02-6925-1111濡?瑗??뺤씤??二쇱꽭??',
      '?꾩뒪?쇰┛, ??쓳怨좎젣泥섎읆 異쒗삁怨?愿?⑤맂 ?쎌? ?뱁엳 ?꾩쓽濡?怨꾩냽 蹂듭슜?섍굅??以묐떒?섏? 留먭퀬 蹂묒썝 ?덈궡瑜??곕Ⅴ??寃껋씠 ?덉쟾?⑸땲??',
      '吏덈Ц????援ъ껜?곸쑝濡?二쇱떆硫??낆썝 以鍮꾨굹 ?섏닠 ??寃???덈궡? ?④퍡 ?댁뼱???꾩??쒕┫ ???덉뒿?덈떎.',
    ],
    sources: [{
      title: '癰귣쵎猷?FAQ',
      url: 'local://docs/%EB%B3%91%EB%8F%99-FAQ.txt',
    }],
    images: [{
      title: '입원 전 복용 중단 약물 리스트',
      description: '입원 전에 중단이 필요한 약물을 확인할 수 있는 안내 이미지입니다.',
      display: 'document',
      url: resolvePublicImagePath('/images/%EC%9E%85%EC%9B%90%EC%A0%84%20%EB%B3%B5%EC%9A%A9%EC%A4%91%EB%8B%A8%20%EC%95%BD%EB%AC%BC%20%EB%A6%AC%EC%8A%A4%ED%8A%B8.jpg'),
    }],
  };
}

function createInpatientMealPolicyResponse() {
  return {
    type: 'inpatient_meal_policy',
    answer: '?낆썝?앺솢 ?덈궡臾?湲곗??쇰줈 ?먮궡 ?꾩옄?덉씤吏??鍮꾩튂?섏뼱 ?덉? ?딆쑝硫? 痍⑥궗? 諛곕떖?뚯떇? 湲덉??낅땲??',
    followUp: [
      '?앹궗?쒓컙? 議곗떇 8?? 以묒떇 12?? ?앹떇 ?ㅽ썑 5??30遺꾩쑝濡??덈궡?섏뼱 ?덉뒿?덈떎.',
      '?몃? ?덈궡??蹂묐룞 媛꾪샇?ъ떎?대굹 ??쒖쟾??02-6925-1111濡??뺤씤?????덉뒿?덈떎.',
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
    answer: '?낆썝 以??몄텧怨??몃컯? ?밸퀎???ъ쑀媛 ?녿뒗 ???먯튃?곸쑝濡??쒗븳?⑸땲?? ?ㅻ쭔 ?몄텧?대굹 ?몃컯???꾩슂?섎㈃ ?몄텧쨌?몃컯 ?좎껌?쒕? ?묒꽦?섍퀬, ?대떦?섏궗 ?먮뒗 二쇱튂?섏쓽 ?덇?瑜?諛쏆? 寃쎌슦?먮쭔 媛?ν빀?덈떎.',
    followUp: [
      '?몄텧쨌?몃컯 ?쒖뿉??蹂묐룞?먯꽌 ?덈궡???뺥빐吏??쒓컙??諛섎뱶??吏耳쒖빞 ?⑸땲??',
      '?대떦?섏궗 ?덇? ?놁씠 臾대떒 ?몄텧쨌?몃컯? ?몄젙?섏? ?딆뒿?덈떎.',
      '臾대떒 ?몄텧쨌?몃컯 ??以?섏쓽臾??꾨컲 ??利됱떆 ?댁썝 諛?移섎즺 以묐떒???????덉뒿?덈떎.',
    ],
    sources: [{
      title: '蹂묐룞-FAQ',
      url: 'local://docs/%EB%B3%91%EB%8F%99-FAQ.txt',
    }],
  };
}

function createInpatientMealPolicyResponseFixed() {
  return {
    type: 'inpatient_meal_policy',
    answer: '?낆썝?앺솢 ?덈궡臾?湲곗??쇰줈 ?먮궡 ?꾩옄?덉씤吏??鍮꾩튂?섏뼱 ?덉? ?딆쑝硫?痍⑥궗??湲덉??낅땲?? 諛곕떖?뚯떇? 媛?ν븯吏留??몃? ?뚯떇 ??랬 ???뚰솕 遺덊렪?대굹 ?⑸퀝利?媛?μ꽦??怨좊젮??二쇰Ц??二쇱떆湲?諛붾엻?덈떎.',
    followUp: [
      '?앹궗?쒓컙? 議곗떇 8?? 以묒떇 12?? ?앹떇 ?ㅽ썑 5??30遺꾩쑝濡??덈궡?섏뼱 ?덉뒿?덈떎.',
      '諛곕떖?뚯떇 媛?μ떆媛꾩? ?ㅼ쟾 7?쒕????ㅽ썑 9?쒓퉴吏?대ŉ 吏??1痢듭뿉???섎졊?⑸땲??',
      '異붽? ?덈궡??蹂묐룞 媛꾪샇?ъ떎?대굹 ??쒖쟾??02-6925-1111濡??뺤씤??二쇱꽭??',
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
    answer: '?뷀?踰꾩뒪 ?쒓컙??湲곗??쇰줈 ?됱씪? ??15遺?媛꾧꺽?쇰줈 ?댄뻾?⑸땲?? ?ㅼ쟾? 08:55遺??12:25源뚯?, ?ㅽ썑??13:40遺??17:40源뚯? 蹂묒썝?먯꽌 異쒕컻????궪??쓣 嫄곗퀜 ?ㅼ떆 蹂묒썝?쇰줈 ?댄뻾?⑸땲??',
    followUp: [
      '?좎슂?쇱? 08:55遺??12:55源뚯? ??30遺?媛꾧꺽?쇰줈 ?댄뻾?⑸땲??',
      '?뷀? ?뱀감 ?꾩튂????궪??1踰?異쒓뎄 ?멸렐?낅땲??',
      '?? ?됱씪 ?ㅼ쟾 08:55, 09:10, 09:25 / ?ㅽ썑 13:40, 13:55, 14:10',
    ],
    sources: [
      {
        title: '기타-병원셔틀시간표',
        url: 'local://docs/%EA%B8%B0%ED%83%80-%EB%B3%91%EC%9B%90%EC%85%94%ED%8B%80%EC%8B%9C%EA%B0%84%ED%91%9C.txt',
      },
      {
        title: '?덊럹?댁?-?뷀?踰꾩뒪 諛??ㅼ떆?붽만',
        url: 'local://docs/%ED%99%88%ED%8E%98%EC%9D%B4%EC%A7%80-%EC%85%94%ED%8B%80%EB%B2%84%EC%8A%A4%20%EB%B0%8F%20%EC%98%A4%EC%8B%9C%EB%8A%94%EA%B8%B8.txt',
      },
    ],
  };
}

function createDischargeProcedureResponse() {
  return {
    type: 'discharge_procedure',
    answer: '?댁썝 ?덉감??臾몄꽌 湲곗??쇰줈 ?댁썝?덈궡, 吏꾨즺鍮??ъ궗, 吏꾨즺鍮??섎궔, 洹媛 ?쒖꽌濡?吏꾪뻾?⑸땲?? ?댁썝 ?뱀씪 ?ㅼ쟾?먮뒗 ?대떦 ?섎즺吏꾩씠 ?섏닠遺?꾨? ?뺤씤?섍퀬 ?섏닠 ??愿由щ쾿怨?二쇱쓽?ы빆???덈궡?⑸땲??',
    followUp: [
      '?쒖쬆紐낆꽌瑜섍? ?꾩슂?섎㈃ ?댁썝 ?섎（ ??媛꾪샇?ъ떎??誘몃━ 留먯???二쇱꽭??',
      '?댁썝?쎌씠 ?덉쑝硫??ㅻ챸???ｊ퀬 ?섎졊?⑸땲??',
      '吏꾨즺鍮??ъ궗媛 ?앸굹硫?1痢??먮Т怨쇱뿉???섎궔?섍퀬 ?ㅼ쓬 ?듭썝移섎즺 ?좎쭨瑜??덉빟?⑸땲??',
    ],
    sources: [{
      title: '?덊럹?댁?-?낇눜???덈궡',
      url: 'local://docs/%ED%99%88%ED%8E%98%EC%9D%B4%EC%A7%80-%EC%9E%85%ED%87%B4%EC%9B%90%20%EC%95%88%EB%82%B4.txt',
    }],
  };
}

function createSurgeryDurationResponse() {
  return {
    type: 'surgery_duration',
    answer: '?섏닠 ?뚯슂?쒓컙? ?섏닠 醫낅쪟? ?섏옄 ?곹깭???곕씪 ?ㅻ쫭?덈떎. 臾몄꽌 湲곗??쇰줈???섏닠???낆떎 ???湲곗떆媛꾩씠 ?앷만 ???덇퀬, ?뱁엳 肄??섏닠? 援?냼留덉랬 ???④낵瑜?湲곕떎由щ뒗 ?쒓컙???덉뼱 ?ㅼ젣 ?ㅻ챸諛쏆? ?섏닠?쒓컙蹂대떎 ??湲몄뼱吏????덉뒿?덈떎.',
    followUp: [
      '紐⑹씠??洹 ?섏닠? ?湲곗떆媛꾩씠 鍮꾧탳??湲몄? ?딆?留?肄??섏닠? 30遺꾩뿉??1?쒓컙 ?뺣룄 ?湲????쒖옉?????덉뒿?덈떎.',
      '?섏닠 醫낅즺 ?꾩뿉???뚮났?ㅼ뿉??30遺꾩뿉??1?쒓컙 ?뺣룄 ?뚮났?????댁떎?⑸땲??',
      '?뺥솗???덉긽 ?쒓컙? ?섏닠 ?ㅻ챸 ???섎즺吏??덈궡瑜??ㅼ떆 ?뺤씤??二쇱꽭??',
    ],
    sources: [
      {
        title: '蹂묐룞-FAQ',
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
    answer: '?섏닠 ?쒖옉 ?쒓컙? ?섏닠 ?숈쓽???ㅻ챸 ???덈궡?섏?留? ?뱀씪 ?곹솴?대굹 ?섏옄 ?곹깭???곕씪 蹂寃쎈맆 ???덉뒿?덈떎.',
    followUp: [
      '?뺥솗???쒓컙? ?낆썝 ??蹂묐룞 ?먮뒗 ?섏닠 ?덈궡 怨쇱젙?먯꽌 ?ㅼ떆 ?뺤씤??二쇱꽭??',
      '蹂寃?媛?μ꽦???덉뼱 怨좎젙???쒓컙?쇰줈 誘몃━ ?뺤젙?댁꽌 ?덈궡?섏????딆쓣 ???덉뒿?덈떎.',
      '異붽? ?뺤씤???꾩슂?섎㈃ ??쒖쟾??02-6925-1111濡?臾몄쓽??二쇱꽭??',
    ],
    sources: [{
      title: '蹂묐룞-FAQ',
      url: 'local://docs/%EB%B3%91%EB%8F%99-FAQ.txt',
    }],
  };
}

function createPostOpBleedingResponse() {
  return {
    type: 'postop_bleeding',
    answer: '臾몄꽌 湲곗??쇰줈 ?섏닠 ??異쒗삁???덉쑝硫?癒쇱? 異쒗삁 ?묎낵 吏???щ?瑜?蹂댁뀛???⑸땲?? 移⑥뿉 ?쇨? 議곌툑 ?욎씠???뺣룄?쇰㈃ ?쒖썝???쇱쓬臾쇰줈 20~30遺??뺣룄 媛湲??蹂????덉?留? 異쒗삁??怨꾩냽?섍굅???묒씠 留롮쑝硫???쒖쟾??02-6925-1111濡?諛붾줈 ?곕씫??二쇱꽭??',
    followUp: [
      '利됱떆 ?댁썝???대졄嫄곕굹 ?먭굅由ъ씤 寃쎌슦?먮뒗 ?대퉬?명썑怨??섏궗媛 ?덈뒗 媛源뚯슫 ?묎툒???댁썝??沅뚭퀬?⑸땲??',
      '肄붿닔???꾩뿉??異쒗삁?묒씠 留롪퀬 怨꾩냽?섎㈃ 諛붾줈 ?곕씫?섍굅??媛源뚯슫 ?묎툒?ㅻ줈 ?덈궡?섏뼱 ?덉뒿?덈떎.',
      '?댁썝 ??諛쏆? 二쇱튂???곕씫泥섍? ?덉쑝硫?洹?踰덊샇濡?癒쇱? ?곕씫?섏뀛???⑸땲??',
    ],
    sources: [
      {
        title: '입원-수술 후 주의사항',
        url: 'local://docs/%EC%9E%85%EC%9B%90-%EC%88%98%EC%88%A0%20%ED%9B%84%20%EC%A3%BC%EC%9D%98%EC%82%AC%ED%95%AD.txt',
      },
      {
        title: '??놁뜚-??놁뜚??븐넞??덇땀??',
        url: 'local://docs/%EC%9E%85%EC%9B%90-%EC%9E%85%EC%9B%90%EC%83%9D%ED%99%9C%EC%95%88%EB%82%B4%EB%AC%B8.txt',
      },
    ],
  };
}

function createSurgeryCostResponse() {
  return {
    type: 'surgery_cost',
    answer: `?섏닠 湲덉븸? ?섏닠 醫낅쪟, 吏덊솚紐? 蹂댄뿕 ?곸슜 ?щ????곕씪 ?щ씪????媛吏 湲덉븸?쇰줈 ?덈궡?섍린 ?대졄?듬땲?? 臾몄꽌 湲곗??쇰줈??吏덊솚蹂??덊럹?댁????섏닠鍮꾩슜 踰붿쐞媛 ?덈궡?섏뼱 ?덇퀬, ?먯꽭??湲곗?? 鍮꾧툒???덈궡 ?섏씠吏?먯꽌 ?ㅼ떆 ?뺤씤?섏떎 ???덉뒿?덈떎.\n\n鍮꾧툒???덈궡 ?섏씠吏: ${NONPAY_PAGE_URL}`,
    followUp: [
      '?대뼡 ?섏닠?몄? ?뚮젮二쇱떆硫?鍮꾩뿼, 鍮꾩쨷寃⑸쭔怨≪쬆, ?몃룄, 異뺣냽利앹쿂???대떦 吏덊솚 湲곗? 臾몄꽌濡??ㅼ떆 ?덈궡???쒕┫ ???덉뒿?덈떎.',
      '??쒖쟾??02-6925-1111濡?臾몄쓽?섎㈃ 蹂댄뿕 ?곸슜 ?щ?? ?④퍡 ???뺥솗???덈궡瑜?諛쏆쓣 ???덉뒿?덈떎.',
      '吏덊솚蹂??덈궡 湲덉븸? ?섏옄 ?곹깭? ?곸슜 湲곗????곕씪 ?ㅼ젣 吏꾨즺 ???щ씪吏????덉뒿?덈떎.',
    ],
    sources: [
      {
        title: '기타-비급여비용',
        url: `local://docs/${encodeURIComponent(path.basename(CERTIFICATE_FEES_DOC_PATH || '기타-비급여비용.txt'))}`,
      },
      {
        title: '鍮꾧툒???덈궡 ?섏씠吏',
        url: NONPAY_PAGE_URL,
      },
    ],
  };
}

function createSameDayExamAvailabilityResponse() {
  return {
    type: 'same_day_exam_availability',
    answer: '臾몄꽌 湲곗??쇰줈 ?섎굹?대퉬?명썑怨쇰퀝?먯? ?먯뒪???쒖뒪?쒖쓣 ?댁쁺???遺遺꾩쓽 寃?щ? 吏꾨즺 ?뱀씪 1~2?쒓컙 ?대궡??吏꾪뻾?섍퀬 寃곌낵瑜??뺤씤?????덈떎怨??덈궡?섏뼱 ?덉뒿?덈떎. ?ㅻ쭔 洹 寃?щ뒗 吏꾪뻾 ?곹솴???곕씪 ?덉빟 寃?щ줈 諛붾????덇퀬, 肄붽낏?는룹닔硫대Т?명씉 寃?щ뒗 1諛?2???낆썝?쇰줈 吏꾪뻾?⑸땲??',
    followUp: [
      '肄?寃?щ뒗 ??20遺??뺣룄 ?뚯슂?섍퀬 ?뱀씪 寃곌낵 ?뺤씤??媛?ν븯?ㅺ퀬 ?덈궡?섏뼱 ?덉뒿?덈떎.',
      '洹 寃?щ뒗 ?뱀씪 寃?ъ? 寃곌낵 ?곷떞???먯튃?댁?留??곹솴???곕씪 ?덉빟?쇰줈 吏꾪뻾?????덉뒿?덈떎.',
      '?뺥솗??寃??媛???щ????댁썝 ????쒖쟾??02-6925-1111濡??뺤씤?섏떆硫?媛???덉쟾?⑸땲??',
    ],
    sources: [{
      title: 'FAQ',
      url: LOCAL_FAQ_URL,
    }],
  };
}

function findExamPreparationResponse(message) {
  const text = String(message || '').trim();
  if (!text || !matchesAnyPattern(text, examPreparationPatterns)) {
    return null;
  }

  if (/(수면|코골이|수면무호흡|수면다원|수면내시경)/u.test(text)) {
    return {
      type: 'exam_preparation',
      answer: '?섎㈃寃???덈궡?쒕┰?덈떎. 臾몄꽌 湲곗??쇰줈 ?섎㈃?ㅼ썝寃?ъ? ?섎㈃?댁떆寃쎄??щ뒗 1諛?2???낆썝?쇰줈 吏꾪뻾?섎ŉ 湲곕낯 ?몃㈃?꾧뎄??蹂묒떎??以鍮꾨릺???덇퀬, 洹????꾩슂??媛쒖씤 臾쇳뭹? 媛?몄삤?쒕㈃ ?⑸땲?? ?섎㈃?댁떆寃쎄??щ뒗 留덉랬 ??吏꾪뻾?섎?濡??ъ쟾??留덉랬 媛???щ?瑜??뺤씤?섍린 ?꾪븳 寃?ш? ?꾩슂?섍퀬, 湲덉떇???꾩슂?????덉뼱 寃????蹂묒썝?쇰줈 ?뺤씤?섏떆??寃껋씠 醫뗭뒿?덈떎.',
      followUp: [
        '?섎㈃寃?щ뒗 1諛?2???낆썝?쇰줈 吏꾪뻾?⑸땲??',
        '湲덉떇 ?щ?? ?ъ쟾 寃???꾩슂 ?щ?????쒖쟾??02-6925-1111濡??뺤씤??二쇱꽭??',
      ],
      sources: [{
        title: '?덊럹?댁?-FAQ',
        url: 'local://docs/%ED%99%88%ED%8E%98%EC%9D%B4%EC%A7%80-FAQ.txt',
      }],
    };
  }

  if (/(귀|청력|어지럼|전정)/u.test(text)) {
    return {
      type: 'exam_preparation',
      answer: '洹 寃????以鍮꾪빐?????ы빆? ?밸퀎???놁쑝?? 臾몄꽌 湲곗??쇰줈 寃???쒓컙???ㅻ옒 嫄몃┫ ???덉뼱 媛?ν븳 ???쇱컢 ?댁썝?섏떆??寃껋씠 醫뗭뒿?덈떎. 泥?젰寃?ъ? ?꾩젙湲곕뒫 寃?щ뒗 ?먯튃?곸쑝濡??뱀씪 寃?ъ? 寃곌낵 ?곷떞??吏꾪뻾?섏?留? 寃??吏꾪뻾 ?곹솴???곕씪 ?덉빟 ???쒗뻾?????덇퀬 ?쎈Ъ??蹂듭슜 以묒씠嫄곕굹 湲됱꽦???ы븳 ?댁??ъ????덉쑝硫??쇱젙 ?쒓컙??吏????寃?щ? 吏꾪뻾?섎뒗 寃쎌슦???덉뒿?덈떎.',
      followUp: [
        '寃???쒓컙??湲몄뼱吏????덉뼱 ?쇱컢 ?댁썝?섎뒗 ?몄씠 醫뗭뒿?덈떎.',
        '??蹂듭슜 以묒씠嫄곕굹 ?ы븳 ?댁??ъ????덉쑝硫??댁썝 ????쒖쟾??02-6925-1111濡?癒쇱? 臾몄쓽??二쇱꽭??',
      ],
      sources: [{
        title: '?덊럹?댁?-FAQ',
        url: 'local://docs/%ED%99%88%ED%8E%98%EC%9D%B4%EC%A7%80-FAQ.txt',
      }],
    };
  }

  if (/(코|비염|축농증|부비동|비중격)/u.test(text)) {
    return {
      type: 'exam_preparation',
      answer: '肄?寃???쒖뿉???밸퀎??以鍮꾪빐?????ы빆? ?놁쑝硫? 臾몄꽌 湲곗??쇰줈 ?遺遺??뱀씪 寃?ш? 媛?ν빀?덈떎.',
      followUp: [
        '?뱀씪 寃??媛???щ???吏꾨즺???곹솴???곕씪 ?щ씪吏????덉뒿?덈떎.',
        '??쒖쟾??02-6925-1111',
      ],
      sources: [{
        title: '?덊럹?댁?-FAQ',
        url: 'local://docs/%ED%99%88%ED%8E%98%EC%9D%B4%EC%A7%80-FAQ.txt',
      }],
    };
  }

  return null;
}

function createReceiptIssuanceResponse() {
  return {
    type: 'receipt_issuance',
    answer: '?곸닔利앷낵 吏꾨즺?곸꽭?댁뿭 媛숈? ?쒕쪟???몃옒?먯꽌???먮Т怨쇱뿉??蹂몄씤 ?뺤씤 ??諛쒓툒諛쏆쑝?쒕㈃ ?⑸땲?? ?낆썝 ?섏옄???댁썝 ?섎（ ??二쇱튂?섎굹 蹂묐룞 媛꾪샇?ъ뿉寃?誘몃━ ?좎껌?쒕? ?쒖텧?섍퀬, ?댁썝 ?섎궔 ???먮Т怨쇱뿉???쒕쪟瑜?諛쏅뒗 諛⑹떇?쇰줈 ?덈궡?섏뼱 ?덉뒿?덈떎.',
    followUp: [
      '?댁썝 ?꾩뿉???몃옒 諛⑸Ц ???ㅼ떆 ?좎껌?????덉뒿?덈떎.',
      '?섏옄 蹂몄씤 ??諛쒓툒? ?숈쓽?? ?좊텇利??щ낯, 愿怨꾩쬆紐낆꽌瑜??먮뒗 ?꾩엫??媛숈? 援щ퉬?쒕쪟媛 ?꾩슂?????덉뒿?덈떎.',
      '?뺥솗??諛쒓툒 媛???щ?????쒖쟾??02-6925-1111濡?癒쇱? ?뺤씤?섏떆硫?媛???덉쟾?⑸땲??',
    ],
    sources: [
      {
        title: 'FAQ',
        url: LOCAL_FAQ_URL,
      },
      {
        title: '?덊럹?댁?-?낇눜???덈궡',
        url: 'local://docs/%ED%99%88%ED%8E%98%EC%9D%B4%EC%A7%80-%EC%9E%85%ED%87%B4%EC%9B%90%20%EC%95%88%EB%82%B4.txt',
      },
    ],
  };
}

function createTypedPostOpCareResponse(kind) {
  const source = {
    title: '입원-수술 후 주의사항',
    url: 'local://docs/%EC%9E%85%EC%9B%90-%EC%88%98%EC%88%A0%20%ED%9B%84%20%EC%A3%BC%EC%9D%98%EC%82%AC%ED%95%AD.txt',
  };

  const responses = {
    nose: {
      type: 'postop_care_nose',
      answer: '肄??섏닠 ??二쇱쓽?ы빆 ?덈궡?쒕┰?덈떎. 臾몄꽌 湲곗??쇰줈 ?섏닠 ??1~3媛쒖썡 ?뺣룄 ?몃옒 ?듭썝移섎즺媛 ?꾩슂?????덇퀬, 泥섏쓬 1~2二??뺣룄??肄붾? ?멸쾶 ?嫄곕굹 肄붾? 嫄대뱶由щ뒗 ?됰룞???쇳븯??寃껋씠 醫뗭뒿?덈떎. 肄붿꽭泥??꾩뿉??肄붾? 臾대━?섍쾶 ?먭레?섏? 留먭퀬, 異쒗삁???덇굅???묎툒移섎즺媛 ?꾩슂?섎㈃ 02-6925-1111濡?諛붾줈 ?곕씫??二쇱꽭??',
      followUp: [
        '理쒖냼 2二쇨컙? ?ъ슦?? ?ы븳 ?대룞, 臾대━???쇱쇅?쒕룞???쇳븯??履쎌쑝濡??덈궡?섏뼱 ?덉뒿?덈떎.',
        '?섏쁺? 理쒖냼 4二??뺣룄 ?쇳븯怨? 湲덉뿰쨌湲덉＜??理쒖냼 2媛쒖썡 ?뺣룄 沅뚭퀬?⑸땲??',
        '鍮꾪뻾湲??묒듅? ?섏닠 ????1媛쒖썡媛??쇳븯??履쎌쑝濡??덈궡?섏뼱 ?덉뒿?덈떎.',
      ],
      sources: [source],
    },
    throat: {
      type: 'postop_care_throat',
      answer: '紐??섏닠 ??二쇱쓽?ы빆 ?덈궡?쒕┰?덈떎. 臾몄꽌 湲곗??쇰줈 ?곸쿂媛 ?덉젙???뚭퉴吏 2~3二??뺣룄???덈Т ?④쾪嫄곕굹 ?먭레?곸씤 ?뚯떇, ?깅뵳???뚯떇蹂대떎 遺?쒕윭???뚯떇 ?꾩＜濡??쒖떆??寃껋씠 醫뗭뒿?덈떎. 異쒗삁 ?덈갑???꾪빐 鍮⑤? ?ъ슜? ?쇳븯怨? ?쇨? 怨꾩냽 ?욎뿬 ?섏삤嫄곕굹 ?묒씠 留롮쑝硫?蹂묒썝???곕씫 ??吏꾨즺瑜?諛쏆쑝?붿빞 ?⑸땲??',
      followUp: [
        '?섏닠 ??5~10???뺣룄源뚯? 異쒗삁 媛?μ꽦???덉뼱 移⑥뿉 ?쇨? 怨꾩냽 ?욎씠嫄곕굹 ?좏솉??異쒗삁??留롮쑝硫?諛붾줈 ?뺤씤???꾩슂?⑸땲??',
        '?섏닠 ??1~2二??뺣룄???ы븳 ?대룞?대굹 臾대━???쇱쇅?쒕룞???쇳븯怨?異⑸텇???щ뒗 寃껋씠 醫뗭뒿?덈떎.',
        '?듭쬆?대굹 異쒗삁媛먯씠 ?덉쓣 ?뚮뒗 ?쒖썝???쇱쓬臾쇰줈 ?좉퉸 媛湲?섎뒗 諛⑸쾿???덈궡?섏뼱 ?덉뒿?덈떎.',
      ],
      sources: [source],
    },
    ear: {
      type: 'postop_care_ear',
      answer: '洹 ?섏닠 ??二쇱쓽?ы빆 ?덈궡?쒕┰?덈떎. 臾몄꽌 湲곗??쇰줈 ?섏닠 遺?꾨? 遺?れ튂吏 ?딅룄濡?議곗떖?섍퀬, 肄붾? ?멸쾶 ?嫄곕굹 臾닿굅??臾쇨굔???쒕뒗 ?됰룞? ?쇳븯??寃껋씠 醫뗭뒿?덈떎. ?ъ콈湲곕굹 湲곗묠?????뚮뒗 ?낆쓣 踰뚮━怨??섍퀬, 癒몃━瑜?媛먯쓣 ?뚮룄 ?섏닠 遺?꾧? ?먭레?섏? ?딄쾶 二쇱쓽??二쇱꽭??',
      followUp: [
        '?꾨윴 怨좊쫫 媛숈? 遺꾨퉬臾쇱씠 ?섏삤嫄곕굹 ?댁??쇱씠 怨꾩냽?섎㈃ ?댁썝 ?뺤씤???꾩슂?⑸땲??',
        '媛묒옄湲??낆씠 ?뚯븘媛???먮굦 媛숈? ?덈㈃留덈퉬 利앹긽???덉쑝硫?諛붾줈 蹂묒썝???곕씫?섏뀛???⑸땲??',
        '湲고? 異쒗삁?대굹 ?묎툒移섎즺媛 ?꾩슂?섎㈃ 02-6925-1111濡??곕씫?섎룄濡??덈궡?섏뼱 ?덉뒿?덈떎.',
      ],
      sources: [source],
    },
    thyroid: {
      type: 'postop_care_thyroid',
      answer: '媛묒긽???섏닠 ??二쇱쓽?ы빆 ?덈궡?쒕┰?덈떎. 臾몄꽌 湲곗??쇰줈 ?섏닠 ??2~3???뺣룄??紐⑷낵 ?닿묠 ?吏곸엫??議곗떖?섍퀬, 臾대━??紐??대룞?대굹 媛뺥븳 ?쒕룞? ?쇳븯??寃껋씠 醫뗭뒿?덈떎. ?쇱긽?앺솢? 媛?ν븯吏留?媛뺣룄媛 ?믪? ?대룞?대굹 臾닿굅??臾쇨굔???쒕뒗 ?됰룞? ??4二??뺣룄 ?쇳븯?꾨줉 ?덈궡?섏뼱 ?덉뒿?덈떎.',
      followUp: [
        '?ㅼ썙??蹂댄넻 ?섏닠 ??3~5???ㅻ???媛?ν븯?ㅺ퀬 ?덈궡?섏뼱 ?덉뒿?덈떎.',
        '紐⑹쓽 ?밴?媛? ?쇳궡 遺덊렪媛? ?섏닠 遺??媛먭컖 ?댁긽? ?쇱떆?곸쑝濡??먭뺨吏????덉뒿?덈떎.',
        '?곸쿂 ?뚮났 湲곌컙?먮뒗 湲덉뿰쨌湲덉＜媛 沅뚭퀬?⑸땲??',
      ],
      sources: [source],
    },
    salivary: {
      type: 'postop_care_salivary',
      answer: '移⑥깦 ?섏닠 ??二쇱쓽?ы빆 ?덈궡?쒕┰?덈떎. 臾몄꽌 湲곗??쇰줈 ?섏닠 遺?꾩? 洹 二쇰???湲곴굅???먭레?섏? 留먭퀬, 泥섏쓬 2二??뺣룄??遺?쒕읇怨??먭레???곸? ?뚯떇 ?꾩＜濡??쒖떆??寃껋씠 醫뗭뒿?덈떎. ?섏닠 遺??遺볤린???덉쓣 ???덉?留??ы빐吏嫄곕굹 ?댁씠 ?섎㈃ 蹂묒썝 ?뺤씤???꾩슂?⑸땲??',
      followUp: [
        '鍮꾪뻾湲??묒듅? 蹂댄넻 ?섏닠 ??3~4二??ㅻ???媛?ν븯?ㅺ퀬 ?덈궡?섏뼱 ?덉뒿?덈떎.',
        '?ㅻ갈 ?쒓굅 ?꾪썑 ?곸쿂 愿由ъ? ?ㅼ썙 ?쒖젏? 臾몄꽌 湲곗???留욎떠 議곗떖?댁꽌 吏꾪뻾?댁빞 ?⑸땲??',
        '臾닿굅??臾쇨굔???ㅺ굅??媛뺥븳 ?대룞? ??4二??뺣룄 ?쇳븯怨? 媛踰쇱슫 嫄룰린 ?뺣룄遺???쒖옉?섎뒗 寃껋씠 醫뗭뒿?덈떎.',
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

function createNasalIrrigationResponse(mode = 'general') {
  const isSurgery = mode === 'surgery';

  return {
    type: isSurgery ? 'nasal_irrigation_surgery' : 'nasal_irrigation_general',
    answer: isSurgery
      ? '?섏닠 ??肄붿꽭泥??덈궡?쒕┰?덈떎. 臾몄꽌 湲곗??쇰줈 ?몄쿃湲곌뎄? ?앸━?앹뿼??遺꾨쭚? ?쇰컲 ?쎄뎅?먯꽌 泥섎갑???놁씠 援щℓ?????덉뒿?덈떎. 誘몄?洹쇳븳 臾쇱뿉 ?몄쿃遺꾨쭚???욎뼱 ?ъ슜?섍퀬, 肄??낃뎄???몄쫹?????????뚮━瑜??대㈃??泥쒖쿇???몄쿃??二쇱꽭?? ?섏닠 ?꾩뿉??肄붾줈 ?섏삤??臾쇱쓣 ?덈? ?멸쾶 ?吏 留먭퀬 ??븘二쇰뒗 ?뺣룄濡쒕쭔 ?섏떆??寃껋씠 醫뗭뒿?덈떎. 肄붾? ?멸쾶 嫄대뱶由ш굅??臾대━?섍쾶 ?硫?異쒗삁?대굹 ?곸쿂 ?먭레???앷만 ???덉뒿?덈떎. ?몄쿃 ?쒖옉 ?쒓린??鍮좊Ⅴ硫??댁썝 ?뱀씪 ??곷??? 蹂댄넻? ?섏닠 ??3?쇰????덈궡?섎ŉ ?섎즺吏?吏?쒓? ?덉쑝硫?洹??쇱젙??留욎떠 二쇱꽭??'
      : '?쇰컲 肄붿꽭泥??덈궡?쒕┰?덈떎. 臾몄꽌 湲곗??쇰줈 ?몄쿃湲곌뎄? ?앸━?앹뿼??遺꾨쭚? ?쇰컲 ?쎄뎅?먯꽌 泥섎갑???놁씠 援щℓ?????덉뒿?덈떎. 誘몄?洹쇳븳 臾쇱뿉 ?몄쿃遺꾨쭚???욎뼱 ?ъ슜?섍퀬, 肄??낃뎄???몄쫹?????????뚮━瑜??대㈃??泥쒖쿇???몄쿃??二쇱꽭?? 肄붾줈 ?섏삤??臾쇱? ?怨??낆쑝濡??섏삤??臾쇱? 諭됱뼱???⑸땲?? ?몄쿃湲곕? ?덈Т ?멸쾶 ?꾨Ⅴ硫?洹 ?듭쬆?대굹 ?먰넻???앷만 ???덉뼱 泥쒖쿇???섎뒗 寃껋씠 醫뗪퀬, 遺덊렪?섎㈃ ??泥쒖쿇??吏꾪뻾??二쇱꽭?? 蹂댄넻 ?섎（ 2???뺣룄 洹쒖튃?곸쑝濡??섎뒗 諛⑹떇?쇰줈 ?덈궡?⑸땲??',
    followUp: isSurgery
      ? ['異쒗삁???덇굅???듭쬆???ы븯硫?02-6925-1111濡?諛붾줈 臾몄쓽??二쇱꽭??']
      : ['遺덊렪媛먯씠 ?ы븯嫄곕굹 諛⑸쾿???룰컝由щ㈃ 吏꾨즺?ㅼ씠????쒖쟾??02-6925-1111濡?臾몄쓽??二쇱꽭??'],
    sources: [{
      title: '?몃옒-肄붿꽭泥?諛⑸쾿',
      url: 'local://docs/%EC%99%B8%EB%9E%98-%EC%BD%94%EC%84%B8%EC%B2%99%20%EB%B0%A9%EB%B2%95.txt',
    }],
    images: findRelevantImages(isSurgery ? '수술 후 코세척' : '일반 코세척'),
  };
}

function createComplaintGuideResponse() {
  return {
    type: 'complaint_guide',
    answer: '遺덈쭔, 怨좎땐, 而댄뵆?덉씤 愿???섍껄? 怨좉컼 ?섍껄?? ?댁썝 ???ㅻЦ, 蹂묒썝 ?덊럹?댁? 怨좉컼?뚮━?? ?꾪솕濡??묒닔?섏떎 ???덉뒿?덈떎.',
    followUp: [
      '怨좉컼 ?섍껄?⑥? 1痢? 2痢? 4痢? 5痢듭뿉 ?덉뒿?덈떎.',
      '?댁썝 ???ㅻЦ???듯빐?쒕룄 ?섍껄???④린?????덉뒿?덈떎.',
      '蹂묒썝 ?덊럹?댁? 怨좉컼?뚮━???먮뒗 ?꾪솕 3002濡??뚮젮 二쇱꽭??',
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
    answer: '?곸＜ 蹂댄샇??援먮???媛?ν빀?덈떎. ?ㅻ쭔 媛꾪샇媛꾨퀝?듯빀?쒕퉬??蹂묐룞 ?뱀꽦??蹂댄샇???곸＜???먯튃?곸쑝濡??쒗븳?섎ŉ, 遺덇??쇳븯寃??곸＜媛 ?덉슜??寃쎌슦?먮룄 移섎즺? 媛먯뿼 ?덈갑???꾪빐 瑗??꾩슂??寃쎌슦?먮쭔 援먮???二쇱뀛???⑸땲??',
    followUp: [
      '蹂댄샇???곸＜媛 ?꾩슂??寃쎌슦?먮뒗 ?섎즺吏??먮떒???곕씪 ?쒖떆?곸쑝濡??덉슜?⑸땲??',
      '援먮?媛 ?꾩슂???곹솴?대㈃ 蹂묐룞?먯꽌 ?꾩옱 ?덈궡 湲곗????④퍡 ?뺤씤??二쇱꽭??',
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
    answer: '??댄뙆??鍮꾨?踰덊샇??HANA濡??쒖옉?섎뒗 0269251111?낅땲??',
    followUp: [
      '紐⑤뱺 痢듭뿉???숈씪?섍쾶 ?덈궡?⑸땲??',
    ],
    sources: [],
  };
}

function createHospitalPhoneResponse() {
  return {
    type: 'hospital_phone',
    answer: '?섎굹?대퉬?명썑怨쇰퀝????쒖쟾?붾뒗 02-6925-1111?낅땲??',
    followUp: [
      '?꾪솕 ?덉빟?대굹 ?덉빟 蹂寃쎌? ??쒖쟾???곌껐 ???덈궡諛쏆쓣 ???덉뒿?덈떎.',
    ],
  };
}

function createRhinitisPostOpVisitResponse() {
  return {
    type: 'rhinitis_postop_visit',
    answer: '臾몄꽌 湲곗??쇰줈 鍮꾩뿼 ?섏닠 ???댁썝移섎즺??蹂댄넻 8~12?뚮줈 ?덈궡?섏뼱 ?덉뒿?덈떎.',
    followUp: [
      '?뚮났湲곌컙? 3~4二쇰줈 ?덈궡?섏뼱 ?덉뒿?덈떎.',
      '?몃? ?댁썝 ?잛닔? ?쇱젙? ?섏닠 諛⑹떇怨?寃쎄낵???곕씪 ?щ씪吏????덉뼱 吏꾨즺 ??理쒖쥌 ?덈궡瑜?諛쏅뒗 寃껋씠 ?덉쟾?⑸땲??',
    ],
    sources: [{
      title: '鍮꾩뿼 ?섏닠',
      url: 'https://hanaent.co.kr/nose/nose05.html?type=A&sub_tp=3',
    }],
  };
}

function createFallbackInsufficientEvidenceResponse(contextTitles) {
  return {
    type: 'fallback_insufficient_evidence',
    answer: '?꾩옱 ?뺤씤???덊럹?댁? ?댁슜留뚯쑝濡쒕뒗 ?뺥솗???덈궡媛 ?대졄?듬땲?? ??쒖쟾??02-6925-1111濡??뺤씤??二쇱꽭??',
    followUp: contextTitles.length > 0 ? contextTitles : ['吏꾨즺?쒓컙 ?덈궡', '?섎즺吏??쇱젙', '?쒕쪟 諛쒓툒 ?덈궡'],
  };
}

function createFallbackNeedsClarificationResponse() {
  return {
    type: 'fallback_needs_clarification',
    answer: '議곌툑留???援ъ껜?곸쑝濡?留먯???二쇱떆硫????먯뿰?ㅻ읇怨??뺥솗?섍쾶 ?덈궡?쒕┫ ???덉뒿?덈떎. 沅곴툑????ぉ????媛吏???뚮젮二쇱떆硫?洹??댁슜遺??諛붾줈 ?ㅻ챸?쒕┫寃뚯슂.',
    followUp: ['수술 종류를 알려주세요', '검사 종류를 알려주세요', '외래인지 입원인지 알려주세요'],
  };
}

function createFallbackInferenceResponse() {
  return {
    type: 'fallback_inference',
    answer: '臾몄꽌??愿???⑥꽌???뺤씤?섏?留?吏곸젒 紐낆떆???덈궡???꾨땲???뺥솗???⑥젙?섍린???대졄?듬땲?? ?뺥솗???댁쁺 諛⑹떇? 蹂묐룞 ?먮뒗 ??쒖쟾??02-6925-1111濡??뺤씤??二쇱꽭??',
    followUp: ['문서에서 확인한 관련 항목을 기준으로 안내드립니다.', '운영 방식은 시점에 따라 달라질 수 있습니다.'],
  };
}

function createFallbackRestrictedResponse() {
  return {
    type: 'fallback_restricted',
    answer: '??遺遺꾩? ?곷떞遊뉗뿉???먮떒???쒕┫ ???놁뒿?덈떎. ?섎즺吏??먮뒗 蹂묒썝?쇰줈 吏곸젒 ?뺤씤??二쇱꽭??',
    followUp: ['??쒖쟾??02-6925-1111', '吏꾨즺怨??먮뒗 ?섎즺吏??곷떞 沅뚯옣'],
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
    ((/(수술|검사|서류|비용|금액)/u.test(text)) && text.length <= 14)
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

function legacyGetSmallTalkIntent(message) {
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
    ['다음에', 'bye', 'goodbye', '종료', '끝', '그만', '수고하세요'].includes(normalized)
    || compact === '수고하세요'
  ) {
    return 'closing';
  }

  return null;
}

function legacyCreateSmallTalkResponse(intent) {
  if (intent === 'greeting') {
    return {
      type: 'smalltalk',
      answer: '?덈뀞?섏꽭?? ?섎굹?대퉬?명썑怨쇰퀝???곷떞 ?꾩슦誘몄엯?덈떎. ?덉빟, 吏꾨즺?쒓컙, ?섎즺吏? ?낆썝, ?뷀?踰꾩뒪 媛숈? 蹂묒썝 ?덈궡瑜??명븯寃?臾쇱뼱蹂댁떆硫??⑸땲??',
      followUp: ['진료시간 알려줘', '셔틀버스 시간표 알려줘', '입원 안내 알려줘'],
    };
  }

  if (intent === 'thanks') {
    return {
      type: 'smalltalk',
      answer: '?? ?꾩슂?섏떊 ?댁슜 ?덉쑝硫??댁뼱??留먯???二쇱꽭?? 蹂묒썝 ?덈궡 愿??吏덈Ц?대㈃ 諛붾줈 ?꾩??쒕━寃좎뒿?덈떎.',
      followUp: [],
    };
  }

  if (intent === 'closing') {
    return {
      type: 'smalltalk',
      answer: '?? ?꾩슂?섏떎 ???ㅼ떆 留먯???二쇱꽭?? 湲됲븳 臾몄쓽????쒖쟾??02-6925-1111濡?諛붾줈 ?곕씫?섏뀛???⑸땲??',
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

function legacyTokenizeBasic(text) {
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
    .replace(/[^0-9a-zA-Z가-힣]/g, ' ')
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

function buildIntentProbeMessage(text) {
  const value = String(text || '').trim();
  if (!value) {
    return '';
  }

  const compact = compactSearchTextSafe(value);
  const hints = new Set();

  if (/(비용|금액|가격|얼마|얼만가|얼만지|얼마예요|얼마에요|얼마인가)/u.test(value)) {
    hints.add('비용');
    hints.add('금액');
  }

  if (
    /(뭐있|뭐가|무엇이|무슨것|어떤것|종류|항목)/u.test(value)
    || /(검사종류|서류종류|수술종류)/u.test(compact)
  ) {
    hints.add('종류');
    hints.add('안내');
  }

  if (/(수술후내원|수술후통원)/u.test(compact)) {
    hints.add('수술 후');
  }

  if (/입원전/u.test(compact)) {
    hints.add('입원 전');
  }

  if (/진료시/u.test(compact)) {
    hints.add('진료 시');
  }

  if (/(서류어떻게|영수증어떻게|발급어떻게|발급방법|내역서어떻게)/u.test(compact)) {
    hints.add('발급 방법');
  }

  if (compact.includes('코세척')) {
    hints.add('코세척');
  }

  if (compact.includes('수술후코세척') || compact.includes('수술후는') || compact.includes('퇴원후코세척')) {
    hints.add('수술 후 코세척');
  }

  if (compact.includes('일반코세척') || compact === '일반은' || compact === '일반은요') {
    hints.add('일반 코세척');
  }

  if (compact.includes('검사뭐') || compact.includes('검사종류')) {
    hints.add('검사 종류');
  }

  if (hints.size === 0) {
    return value;
  }

  return `${value}\n寃??蹂닿컯: ${[...hints].join(', ')}`;
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
  ['코물혹', '비용종', '비강종물', '비폴립'],
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

function buildDoctorSpecialtyKeywordConfigs() {
  return [
    ...HOMEPAGE_SURGERY_DOC_CONFIGS.map((config) => ({
      label: config.disease,
      aliases: config.aliases,
    })),
    { label: '난청', aliases: ['난청', '청력저하', '청력', '보청기'] },
    { label: '이명', aliases: ['이명'] },
    { label: '어지럼증', aliases: ['어지럼증', '어지럼', '현훈'] },
    { label: '중이염', aliases: ['중이염', '소아중이염', '만성중이염'] },
    { label: '목의혹', aliases: ['목의 혹', '목혹', '목 멍울', '경부종괴'] },
    { label: '구강질환', aliases: ['구강질환', '입안', '구강'] },
    { label: '코골이/수면무호흡', aliases: ['코골이', '수면무호흡', '수면무호흡증'] },
    { label: '갑상선', aliases: ['갑상선'] },
    { label: '침샘', aliases: ['침샘', '이하선', '악하선'] },
  ];
}

function extractDoctorNamesFromText(text) {
  const value = String(text || '');
  if (!value) {
    return [...DOCTOR_NAME_FALLBACK_LIST];
  }

  const names = new Set();
  const titlePattern = /(대표원장|병원장|원장|부원장|센터장|진료부장|과장|부장|전문의)/u;
  const inlineNamePattern = /([가-힣]{2,4})\s*(대표원장|병원장|원장|부원장|센터장|진료부장|과장|부장|전문의)/gu;
  const blocks = value
    .split(/\r?\n\s*\r?\n+/)
    .map((block) => block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0);

  blocks.forEach((lines) => {
    const [firstLine = '', secondLine = ''] = lines;

    if (/^[가-힣]{2,4}$/u.test(firstLine) && titlePattern.test(secondLine)) {
      names.add(firstLine);
      return;
    }

    const header = lines.slice(0, 2).join(' ');
    for (const match of header.matchAll(inlineNamePattern)) {
      if (match[1]) {
        names.add(match[1]);
      }
    }
  });

  DOCTOR_NAME_FALLBACK_LIST.forEach((name) => {
    if (value.includes(name)) {
      names.add(name);
    }
  });

  return [...names];
}

function buildDoctorSpecialtyEntries() {
  if (!fs.existsSync(DOCTOR_SPECIALTY_DOC_PATH)) {
    return [];
  }

  const text = fs.readFileSync(DOCTOR_SPECIALTY_DOC_PATH, 'utf8');
  const specialtyConfigs = buildDoctorSpecialtyKeywordConfigs();
  const doctorNames = extractDoctorNamesFromText(text);
  const entries = [];

  doctorNames.forEach((doctorName, index) => {
    const startIndex = text.indexOf(doctorName);
    if (startIndex < 0) {
      return;
    }

    const nextDoctorIndex = doctorNames
      .slice(index + 1)
      .map((name) => text.indexOf(name, startIndex + doctorName.length))
      .filter((value) => value > startIndex)
      .sort((a, b) => a - b)[0] || text.length;

    const block = text.slice(startIndex, nextDoctorIndex);
    const specialtyLine = block
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.includes('?꾨Ц遺꾩빞'));

    const specialtyText = specialtyLine
      ? specialtyLine.replace(/^.*?꾨Ц遺꾩빞\s*/u, '').trim()
      : '';
    const normalizedSpecialty = normalizeSearchTextSafe(specialtyText);

    const matchedLabels = specialtyConfigs
      .filter((config) => config.aliases.some((alias) => normalizedSpecialty.includes(normalizeSearchTextSafe(alias))))
      .map((config) => config.label);

    entries.push({
      doctorName,
      specialtyText,
      labels: [...new Set(matchedLabels)],
      normalizedSpecialty,
    });
  });

  return entries.filter((entry) => entry.specialtyText);
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
      title: '?낇눜?먰솗?몄꽌',
      requiredTerms: ['?낇눜?먰솗?몄꽌', 'pdz09'],
    },
    {
      key: 'admission_discharge_reissue',
      title: '입퇴원확인서 재발급',
      requiredTerms: ['입퇴원확인서', '재발급'],
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
      title: '?곗냼移섎즺',
      aliases: ['?곗냼移섎즺', '怨좎븬?곗냼', '怨좎븬?곗냼移섎즺'],
      matcher: (line) => compactSearchTextSafe(line).includes(compactSearchTextSafe('?곗냼移섎즺')),
    },
    {
      key: 'flu_shot',
      title: '?낃컧二쇱궗',
      aliases: ['?낃컧二쇱궗', '?낃컧 ?덈갑?묒쥌', '?낃컧?덈갑?묒쥌', '?낃컧諛깆떊', '?뚮（?꾨┃?ㅽ뀒?몃씪'],
      matcher: (line) => {
        const normalized = compactSearchTextSafe(line);
        return (
          normalized.includes(compactSearchTextSafe('?낃컧 ?덈갑?묒쥌'))
          || normalized.includes(compactSearchTextSafe('?낃컧?덈갑?묒쥌'))
          || normalized.includes(compactSearchTextSafe('?뚮（?꾨┃?ㅽ뀒?몃씪'))
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
        answer: `${floorLabel}에는 ${floorInfo.line.replace(/^(지하\s*\d+\s*층|\d+\s*층)/u, '').trim()}가 있습니다.`,
        followUp: [
          '?ㅻⅨ 痢??덈궡媛 ?꾩슂?섎㈃ 1痢? 2痢? 3痢듭쿂???ㅼ떆 吏덈Ц??二쇱꽭??',
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
    ? '이비인후과 진료실 1~6'
    : (floorInfo.floor === 1 ? '이비인후과 진료실 7~8' : '진료실');

  return {
    type: 'floor_guide',
    answer: `${roomNumber}踰?吏꾨즺?ㅼ? ${floorInfo.floor}痢듭엯?덈떎. 痢듬퀎?덈궡??湲곗??쇰줈 ${department}???대떦?⑸땲??`,
    followUp: [
      '?뺥솗???꾩튂媛 ?룰컝由щ㈃ 1痢??먮뒗 ?대떦 痢??덈궡 ?곗뒪?ъ뿉???ㅼ떆 ?덈궡諛쏆쑝?쒕㈃ ?⑸땲??',
    ],
    sources: [{
      title: '기타-층별안내도',
      url: `local://docs/${encodeURIComponent(path.basename(FLOOR_GUIDE_DOC_PATH))}`,
    }],
  };
}

const HOMEPAGE_SURGERY_DOC_CONFIGS = [
  { disease: '??', aliases: ['??', '????', '????', '??????', '??????', '????????'], filename: '????-????.txt' },
  { disease: '???', aliases: ['???', '?????', '????', '??????', '?????'], filename: '????-???.txt' },
  { disease: '??', aliases: ['??', '????', '????'], filename: '????-??.txt' },
  { disease: '??????', aliases: ['??????', '????????', '???', '?????'], filename: '????-??????.txt' },
  { disease: '???', aliases: ['???', '???', '????'], filename: '????-???.txt' },
  { disease: '???', aliases: ['???', '?????'], filename: '????-?????.txt' },
  { disease: '???', aliases: ['???'], filename: '????-???.txt' },
  { disease: '??', aliases: ['??', '???', '???'], filename: '????-??.txt' },
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
      || normalizedLine.includes('?μ젏')
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
  if (!/(수술|절제)/u.test(String(message || '')) || !/(비용|금액|가격|얼마)/u.test(String(message || ''))) {
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
  const stopLabels = ['?섏닠鍮꾩슜', '?섏닠?쒓컙', '留덉랬諛⑸쾿', '?낆썝湲곌컙', '?댁썝移섎즺', '?뚮났湲곌컙', '移섎즺 ?μ젏'];
  const costLines = extractHomepageSurgerySectionLines(text, ['?섏닠鍮꾩슜'], stopLabels);
  const timeLines = extractHomepageSurgerySectionLines(text, ['?섏닠?쒓컙'], stopLabels);
  const anesthesiaLines = extractHomepageSurgerySectionLines(text, ['留덉랬諛⑸쾿'], stopLabels);
  const admissionLines = extractHomepageSurgerySectionLines(text, ['?낆썝湲곌컙'], stopLabels);
  const followupLines = extractHomepageSurgerySectionLines(text, ['?댁썝移섎즺'], stopLabels);
  const recoveryLines = extractHomepageSurgerySectionLines(text, ['?뚮났湲곌컙'], stopLabels);

  if (costLines.length === 0) {
    return null;
  }

  const [costValue, ...costExtras] = costLines;
  const cleanedCostExtras = costExtras
    .map((line) => String(line || '').replace(/^\(+/, '').replace(/\)+$/, '').trim())
    .filter(Boolean);
  const sentences = [
    `${matchedConfig.disease} ?섏닠 ?덈궡?쒕┰?덈떎.`,
    `?섎굹?대퉬?명썑怨쇰퀝??湲곗??쇰줈 ?섏닠鍮꾩슜? ${costValue}${cleanedCostExtras.length > 0 ? `(${cleanedCostExtras.join(', ')})` : ''}?낅땲??`,
  ];

  if (timeLines.length > 0) {
    sentences.push(`?섏닠?쒓컙? ${timeLines.join(' ')}?낅땲??`);
  }

  if (anesthesiaLines.length > 0) {
    sentences.push(`留덉랬??${anesthesiaLines.join(' ')}?낅땲??`);
  }

  if (admissionLines.length > 0) {
    sentences.push(`?낆썝湲곌컙? ${admissionLines.join(' ')}?낅땲??`);
  }

  if (followupLines.length > 0) {
    sentences.push(`?섏닠 ???댁썝移섎즺??${followupLines.join(' ')}?낅땲??`);
  }

  if (recoveryLines.length > 0) {
    sentences.push(`?뚮났湲곌컙? ${recoveryLines.join(' ')}?낅땲??`);
  }

  sentences.push('?뺥솗???섏닠 ?곸쓳利앷낵 鍮꾩슜 諛⑸쾿? 吏꾩같怨?寃????寃곗젙?섎땲 ?먯꽭???곷떞?대굹 ?덉빟? ??쒖쟾??02-6925-1111濡?臾몄쓽??二쇱꽭??');

  return {
    type: 'homepage_surgery_cost',
    answer: sentences.join(' '),
    followUp: [
      '蹂댄뿕 ?곸슜 ?щ?? ?ㅼ젣 鍮꾩슜? 吏덊솚 ?곹깭? 寃??寃곌낵???곕씪 ?щ씪吏????덉뒿?덈떎.',
      '?ㅻⅨ ?섏닠??吏덊솚紐낆쓣 ?뚮젮二쇱떆硫??대떦 臾몄꽌 湲곗??쇰줈 ?ㅼ떆 ?덈궡???쒕┫ ???덉뒿?덈떎.',
    ],
    sources: [{
      title: path.parse(matchedConfig.filename).name,
      url: `local://docs/${encodeURIComponent(matchedConfig.filename)}`,
    }],
  };
}

function findHomepageSurgeryInfoResponse(message) {
  const text = String(message || '');
  if (!/(수술|절제)/u.test(text)) {
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
  const stopLabels = ['?섏닠鍮꾩슜', '?섏닠?쒓컙', '留덉랬諛⑸쾿', '?낆썝湲곌컙', '?댁썝移섎즺', '?뚮났湲곌컙', '移섎즺 ?μ젏'];
  const costLines = extractHomepageSurgerySectionLines(docText, ['?섏닠鍮꾩슜'], stopLabels);
  const timeLines = extractHomepageSurgerySectionLines(docText, ['?섏닠?쒓컙'], stopLabels);
  const anesthesiaLines = extractHomepageSurgerySectionLines(docText, ['留덉랬諛⑸쾿'], stopLabels);
  const admissionLines = extractHomepageSurgerySectionLines(docText, ['?낆썝湲곌컙'], stopLabels);
  const followupLines = extractHomepageSurgerySectionLines(docText, ['?댁썝移섎즺'], stopLabels);
  const recoveryLines = extractHomepageSurgerySectionLines(docText, ['?뚮났湲곌컙'], stopLabels);

  if (
    costLines.length === 0
    && timeLines.length === 0
    && anesthesiaLines.length === 0
    && admissionLines.length === 0
  ) {
    return null;
  }

  const sentences = [`${matchedConfig.disease} ?섏닠 ?덈궡?쒕┰?덈떎.`];

  if (costLines.length > 0) {
    const [costValue, ...costExtras] = costLines;
    const cleanedCostExtras = costExtras
      .map((line) => String(line || '').replace(/^\(+/, '').replace(/\)+$/, '').trim())
      .filter(Boolean);
    sentences.push(`?섏닠鍮꾩슜? ${costValue}${cleanedCostExtras.length > 0 ? `(${cleanedCostExtras.join(', ')})` : ''}?낅땲??`);
  }

  if (timeLines.length > 0) {
    sentences.push(`?섏닠?쒓컙? ${timeLines.join(' ')}?낅땲??`);
  }

  if (anesthesiaLines.length > 0) {
    sentences.push(`留덉랬諛⑸쾿? ${anesthesiaLines.join(' ')}?낅땲??`);
  }

  if (admissionLines.length > 0) {
    sentences.push(`?낆썝湲곌컙? ${admissionLines.join(' ')}?낅땲??`);
  }

  if (followupLines.length > 0) {
    sentences.push(`?섏닠 ???댁썝移섎즺??${followupLines.join(' ')}?낅땲??`);
  }

  if (recoveryLines.length > 0) {
    sentences.push(`?뚮났湲곌컙? ${recoveryLines.join(' ')}?낅땲??`);
  }

  sentences.push('?뺥솗???섏닠 ?곸쓳利앷낵 諛⑸쾿? 吏꾩같怨?寃????寃곗젙?섎땲 ?먯꽭???곷떞?대굹 ?덉빟? ??쒖쟾??02-6925-1111濡?臾몄쓽??二쇱꽭??');

  return {
    type: 'homepage_surgery_info',
    answer: sentences.join(' '),
    followUp: [
      '沅곴툑???섏닠????援ъ껜?곸쑝濡?留먯???二쇱떆硫?鍮꾩슜, ?낆썝湲곌컙, ?뚮났湲곌컙 湲곗??쇰줈 ?ㅼ떆 ?덈궡???쒕┫ ???덉뒿?덈떎.',
      '蹂댄뿕 ?곸슜 ?щ?? ?ㅼ젣 鍮꾩슜? 吏덊솚 ?곹깭? 寃??寃곌낵???곕씪 ?щ씪吏????덉뒿?덈떎.',
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

  const wantsReissue = /(재발급|재발행|재본)/u.test(message);
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
    answer: `${matchedEntry.title} 鍮꾩슜? ${matchedEntry.price}?먯엯?덈떎.`,
    followUp: [
      '湲곗? 臾몄꽌: 湲고?-鍮꾧툒?щ퉬??txt',
      wantsReissue ? '?щ컻湲??먮뒗 ?щ컻??湲곗? 湲덉븸?쇰줈 ?덈궡?덉뒿?덈떎.' : '諛쒓툒 湲곗? 湲덉븸?쇰줈 ?덈궡?덉뒿?덈떎.',
      '?몃? 湲곗?? ?먮Т怨??먮뒗 ??쒖쟾??02-6925-1111濡??ㅼ떆 ?뺤씤??二쇱꽭??',
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

  if (!/(鍮꾩슜|湲덉븸|媛寃??쇰쭏)/u.test(message)) {
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
    answer: `${matchedEntry.title} 鍮꾩슜? ${matchedEntry.price}?먯엯?덈떎.`,
    followUp: [
      '湲곗? 臾몄꽌: 湲고?-鍮꾧툒?щ퉬??txt',
      '?몃? ?곸슜 湲곗??대굹 蹂寃??щ?????쒖쟾??02-6925-1111濡??ㅼ떆 ?뺤씤??二쇱꽭??',
      `鍮꾧툒???덈궡 ?섏씠吏: ${NONPAY_PAGE_URL}`,
    ],
    sources: [
      {
        title: '기타-비급여비용',
        url: `local://docs/${encodeURIComponent(path.basename(CERTIFICATE_FEES_DOC_PATH || '기타-비급여비용.txt'))}`,
      },
      {
        title: '鍮꾧툒???덈궡 ?섏씠吏',
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
    ? `1인실(당일퇴원) 비용은 ${sameDayPrice}입니다.`
    : `1인실 비용은 ${oneNightPrice}이며, 당일퇴원 1인실 비용은 ${sameDayPrice}입니다.`;

  return {
    type: 'single_room_fee',
    answer,
    followUp: [
      '湲곗? 臾몄꽌: 湲고?-鍮꾧툒?щ퉬??txt',
      '?낆썝 ?뺥깭???곸슜 湲곗????곕씪 ?ㅼ젣 ?덈궡???щ씪吏????덉쑝????쒖쟾??02-6925-1111濡??ㅼ떆 ?뺤씤??二쇱꽭??',
      `鍮꾧툒???덈궡 ?섏씠吏: ${NONPAY_PAGE_URL}`,
    ],
    sources: [
      {
        title: '기타-비급여비용',
        url: `local://docs/${encodeURIComponent(path.basename(CERTIFICATE_FEES_DOC_PATH || '기타-비급여비용.txt'))}`,
      },
      {
        title: '鍮꾧툒???덈궡 ?섏씠吏',
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

  const asksAvailability = /(가능|되나|있나|있나요|먹을 수|요청|되는지)/u.test(text);
  if (!asksAvailability) {
    return null;
  }

  if (/(보호자.{0,8}(식사|식대|밥))/u.test(text)) {
    const matchedLine = readNonpayDocLines().find((line) => (
      compactSearchTextSafe(line).includes(compactSearchTextSafe('蹂댄샇???앸?'))
    ));

    if (!matchedLine) {
      return null;
    }

    const price = extractPriceText(matchedLine);

    return {
      type: 'operational_inference',
      answer: price
        ? `鍮꾧툒?щ퉬??臾몄꽌??蹂댄샇???앸? ${price}????ぉ???덉뼱 蹂댄샇???앹궗媛 ?쒓났?섍굅???좎껌 媛?ν븳 ?댁쁺??媛?μ꽦???믪뒿?덈떎. ?ㅻ쭔 臾몄꽌???좎껌 諛⑸쾿?대굹 ?쒓났 湲곗???吏곸젒 ?곹? ?덉????딆븘 ?뺥솗???댁쁺 諛⑹떇? 蹂묐룞 ?먮뒗 ??쒖쟾??02-6925-1111濡??뺤씤??二쇱꽭??`
        : '鍮꾧툒?щ퉬??臾몄꽌??蹂댄샇???앸? ??ぉ???덉뼱 蹂댄샇???앹궗媛 ?쒓났?섍굅???좎껌 媛?ν븳 ?댁쁺??媛?μ꽦???믪뒿?덈떎. ?ㅻ쭔 臾몄꽌???좎껌 諛⑸쾿?대굹 ?쒓났 湲곗???吏곸젒 ?곹? ?덉????딆븘 ?뺥솗???댁쁺 諛⑹떇? 蹂묐룞 ?먮뒗 ??쒖쟾??02-6925-1111濡??뺤씤??二쇱꽭??',
      followUp: [
        `臾몄꽌 洹쇨굅: ${matchedLine}`,
        '???듬?? 臾몄꽌??媛꾩젒 洹쇨굅瑜?諛뷀깢?쇰줈 ??異붿젙?낅땲??',
        '?뺥솗???좎껌 諛⑸쾿?대굹 ?쒓났 湲곗?? 蹂묐룞 ?먮뒗 ??쒖쟾??02-6925-1111濡??뺤씤??二쇱꽭??',
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
    answer: `鍮꾧툒?щ퉬??臾몄꽌??${matchedEntry.title} 鍮꾩슜 ??ぉ???덉뼱 ?대떦 ?쒕퉬?ㅻ뒗 ?댁쁺 以묒씪 媛?μ꽦???믪뒿?덈떎. ?ㅻ쭔 ?댁슜 湲곗??대굹 ?곸슜 ??곸? 臾몄꽌??吏곸젒 ?뺣━???덉? ?딆쓣 ???덉뼱 ?뺥솗???댁쁺 諛⑹떇? ??쒖쟾??02-6925-1111濡??뺤씤??二쇱꽭??`,
    followUp: [
      `臾몄꽌 洹쇨굅: ${matchedEntry.line}`,
      '???듬?? 臾몄꽌??媛꾩젒 洹쇨굅瑜?諛뷀깢?쇰줈 ??異붿젙?낅땲??',
      `鍮꾧툒???덈궡 ?섏씠吏: ${NONPAY_PAGE_URL}`,
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

function stripDocssMarkdown(text) {
  return String(text || '')
    .replace(/^\uFEFF/, '')
    .replace(/^---\n[\s\S]*?\n---\n?/u, '')
    .replace(/\n## 정리된 원문[\s\S]*$/u, '')
    .replace(/^\s*#{1,6}\s*/gm, '')
    .replace(/^\s*-\s*/gm, '')
    .trim();
}

function readLocalDocumentText(filePath, extension) {
  if (extension === '.txt') {
    return fs.readFileSync(filePath, 'utf8');
  }

  if (extension === '.md') {
    return stripDocssMarkdown(fs.readFileSync(filePath, 'utf8'));
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
        title: '?대? 臾몄꽌',
        sourceTitle: '?대? 臾몄꽌',
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

    doc.title = `濡쒖뺄 臾몄꽌 - ${fileStem}`;
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

function collectPreferredLocalDocumentInputs() {
  const inputs = [];
  const docssBases = new Set();

  if (fs.existsSync(DOCSS_DIR)) {
    const docssFiles = fs.readdirSync(DOCSS_DIR, { withFileTypes: true });
    docssFiles.forEach((file) => {
      if (!file.isFile() || path.extname(file.name).toLowerCase() !== '.md') {
        return;
      }

      const baseName = path.parse(file.name).name;
      docssBases.add(baseName);
      inputs.push({
        dir: DOCSS_DIR,
        fileName: file.name,
        extension: '.md',
        sourceType: 'docss',
        urlPrefix: 'local://docss/',
        sourceTitle: baseName.replace(/\s+/g, ' ').trim(),
      });
    });
  }

  if (!fs.existsSync(DOCS_DIR)) {
    return inputs;
  }

  const docsFiles = fs.readdirSync(DOCS_DIR, { withFileTypes: true });
  docsFiles.forEach((file) => {
    if (!file.isFile()) {
      return;
    }

    const extension = path.extname(file.name).toLowerCase();
    if (!['.txt', '.xls', '.xlsx'].includes(extension)) {
      return;
    }

    const baseName = path.parse(file.name).name;
    if (extension === '.txt' && docssBases.has(baseName)) {
      return;
    }

    inputs.push({
      dir: DOCS_DIR,
      fileName: file.name,
      extension,
      sourceType: 'local',
      urlPrefix: 'local://docs/',
      sourceTitle: baseName.replace(/\s+/g, ' ').trim(),
    });
  });

  return inputs;
}

function buildPreferredLocalDocuments() {
  const inputs = collectPreferredLocalDocumentInputs();
  const docs = [];

  for (const input of inputs) {
    const filePath = path.join(input.dir, input.fileName);
    const fileStem = input.sourceTitle;
    const rawText = readLocalDocumentText(filePath, input.extension);
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
        title: `Local doc - ${fileStem}`,
        sourceTitle: fileStem,
        url: `${input.urlPrefix}${encodeURIComponent(input.fileName)}`,
        text: chunk,
        keywords,
        sourceType: input.sourceType,
        hiddenSource: false,
        chunkLabel: `${input.fileName}${chunks.length > 1 ? ` #${index + 1}` : ''}`,
      });
    });
  }

  return docs;
}

function extractHomepageDiseaseName(sourceTitle) {
  const value = String(sourceTitle || '').trim();
  if (!value.startsWith('?덊럹?댁?-')) {
    return '';
  }

  const diseaseName = value.replace(/^홈페이지-/, '').trim();
  const excludedTitles = new Set([
    '?뷀?踰꾩뒪 諛??ㅼ떆?붽만',
    '?몃옒吏꾨즺?덈궡',
    '?섎즺吏??뺣낫',
    '?낇눜???덈궡',
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
        title: `${source.title} (濡쒕뱶 ?ㅽ뙣)`,
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
  const localFallbackDocs = [...runtimeData.faqDocuments, ...runtimeData.localDocuments];

  if (documentCache.docs.length > 0 && now - documentCache.loadedAt < maxAgeMs) {
    return documentCache.docs;
  }

  const pendingPromise = documentCache.pendingPromise || getKnowledgeDocuments();

  try {
    const docs = await Promise.race([
      pendingPromise,
      new Promise((resolve) => {
        setTimeout(() => resolve(localFallbackDocs), DOCUMENT_REQUEST_WARMUP_WAIT_MS);
      }),
    ]);

    return Array.isArray(docs) && docs.length > 0 ? docs : localFallbackDocs;
  } catch (error) {
    return localFallbackDocs;
  }
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

function isHomepageFaqDoc(doc) {
  const normalizedTitle = normalizeSearchTextSafe(`${doc?.title || ''} ${doc?.sourceTitle || ''}`);
  const compactTitle = compactSearchTextSafe(`${doc?.title || ''} ${doc?.sourceTitle || ''}`);
  const normalizedUrl = normalizeSearchTextSafe(String(doc?.url || ''));
  const compactUrl = compactSearchTextSafe(String(doc?.url || ''));
  const candidates = ['?덊럹?댁?-FAQ', '?덊럹?댁? FAQ', 'homepage-faq'];

  return candidates.some((name) => {
    const normalizedName = normalizeSearchTextSafe(name);
    const compactName = compactSearchTextSafe(name);
    return normalizedTitle.includes(normalizedName)
      || compactTitle.includes(compactName)
      || normalizedUrl.includes(normalizedName)
      || compactUrl.includes(compactName);
  });
}

function shouldPreferHomepageFaqDocs(question) {
  if (!OPENAI_API_KEY) {
    return false;
  }

  const localDocs = Array.isArray(runtimeData.localDocuments) ? runtimeData.localDocuments : [];
  if (localDocs.length === 0) {
    return false;
  }

  const rankedDocs = rankDocuments(question, localDocs, 3);
  const [topDoc, secondDoc] = rankedDocs;

  if (!topDoc || !isHomepageFaqDoc(topDoc)) {
    return false;
  }

  const topScore = Number(topDoc.rawScore || topDoc.score || 0);
  const secondScore = Number(secondDoc?.rawScore || secondDoc?.score || 0);

  return topScore >= 18 && (secondScore === 0 || topScore - secondScore >= 4);
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
      const localDocBonus = (doc.sourceType === 'local' || doc.sourceType === 'docss') && (titleScore > 0 || phraseScore > 0 || compactScore > 0) ? 3 : 0;
      const docssBonus = doc.sourceType === 'docss' && (titleScore > 0 || phraseScore > 0 || compactScore > 0 || tokenScore >= 2) ? 5 : 0;
      const homepageFaqDocBonus = isHomepageFaqDoc(doc) && (
        titleScore > 0
        || titlePhraseScore > 0
        || phraseScore > 0
        || compactScore > 0
        || tokenScore >= 2
      ) ? 18 : 0;
      const nasalIrrigationDocBonus = shouldPrioritizeNasalIrrigation && isNasalIrrigationDoc(doc) ? 120 : 0;
      const sourceWeight = sourceTypeWeights[doc.sourceType] ?? 0.1;
      const rawScore = keywordScore * 4
        + titleScore
        + tokenScore
        + phraseScore
        + titlePhraseScore
        + compactScore
        + localDocBonus
        + docssBonus
        + homepageFaqDocBonus
        + diseaseDocBonus
        + nasalIrrigationDocBonus;

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
        '주차 안내는 외래 방문인지 입원 예정인지에 따라 달라집니다. 외래 방문이신가요, 입원 예정이신가요?',
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
        '肄붿꽭泥??덈궡???섏닠 ?꾩씤吏 ?쇰컲 肄붿꽭泥숈씤吏???곕씪 ?щ씪吏묐땲?? ?섏닠 ??肄붿꽭泥숈씤吏, ?쇰컲 肄붿꽭泥숈씤吏 ?뚮젮二쇱꽭??',
        ['?섏닠 ??肄붿꽭泥숈씠?먯슂', '?쇰컲 肄붿꽭泥숈씠?먯슂']
      ),
    };
  }

  if (matchesAnyPattern(message, PREP_BROAD_PATTERNS) && !matchesAnyPattern(message, PREP_DETAIL_PATTERNS)) {
    return {
      topic: 'admission_prep',
      originalMessage: message,
      prompt: createGuidedQuestionResponse(
        '?낆썝?대굹 ?섏닠 以鍮꾨뒗 ??ぉ???섎돇???덉뒿?덈떎. 以鍮꾨Ъ, 二쇱감, 蹂댄샇?? ?섏닠 ??寃?? 蹂듭슜 以묐떒 ??以??대뼡 ?댁슜??沅곴툑?섏떊媛??',
        ['以鍮꾨Ъ??沅곴툑?댁슂', '二쇱감媛 沅곴툑?댁슂', '蹂댄샇?먭? 沅곴툑?댁슂', '?섏닠 ??寃?ш? 沅곴툑?댁슂', '蹂듭슜 以묐떒 ?쎌씠 沅곴툑?댁슂']
      ),
    };
  }

  if (
    matchesAnyPattern(message, postOpCarePatterns)
    && !/(肄?鍮꾩뿼|異뺣냽利?鍮꾩쨷寃?肄붾Ъ??紐??몃룄|洹|媛묒긽??移⑥깦)/u.test(String(message || ''))
  ) {
    return {
      topic: 'postop_care',
      prompt: createGuidedQuestionResponse(
        '?섏닠 ??二쇱쓽?ы빆? ?섏닠 醫낅쪟???곕씪 ?щ씪吏묐땲?? ?대뼡 ?섏닠 ??二쇱쓽?ы빆???꾩슂?쒖? ?뚮젮二쇱꽭??',
        ['肄??섏닠 ??二쇱쓽?ы빆', '紐??섏닠 ??二쇱쓽?ы빆', '洹 ?섏닠 ??二쇱쓽?ы빆', '媛묒긽???섏닠 ??二쇱쓽?ы빆', '移⑥깦 ?섏닠 ??二쇱쓽?ы빆']
      ),
    };
  }

  return null;
}

function legacyIsDoctorSpecialtyQuestion(message) {
  const text = String(message || '').trim();
  if (!text) {
    return false;
  }

  return /(의사|의료진|원장|전문의)/u.test(text)
    && /(누구|누가|알려|어디|진료|보는|전문|무슨 전문분야)/u.test(text);
}

function findDoctorSpecialtyResponse(message) {
  if (!isDoctorSpecialtyQuestion(message)) {
    return null;
  }

  const doctorName = extractDoctorName(message);
  if (doctorName) {
    const doctorEntries = (runtimeData.doctorSpecialtyEntries || []).length > 0
      ? runtimeData.doctorSpecialtyEntries
      : buildDoctorSpecialtyEntries();
    const doctorEntry = doctorEntries.find((entry) => entry.doctorName === doctorName);
    if (doctorEntry) {
      return {
        type: 'doctor_specialty',
        answer: `${doctorName} ?섎즺吏꾩쓽 ?꾨Ц遺꾩빞??${doctorEntry.specialtyText} ?낅땲??`,
        followUp: [
          '吏꾨즺 ?쇱젙? ?섎즺吏꾨퀎 ?몃옒 ?ㅼ?以꾩뿉 ?곕씪 ?щ씪吏????덉뒿?덈떎.',
        ],
        sources: [{
          title: '?덊럹?댁?-?섎즺吏??뺣낫',
          url: 'local://docs/%ED%99%88%ED%8E%98%EC%9D%B4%EC%A7%80-%EC%9D%98%EB%A3%8C%EC%A7%84%20%EC%A0%95%EB%B3%B4.txt',
        }],
      };
    }
  }

  const expandedState = buildExpandedSearchState(message);
  const doctorEntries = (runtimeData.doctorSpecialtyEntries || []).length > 0
    ? runtimeData.doctorSpecialtyEntries
    : buildDoctorSpecialtyEntries();
  const matchedEntries = doctorEntries.filter((entry) => (
    (entry.labels || []).some((label) => expandedState.normalizedVariants.some((variant) => (
      variant.includes(normalizeSearchTextSafe(label)) || normalizeSearchTextSafe(label).includes(variant)
    )))
  ));

  if (!matchedEntries.length) {
    return null;
  }

  const doctorNames = matchedEntries.map((entry) => entry.doctorName);
  const uniqueDoctors = [...new Set(doctorNames)];
  const summary = matchedEntries
    .map((entry) => `${entry.doctorName}: ${entry.specialtyText}`)
    .join('\n');

  return {
    type: 'doctor_specialty',
    answer: `愿???꾨Ц遺꾩빞 湲곗??쇰줈 ?덈궡?쒕━硫?${uniqueDoctors.join(', ')} ?섎즺吏꾩씠 ?덉뒿?덈떎.`,
    followUp: [
      '吏꾨즺 ?쇱젙? ?섎즺吏꾨퀎 ?몃옒 ?ㅼ?以꾩뿉 ?곕씪 ?щ씪吏????덉뒿?덈떎.',
      `?꾨Ц遺꾩빞 李멸퀬: ${summary}`,
    ],
    sources: [{
      title: '?덊럹?댁?-?섎즺吏??뺣낫',
      url: 'local://docs/%ED%99%88%ED%8E%98%EC%9D%B4%EC%A7%80-%EC%9D%98%EB%A3%8C%EC%A7%84%20%EC%A0%95%EB%B3%B4.txt',
    }],
  };
}

function resolveGuidedFlowMessage(message, state) {
  if (!state || !state.topic) {
    return { resolved: false };
  }

  if (state.topic === 'parking') {
    if (matchesAnyPattern(message, PARKING_OUTPATIENT_PATTERNS)) {
      return { resolved: true, message: '?몃옒 諛⑸Ц媛?二쇱감 ?덈궡' };
    }

    if (matchesAnyPattern(message, PARKING_INPATIENT_PATTERNS)) {
      return { resolved: true, message: '?낆썝 ?섏옄 二쇱감 ?덈궡' };
    }

    return {
      resolved: false,
      prompt: createGuidedQuestionResponse(
        '주차 안내를 정확히 드리려면 외래 방문인지 입원 예정인지 먼저 확인이 필요합니다. 외래 방문이신가요, 입원 예정이신가요?',
        ['외래 방문이에요', '입원 예정이에요']
      ),
    };
  }

  if (state.topic === 'nasal_irrigation') {
    if (matchesAnyPattern(message, NASAL_IRRIGATION_SURGERY_PATTERNS)) {
      return { resolved: true, message: '?섏닠 ?섏옄 肄붿꽭泥?諛⑸쾿' };
    }

    if (matchesAnyPattern(message, NASAL_IRRIGATION_GENERAL_PATTERNS)) {
      return { resolved: true, message: '?쇰컲 ?섏옄 肄붿꽭泥?諛⑸쾿' };
    }

    return {
      resolved: false,
      prompt: createGuidedQuestionResponse(
        '肄붿꽭泥??덈궡瑜?留욎떠 ?쒕━?ㅻ㈃ ?섏닠 ?꾩씤吏 ?쇰컲 肄붿꽭泥숈씤吏 ?뺤씤???꾩슂?⑸땲?? ?대뒓 寃쎌슦?몄? ?뚮젮二쇱꽭??',
        ['?섏닠 ??肄붿꽭泥숈씠?먯슂', '?쇰컲 肄붿꽭泥숈씠?먯슂']
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
        '원하시는 준비 항목을 먼저 알려주세요. 준비물, 주차, 보호자, 수술 전 검사, 복용 중단 약물 중에서 선택해 주세요.',
        ['준비물', '주차', '보호자', '수술 전 검사', '복용 중단 약물']
      ),
    };
  }

  if (state.topic === 'postop_care') {
    if (/(코|비염|축농증|비중격|코물혹)/u.test(message)) {
      return { resolved: true, message: '肄??섏닠 ??二쇱쓽?ы빆' };
    }

    if (/(목|편도)/u.test(message)) {
      return { resolved: true, message: '紐??섏닠 ??二쇱쓽?ы빆' };
    }

    if (/귀/u.test(message)) {
      return { resolved: true, message: '洹 ?섏닠 ??二쇱쓽?ы빆' };
    }

    if (/갑상선/u.test(message)) {
      return { resolved: true, message: '媛묒긽???섏닠 ??二쇱쓽?ы빆' };
    }

    if (/(침샘|이하선|악하선)/u.test(message)) {
      return { resolved: true, message: '移⑥깦 ?섏닠 ??二쇱쓽?ы빆' };
    }

    return {
      resolved: false,
      prompt: createGuidedQuestionResponse(
        '?섏닠 ??二쇱쓽?ы빆???뺥솗???덈궡?섎젮硫??섏닠 醫낅쪟瑜?癒쇱? ?뚯븘???⑸땲?? ?꾨옒 以묒뿉??怨⑤씪 二쇱꽭??',
        ['肄??섏닠 ??二쇱쓽?ы빆', '紐??섏닠 ??二쇱쓽?ы빆', '洹 ?섏닠 ??二쇱쓽?ы빆', '媛묒긽???섏닠 ??二쇱쓽?ы빆', '移⑥깦 ?섏닠 ??二쇱쓽?ы빆']
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

  if (/^(외래|입원|네|아니요|아니오|맞아요|맞습니다|수술 후|일반)/u.test(current)) {
    return false;
  }

  return /(오늘|내일|모레|이번주|월요일|화요일|수요일|목요일|금요일|진료|예약|접수|의사|원장|의료진|셔틀|주차|입원|퇴원|수술|서류|영수증|비용|금액|검사|코세척|약물|진단서)/u.test(current);
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

  if (findExamPreparationResponse(text)) {
    return { type: 'exam_preparation' };
  }

  if (isMedicationStopQuestion(text)) {
    return { type: 'medication_stop' };
  }

  if (matchesAnyPattern(text, postOpBleedingPatterns)) {
    return { type: 'postop_bleeding' };
  }

  if (isNasalIrrigationQuestion(text) && matchesAnyPattern(text, NASAL_IRRIGATION_SURGERY_PATTERNS)) {
    return { type: 'nasal_irrigation_surgery' };
  }

  if (isNasalIrrigationQuestion(text) && matchesAnyPattern(text, NASAL_IRRIGATION_GENERAL_PATTERNS)) {
    return { type: 'nasal_irrigation_general' };
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

  if (findDoctorSpecialtyResponse(text)) {
    return { type: 'doctor_specialty' };
  }

  if (normalized.includes('?덉빟') || normalized.includes('?묒닔')) {
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
    case 'exam_preparation':
      return findExamPreparationResponse(message);
    case 'medication_stop':
      return createMedicationStopResponse();
    case 'postop_bleeding':
      return createPostOpBleedingResponse();
    case 'nasal_irrigation_surgery':
      return createNasalIrrigationResponse('surgery');
    case 'nasal_irrigation_general':
      return createNasalIrrigationResponse('general');
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
    case 'doctor_specialty':
      return findDoctorSpecialtyResponse(message);
    case 'doctor_overview':
      return findDoctorOverviewResponse(message);
    case 'reservation_or_reception':
      return createReservationOrReceptionResponse();
    default:
      return null;
  }
}

function isDoctorSpecialtyQuestion(message) {
  const text = String(message || '').trim();
  if (!text) {
    return false;
  }

  const hasDoctorCue = /(\uC758\uC0AC|\uC758\uB8CC\uC9C4|\uC6D0\uC7A5|\uBD80\uC6D0\uC7A5|\uACFC\uC7A5|\uBD80\uC7A5|\uC804\uBB38\uC758)/u.test(text) || Boolean(extractDoctorName(text));
  const hasSpecialtyCue = /(\uC804\uBB38\uBD84\uC57C|\uC804\uBB38 \uBD84\uC57C|\uC804\uBB38|\uBD84\uC57C|\uBB34\uC2A8 \uC9C4\uB8CC|\uC5B4\uB5A4 \uC9C4\uB8CC|\uBBA4 \uC9C4\uB8CC|\uBB50\uC57C|\uC54C\uB824\uC918|\uC54C\uB824\uC8FC\uC138\uC694|\uAD81\uAE08)/u.test(text);
  const hasDiseaseDoctorCue = /(\uC9C4\uB8CC \uBCF4\uB294 \uC758\uC0AC|\uC9C4\uB8CC\uBCF4\uB294 \uC758\uC0AC|\uBCF4\uB294 \uC758\uC0AC|\uB204\uAC00 \uC788\uC5B4|\uB204\uAD6C \uC788\uC5B4|\uB204\uAC00 \uC788\uB098\uC694|\uB204\uAD6C \uC788\uB098\uC694|\uC798 \uBCF4\uB294 \uC758\uC0AC|\uD574\uC8FC\uB294 \uC758\uC0AC)/u.test(text);

  return (hasDoctorCue && hasSpecialtyCue) || hasDiseaseDoctorCue;
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

  if (/(지하\s*\d+\s*층|\d+\s*층).{0,12}(몇|어디|층안내|위치)/u.test(current) || /(\d+)\s*번?\s*진료실/u.test(current)) {
    return current;
  }

  const normalized = normalizeSearchTextSafe(current);
  const tokenCount = tokenizeSafe(normalized).length;
  const hasExplicitFollowUpCue = /^(그거|그건|그럼|그럼요|그다음|그 이후|다음은)/u.test(current);
  const hasTopicCarryOverCue = /^(퇴원은|입원은|주차는|준비물은|비용은|시간은|위치는|일정은)/u.test(current);
  const hasStandaloneTopic = /(오늘|내일|모레|이번주|월요일|화요일|수요일|목요일|금요일|진료|예약|접수|의사|원장|의료진|셔틀|주차|입원|퇴원|수술|서류|비용|금액|검사|코세척|약물|진단서)/u.test(current);
  const isShortQuestion = current.length <= 18 || tokenCount <= 3;
  const needsContext = (
    hasExplicitFollowUpCue
    || (hasTopicCarryOverCue && !hasStandaloneTopic)
    || (
      isShortQuestion
      && !hasStandaloneTopic
      && /(언제|어디|어떻게|얼마|가능해|가능한가요|하나요|있어|있나요|필요|필요한가요|필요해요)$/u.test(current)
    )
  );

  if (!needsContext) {
    return current;
  }

  const lastUserMessage = [...history].reverse().find((item) => item?.role === 'user' && item.content)?.content;
  if (!lastUserMessage) {
    return current;
  }

  return `${lastUserMessage}\n?꾩냽 吏덈Ц: ${current}`;
}

function extractDoctorName(text) {
  const value = String(text || '');
  if (!value) {
    return '';
  }

  const parsedDoctorNames = Array.isArray(runtimeData?.doctorNames) && runtimeData.doctorNames.length > 0
    ? runtimeData.doctorNames
    : DOCTOR_NAME_FALLBACK_LIST;
  const matchedParsedDoctorName = parsedDoctorNames.find((name) => value.includes(name));
  if (matchedParsedDoctorName) {
    return matchedParsedDoctorName;
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
  ];

  return doctorNames.find((name) => value.includes(name)) || '';
}

function isDoctorCareerQuestion(text) {
  return /(경력|학력|이력|프로필|논문|연구실적|전공|전문분야)/u.test(String(text || ''));
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

function buildFollowUpBridgeMessage(message, history) {
  const current = String(message || '').trim();
  if (!current || !Array.isArray(history) || history.length === 0) {
    return current;
  }

  const normalized = normalizeSearchTextSafe(current);
  const compact = compactSearchTextSafe(current);
  const tokenCount = tokenizeSafe(normalized).length;
  const hasStandaloneTopic = /(진료|예약|접수|의사|원장|의료진|주차|입원|퇴원|수술|서류|비용|금액|검사|코세척|약물|진단서)/u.test(current);
  const hasFollowUpCue = (
    /^(그럼|그러면|그거|그건|그다음|그 이후|입원 전은|입원전은|수술 후는|수술후는|퇴원 후는|퇴원후는|일반은요|방법은요|비용은요|시간은요|검사는요|준비물은요|서류는요|언제부터예요|언제부터에요|어떻게해요|어디예요|몇 번|몇번)/u.test(current)
    || (current.length <= 14 && /(요|나요)\??$/u.test(current))
    || ['입원은', '수술은', '퇴원은', '일반은', '검사는', '비용은', '시간은', '방법은'].some((term) => compact === compactSearchTextSafe(term) || compact.startsWith(compactSearchTextSafe(term)))
  );
  const needsBridge = hasFollowUpCue || (
    (current.length <= 24 || tokenCount <= 5)
    && !hasStandaloneTopic
    && /(언제|어떻게|몇번|몇 번|뭐|무엇|종류|방법|가능|되나|하나|있나|있나요|얼마)$/u.test(current)
  );

  if (!needsBridge) {
    return current;
  }

  const anchor = [...history]
    .reverse()
    .map((item) => item?.role === 'user' && item.content ? String(item.content).trim() : '')
    .find((content) => (
      content
      && normalizeSearchTextSafe(content) !== normalized
      && (content.length > 8 || tokenizeSafe(content).length >= 3)
    ));

  if (!anchor) {
    return current;
  }

  return `${anchor}\n?꾩냽 吏덈Ц: ${current}`;
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

async function legacyCallOpenAIStrict(question, history, contextDocs) {
  const contextText = contextDocs.map((doc, index) => (
    `[臾몄꽌 ${index + 1}] ${doc.title}\n異쒖쿂 ?좏삎: ${doc.sourceType}\n異쒖쿂: ${doc.url}\n?댁슜: ${doc.text}`
  )).join('\n\n');

  const input = history.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  input.push({
    role: 'user',
    content: [
      '?ㅼ쓬 吏덈Ц???듯빐 二쇱꽭??',
      `吏덈Ц: ${question}`,
      '',
      '諛섎뱶???꾨옒 李멸퀬 臾몄꽌留?洹쇨굅濡??듯븯?몄슂.',
      '臾몄꽌???녿뒗 ?댁슜? 異붿륫?섏? 留먭퀬 "?덊럹?댁??먯꽌 ?뺤씤?섏? ?딆뒿?덈떎"?쇨퀬 ?듯븯?몄슂.',
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
        '?뱀떊? ?섎굹?대퉬?명썑怨쇰퀝???섏옄 ?덈궡 AI?낅땲??',
        '??븷: 蹂묒썝 怨듭떇 ?덊럹?댁?? FAQ???덈뒗 ?댁슜留?洹쇨굅濡??먯뿰?ㅻ읇怨?媛꾧껐?섍쾶 ?듬??⑸땲??',
        '怨듭떇 ?덊럹?댁?? FAQ瑜?理쒖슦??洹쇨굅濡??ъ슜?섍퀬, external? 蹂댁“ 李멸퀬留??섎ŉ, low_trust??10% 鍮꾩쨷??李멸퀬 ?뺣낫濡쒕쭔 痍④툒?⑸땲??',
        '?쒕줈 異⑸룎?섎㈃ official > external > low_trust ?쒖쑝濡??곗꽑?⑸땲??',
        '湲덉?: 吏꾨떒, ?묎툒 理쒖쥌?먮떒, 泥섎갑 蹂寃? ??蹂듭슜 吏?? 異붿륫???뺣낫.',
        '?ㅽ??? 議대뙎留? 3~5臾몄옣, ?꾩슂??寃쎌슦 留덉?留?臾몄옣????쒖쟾??02-6925-1111 ?덈궡.',
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
    { pattern: /\bUPPP\b/gi, replacement: '코골이 또는 수면무호흡 관련 구강 수술' },
    { pattern: /\bPSG\b/gi, replacement: '수면다원검사' },
    { pattern: /\bLMS\b/gi, replacement: '후두 미세 수술' },
    { pattern: /\bKTP\b/gi, replacement: '레이저 수술' },
    { pattern: /\bT&A\b/gi, replacement: '편도와 아데노이드 수술' },
    { pattern: /\bAdenoidectomy\b/gi, replacement: '아데노이드 수술' },
    { pattern: /\bTonsillectomy\b/gi, replacement: '편도 수술' },
    { pattern: /\bV-?tube\b/gi, replacement: '고막 환기관 삽입술' },
    { pattern: /\bNavigation\b/gi, replacement: '영상 유도 장비를 사용하는 방식' },
    { pattern: /\bBalloon catheter Sinus Plasty\b/gi, replacement: '풍선 카테터를 이용한 부비동 수술' },
    { pattern: /\btympanotomy\b/gi, replacement: '고막 절개술' },
    { pattern: /\bfrenotomy\b/gi, replacement: '설소대 절제술' },
    { pattern: /\bfistulectomy\b/gi, replacement: '누공 절제술' },
    { pattern: /\bClosed reduction\b/gi, replacement: '비수술적 정복술' },
    { pattern: /\bepiglottectomy\b/gi, replacement: '후두개 절제술' },
  ];

  return replacements.reduce((result, { pattern, replacement }) => (
    result.replace(pattern, replacement)
  ), String(text || ''))
    .replace(/\(\s*왼쪽\s*\)/g, ' (왼쪽)')
    .replace(/\(\s*오른쪽\s*\)/g, ' (오른쪽)')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function applyPatientFriendlyTemplate(text, question) {
  const normalizedQuestion = normalizeSearchTextSafe(question);
  const isSinusQuestion = /(축농증|부비동)/.test(normalizedQuestion);
  const isRhinitisQuestion = /(비염|알레르기비염|비후성비염)/.test(normalizedQuestion);
  const isSeptumQuestion = /(비중격|비중격만곡)/.test(normalizedQuestion);

  let result = simplifyMedicalTerms(text);

  const commonReplacements = [
    { pattern: /부비동염/gi, replacement: '축농증' },
    { pattern: /기능적 내시경 부비동 수술/gi, replacement: '축농증 내시경 수술' },
    { pattern: /내시경 부비동 수술/gi, replacement: '축농증 내시경 수술' },
    { pattern: /비중격교정술/gi, replacement: '비중격 교정 수술' },
    { pattern: /하비갑개 절제술/gi, replacement: '비염 수술' },
    { pattern: /비갑개 축소술/gi, replacement: '비염 수술' },
  ];

  result = commonReplacements.reduce((value, item) => (
    value.replace(item.pattern, item.replacement)
  ), result);

  if (isSinusQuestion) {
    result = result
      .replace(/부비동/gi, '코 주변 빈 공간')
      .replace(/용종/gi, '물혹')
      .replace(/농성 분비물/gi, '고름이 섞인 콧물')
      .replace(/급성 병변/gi, '급성 염증');
  }

  if (isRhinitisQuestion) {
    result = result
      .replace(/알레르기비염/gi, '코 알레르기')
      .replace(/비후성비염/gi, '코 점막이 붓는 비염')
      .replace(/점막 절제/gi, '점막을 줄이는 수술')
      .replace(/점막 비후/gi, '점막이 많이 부어 있는 상태');
  }

  if (isSeptumQuestion) {
    result = result
      .replace(/비중격만곡증/gi, '코 안쪽 벽이 휘어진 상태')
      .replace(/비중격/gi, '코 안쪽 벽')
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
    ['잘있어', 'bye', 'goodbye', '종료', '끝', '그만', '수고하세요'].includes(normalized)
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
      answer: '안녕하세요. 하나이비인후과병원 안내 상담봇입니다. 예약, 진료시간, 입원, 셔틀버스 같은 병원 안내를 도와드릴게요.',
      followUp: ['진료시간 알려줘', '셔틀버스 시간 알려줘', '입원 안내 알려줘'],
    };
  }

  if (intent === 'thanks') {
    return {
      type: 'smalltalk',
      answer: '네, 필요하신 내용이 있으면 이어서 말씀해 주세요. 병원 안내 질문이면 바로 도와드릴게요.',
      followUp: [],
    };
  }

  if (intent === 'closing') {
    return {
      type: 'smalltalk',
      answer: '네, 필요하실 때 다시 말씀해 주세요. 급한 문의는 대표전화 02-6925-1111로 바로 연락해 주세요.',
      followUp: [],
    };
  }

  return null;
}

async function callOpenAI(question, history, contextDocs) {
  const contextText = contextDocs.map((doc, index) => (
    `[臾몄꽌 ${index + 1}] ${doc.title}\n異쒖쿂 ?좏삎: ${doc.sourceType}\n異쒖쿂: ${doc.url}\n?댁슜: ${doc.text}`
  )).join('\n\n');

  const input = history.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  input.push({
    role: 'user',
    content: [
      '?ㅼ쓬 吏덈Ц???듯빐 二쇱꽭??',
      `吏덈Ц: ${question}`,
      '',
      '?꾨옒 李멸퀬 臾몄꽌瑜??곗꽑 洹쇨굅濡??ъ슜??二쇱꽭??',
      '臾몄꽌???덈뒗 ?ъ떎? ?뺥솗??吏?ㅻ릺, ?ㅻ챸? 蹂묒썝 ?곷떞 吏곸썝泥섎읆 ?먯뿰?ㅻ읇怨?移쒖젅?섍쾶 ??댁꽌 ?듯빐 二쇱꽭??',
      '蹂묒썝 ?뺣낫媛 臾몄꽌???놁쑝硫??⑥젙?섏? 留먭퀬, ?뺤씤???대졄?ㅺ퀬 ?먯뿰?ㅻ읇寃??덈궡??二쇱꽭??',
      '吏㏃? 吏덈Ц?댁뼱???꾩슂?섎㈃ 1~2臾몄옣 ?뺣룄 留λ씫???㏓텤???댄빐?섍린 ?쎄쾶 ?ㅻ챸?대룄 ?⑸땲??',
      '?듬? ?몄뼱???ъ슜?먯쓽 留덉?留?吏덈Ц ?몄뼱瑜?洹몃?濡??곕Ⅴ?몄슂. ?곸뼱 吏덈Ц?먮뒗 ?곸뼱濡? ?쒓뎅??吏덈Ц?먮뒗 ?쒓뎅?대줈 ?듯븯?몄슂.',
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
          '?뱀떊? ?섎굹?대퉬?명썑怨쇰퀝???덈궡 ?곷떞 ?꾩슦誘몄엯?덈떎.',
          '?듬? ?ㅼ? ?깅뵳??梨쀫큸蹂대떎 ?ㅼ젣 ?곷떞?먯뿉 媛源앷쾶, 移쒖젅?섍퀬 ?먯뿰?ㅻ읇寃??좎??섏꽭??',
          '蹂묒썝 ?댁쁺 ?뺣낫???쒓났??臾몄꽌瑜?理쒖슦??洹쇨굅濡??ъ슜?섏꽭??',
          'local 臾몄꽌? FAQ瑜?媛???곗꽑?섍퀬, official ?덊럹?댁???洹??ㅼ쓬, external? 蹂댁“ 李멸퀬留??ъ슜?섏꽭??',
          '臾몄꽌???녿뒗 蹂묒썝 ?뺣낫??異붿륫?섏? 留먭퀬 ?뺤씤???대졄?ㅺ퀬 ?먯뿰?ㅻ읇寃??덈궡?섏꽭??',
          '臾몄꽌???덈뒗 ?ъ떎??洹몃?濡?諛섎났留??섏? 留먭퀬, 吏덈Ц ?섎룄??留욊쾶 ?뺣━?댁꽌 ?ㅻ챸?섏꽭??',
          '?덉쟾??踰붿쐞?먯꽌???댁쑀, ?덉감, 以鍮꾩궗?? 二쇱쓽??媛숈? 留λ씫 ?ㅻ챸??1~2臾몄옣 ?㏓텤?щ룄 ?⑸땲??',
          '?⑥닚 ?몄궗, 媛먯궗, ????곌껐 臾몄옣? 臾몄꽌 ?몄슜 ?놁씠???먯뿰?ㅻ읇寃??묐떟?대룄 ?⑸땲??',
          '?듬? ?몄뼱???ъ슜?먯쓽 留덉?留?吏덈Ц ?몄뼱瑜?洹몃?濡??곕Ⅴ?몄슂. ?곸뼱 吏덈Ц?먮뒗 ?곸뼱濡? ?쒓뎅??吏덈Ц?먮뒗 ?쒓뎅?대줈 ?듯븯?몄슂.',
          '湲덉?: 吏꾨떒, ?묎툒 理쒖쥌?먮떒, 泥섎갑 蹂寃? ??蹂듭슜 吏?? 異붿륫???섎즺?뺣낫.',
          '?듬?? 蹂댄넻 3~6臾몄옣?쇰줈 ?섎릺 ?ν솴?섍쾶 ?섏뼱?볦? 留먭퀬 ?듭떖 ?꾩＜濡??ㅻ챸?섏꽭??',
          '??쒖쟾??02-6925-1111 ?덈궡??瑗??꾩슂???뚮쭔 ?㏓텤?댁꽭??',
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
    `[臾몄꽌 ${index + 1}] ${doc.title}\n異쒖쿂: ${doc.url}\n?댁슜 ?붿빟: ${String(doc.text || '').slice(0, 700)}`
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
          'Mark valid=false if the answer shifts to a different topic, answers the wrong question, or adds specific hospital facts not supported by the documents.',
          'Natural paraphrasing, polite framing, and brief explanatory wording are allowed when the core facts remain supported.',
          'Be strict about topic mismatch, but do not reject answers only because they sound conversational.',
        ].join(' '),
        input: [{
          role: 'user',
          content: [
            `吏덈Ц: ${question}`,
            `?듬?: ${answer}`,
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
  const rawIntent = classifyUserIntent(buildIntentProbeMessage(message));

  if (!message) {
    return enrichResponsePayload(createWelcomeResponse(), message);
  }

  const directDoctorSpecialtyResponse = findDoctorSpecialtyResponse(message);
  if (directDoctorSpecialtyResponse) {
    return enrichResponsePayload(directDoctorSpecialtyResponse, message);
  }

  const directDoctorOverviewResponse = findDoctorOverviewResponse(message);
  if (directDoctorOverviewResponse) {
    return enrichResponsePayload(directDoctorOverviewResponse, message);
  }

  const looseTopicResponse = findLooseTopicResponse(message);
  if (looseTopicResponse) {
    return enrichResponsePayload(looseTopicResponse, message);
  }

  if (/(예약|접수)/u.test(message) && rawIntent.type === 'reservation_or_reception') {
    return enrichResponsePayload(createReservationOrReceptionResponse(), message);
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
  effectiveMessage = buildFollowUpBridgeMessage(effectiveMessage, history);
  const intentProbeMessage = buildIntentProbeMessage(effectiveMessage);
  const preRetrievalIntent = classifyUserIntent(intentProbeMessage);
  const preRetrievalIntentResponse = resolveIntentResponse(preRetrievalIntent.type, intentProbeMessage);

  if (preRetrievalIntentResponse) {
    return enrichResponsePayload(preRetrievalIntentResponse, message);
  }

  const preRetrievalDoctorOverviewResponse = findDoctorOverviewResponse(intentProbeMessage);
  if (preRetrievalDoctorOverviewResponse) {
    return enrichResponsePayload(preRetrievalDoctorOverviewResponse, message);
  }

  const preRetrievalLooseTopicResponse = findLooseTopicResponse(intentProbeMessage);
  if (preRetrievalLooseTopicResponse) {
    return enrichResponsePayload(preRetrievalLooseTopicResponse, message);
  }

  const retrievalMessage = await buildKoreanRetrievalQuery(intentProbeMessage, history);
  const intent = classifyUserIntent(retrievalMessage);

  const intentResponse = resolveIntentResponse(intent.type, retrievalMessage);
  if (intentResponse) {
    return enrichResponsePayload(intentResponse, message);
  }

  const doctorOverviewResponse = findDoctorOverviewResponse(retrievalMessage);
  if (doctorOverviewResponse) {
    return enrichResponsePayload(doctorOverviewResponse, message);
  }

  const retrievalLooseTopicResponse = findLooseTopicResponse(retrievalMessage);
  if (retrievalLooseTopicResponse) {
    return enrichResponsePayload(retrievalLooseTopicResponse, message);
  }

  const smallTalkIntent = getSmallTalkIntent(retrievalMessage);
  if (smallTalkIntent) {
    return enrichResponsePayload(createSmallTalkResponse(smallTalkIntent), message);
  }

  const cachedResponse = getCachedResponse(retrievalMessage);
  if (cachedResponse) {
    if (!(cachedResponse.type === 'faq' && shouldPreferGenerativeDocAnswer(retrievalMessage, cachedResponse))) {
      return cachedResponse;
    }
  }

  const matchedDiseaseTerms = getMatchedHomepageDiseaseTerms(retrievalMessage);
  const shouldPrioritizeDiseaseDocs = matchedDiseaseTerms.length > 0;
  const shouldPrioritizeNasalIrrigationDocs = isNasalIrrigationQuestion(retrievalMessage);
  const shouldPreferHomepageFaqDocResponse = shouldPreferHomepageFaqDocs(retrievalMessage);

  const directFaqResponse = shouldPrioritizeDiseaseDocs || shouldPrioritizeNasalIrrigationDocs || shouldPreferHomepageFaqDocResponse
    ? null
    : findDirectFaqMatch(retrievalMessage);
  if (directFaqResponse) {
    if (shouldPreferGenerativeDocAnswer(retrievalMessage, directFaqResponse)) {
      // Let document-grounded AI answer broader or more conversational questions
      // so responses feel less templated while keeping source-backed safety.
    } else {
      const simplifiedFaqResponse = {
        ...directFaqResponse,
        answer: appendSupportLinks(applyPatientFriendlyTemplate(directFaqResponse.answer, effectiveMessage), message),
        followUp: (directFaqResponse.followUp || []).map((item) => applyPatientFriendlyTemplate(item, message)),
        images: findRelevantImages(message),
      };
      setCachedResponse(retrievalMessage, simplifiedFaqResponse);
      return simplifiedFaqResponse;
    }
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
        answer: 'AI ?묐떟 泥섎━ 以??ㅻ쪟媛 諛쒖깮?덉뒿?덈떎. ?좎떆 ???ㅼ떆 ?쒕룄??二쇱꽭??',
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

function handleApiAdminLogsExport(req, res, requestUrl) {
  const items = buildWrongAnswerExportRows(requestUrl.searchParams);
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const fileName = `wrong-answer-notes-${timestamp}.json`;
  const payload = JSON.stringify(items, null, 2);

  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function handleApiAdminSessionNote(req, res) {
  let body = '';

  req.on('data', (chunk) => {
    body += chunk;
  });

  req.on('end', () => {
    try {
      const parsed = JSON.parse(body || '{}');
      const updated = updateSessionNoteForAdmin(parsed.sessionId, parsed.flag, parsed.note);
      if (!updated) {
        sendJson(res, 400, {
          ok: false,
          error: 'sessionId is required',
        });
        return;
      }

      sendJson(res, 200, {
        ok: true,
        item: updated,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      sendJson(res, 400, {
        ok: false,
        error: 'Invalid payload',
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
    items: getSessionLogsForAdmin(sessionId, requestUrl.searchParams.get('limit')),
    sessionNote: getSessionNoteForAdmin(sessionId),
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

  if (req.method === 'GET' && pathname === '/api/admin/logs/export') {
    handleApiAdminLogsExport(req, res, requestUrl);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/admin/session-note') {
    handleApiAdminSessionNote(req, res);
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
