const http = require('http');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { DatabaseSync } = require('node:sqlite');
const XLSX = require('xlsx');
const CPEXCEL = require('xlsx/dist/cpexcel.js');
const { createSemanticSearchService } = require('./lib/semantic-search');
const { classifyIntentMeaning } = require('./lib/intent-classifier');

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
const EVAL_SOURCE_DIR = path.join(__dirname, 'eval');
const EVAL_DIR = process.env.EVAL_DATA_DIR
  ? path.resolve(process.env.EVAL_DATA_DIR)
  : (IS_RENDER ? path.join(PERSISTENT_DATA_DIR, 'eval') : EVAL_SOURCE_DIR);
const SEED_QUESTIONS_PATH = path.join(EVAL_DIR, 'seed-questions.json');
const WRONG_ANSWERS_PATH = path.join(EVAL_DIR, 'wrong-answers.json');
const DOCS_DIR = path.join(__dirname, 'docs');
const INTEGRATED_FAQ_DOC_FILENAME = findExistingDocFilename([
  '통합-FAQ.txt',
  '통합-faq.txt',
  '홈페이지-FAQ.txt',
  '병동-FAQ.txt',
  '원무-FAQ.txt',
]) || '통합-FAQ.txt';
const INTEGRATED_FAQ_DOC_TITLE = path.parse(INTEGRATED_FAQ_DOC_FILENAME).name;
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
  local: 1.8,
  external: 0.2,
  low_trust: 0.1,
};
const SEARCH_TOKEN_STOPWORDS = new Set([
  '안내', '알려줘', '알려주세요', '궁금해요', '궁금합니다', '문의', '질문',
  '가능', '가능한가요', '가능할까요', '있나요', '있어요', '되나요', '될까요',
  '어떻게', '어디', '언제', '얼마', '무엇', '뭐야', '뭐예요', '뭐에요',
  '관련', '자세히', '설명', '좀', '주세요', '하나요', '하나',
  '병원', '하나이비인후과병원', '하나이비인후과',
]);

function findExistingDocFilename(candidates) {
  if (!fs.existsSync(DOCS_DIR)) {
    return '';
  }

  const actualNames = fs.readdirSync(DOCS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);
  const lowerNameMap = new Map(actualNames.map((name) => [name.toLowerCase(), name]));

  return (candidates || [])
    .map((name) => String(name || '').trim())
    .filter(Boolean)
    .map((name) => lowerNameMap.get(name.toLowerCase()) || '')
    .find(Boolean) || '';
}
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
const ADMISSION_PREP_ITEMS_PATTERNS = [
  /입원\s*준비물/u,
  /입원\s*시\s*준비물/u,
  /입원\s*전\s*준비물/u,
  /입원.*(챙겨|챙길|가져|준비해야|준비할)/u,
  /(준비물|챙겨야|가져가야).{0,12}입원/u,
];

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

const inpatientAmenityPatterns = [
  /가습기/u,
  /전자\s*레인지/u,
  /전자\s*렌지/u,
  /배달\s*음식/u,
  /배달음식/u,
  /병동.{0,12}(비치|구비|있어|있나요|사용|가능).{0,12}(가습기|전자\s*레인지|전자\s*렌지)/u,
  /(가습기|전자\s*레인지|전자\s*렌지).{0,12}(비치|구비|있어|있나요|사용|가능)/u,
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

const guardianVisitPatterns = [
  /면회/u,
  /면회객/u,
  /방문객/u,
  /보호자.{0,12}(면회|방문|출입|들어|입실)/u,
  /(입원|병동|수술).{0,12}(면회|보호자|방문객)/u,
  /보호자.{0,12}(같이|함께|상주|있을|계실|머물)/u,
  /보호자.{0,12}(문자|연락|진행|상태|알림)/u,
  /수술.{0,12}(진행|상태).{0,12}(문자|연락|알림|보호자)/u,
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
ensureEvalDataFiles();
warnIfRenderPersistenceIsMisconfigured();
const chatLogDb = createChatLogDatabase();
let docsWatchDebounceTimer = null;
let pendingDoctorDocsUpdate = false;
let doctorScheduleSyncInProgress = false;
let doctorScheduleSyncQueued = false;
let runtimeData = null;
let semanticSearchService = null;
let docsWatcher = null;

function readJsonArray(filePath) {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return Array.isArray(parsed) ? parsed : [];
}

function writeJsonArray(filePath, items) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(Array.isArray(items) ? items : [], null, 2)}\n`, 'utf8');
}

function ensurePersistentDataDir() {
  fs.mkdirSync(PERSISTENT_DATA_DIR, { recursive: true });
}

function ensureEvalDataFiles() {
  fs.mkdirSync(EVAL_DIR, { recursive: true });

  if (path.resolve(EVAL_DIR) === path.resolve(EVAL_SOURCE_DIR)) {
    return;
  }

  ['seed-questions.json', 'wrong-answers.json'].forEach((fileName) => {
    const targetPath = path.join(EVAL_DIR, fileName);
    const sourcePath = path.join(EVAL_SOURCE_DIR, fileName);
    if (!fs.existsSync(targetPath) && fs.existsSync(sourcePath)) {
      fs.copyFileSync(sourcePath, targetPath);
    }
  });
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
    integratedFaqCards: buildIntegratedFaqCards(),
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
  if (semanticSearchService) {
    semanticSearchService.invalidate(reason);
  }
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

  const sources = safeJsonParseArray(row.sources).map((source) => ({
    ...source,
    title: repairBrokenKoreanText(source?.title || ''),
    url: source?.url || '',
    sourceTitle: repairBrokenKoreanText(source?.sourceTitle || ''),
    description: repairBrokenKoreanText(source?.description || ''),
  }));

  return {
    id: row.id,
    timestamp: row.timestamp,
    sessionId: row.session_id || '',
    question: repairBrokenKoreanText(row.question || ''),
    answer: repairBrokenKoreanText(row.answer || ''),
    followUp: safeJsonParseArray(row.follow_up),
    answerFull: repairBrokenKoreanText(row.answer_full || row.answer || ''),
    type: row.type || 'unknown',
    sources,
    flag: row.flag === 'normal' && !row.reviewed_at ? '' : (row.flag || ''),
    note: repairBrokenKoreanText(row.note || ''),
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

function normalizeEvalQuestionKey(question) {
  return normalizeSearchTextSafe(question);
}

function removeEvalCaseByQuestion(filePath, question) {
  const key = normalizeEvalQuestionKey(question);
  if (!key || !fs.existsSync(filePath)) {
    return;
  }

  const items = readJsonArray(filePath);
  const filtered = items.filter((item) => normalizeEvalQuestionKey(item?.question) !== key);
  if (filtered.length !== items.length) {
    writeJsonArray(filePath, filtered);
  }
}

function upsertEvalCase(filePath, question, entry) {
  const key = normalizeEvalQuestionKey(question);
  if (!key) {
    return;
  }

  const items = readJsonArray(filePath);
  const index = items.findIndex((item) => normalizeEvalQuestionKey(item?.question) === key);
  const nextEntry = {
    ...(index >= 0 ? items[index] : {}),
    ...entry,
    question: String(question || '').trim(),
    updatedAt: new Date().toISOString(),
  };

  if (index >= 0) {
    items[index] = nextEntry;
  } else {
    items.push(nextEntry);
  }

  writeJsonArray(filePath, items);
}

function parseAdminReviewNote(value) {
  const text = String(value || '').trim();
  const empty = {
    expectedIntent: '',
    expectedSource: '',
    expectedAnswerHint: '',
    adminNote: '',
  };

  if (!text) {
    return empty;
  }

  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ...empty, adminNote: text };
    }

    return {
      expectedIntent: String(parsed.expectedIntent || '').trim(),
      expectedSource: String(parsed.expectedSource || '').trim(),
      expectedAnswerHint: String(parsed.expectedAnswerHint || '').trim(),
      adminNote: String(parsed.adminNote || '').trim(),
    };
  } catch (error) {
    return {
      ...empty,
      expectedAnswerHint: text,
      adminNote: text,
    };
  }
}

function syncAdminReviewToEvalFiles(logItem) {
  if (!logItem || !String(logItem.question || '').trim()) {
    return;
  }

  const question = String(logItem.question || '').trim();
  const flag = String(logItem.flag || '');
  const reviewNote = parseAdminReviewNote(logItem.note);
  const note = reviewNote.adminNote || reviewNote.expectedAnswerHint || String(logItem.note || '').trim();
  const answerFull = String(logItem.answerFull || logItem.answer || '').trim();
  const sourceTitles = (Array.isArray(logItem.sources) ? logItem.sources : [])
    .map((source) => String(source?.title || source?.url || '').trim())
    .filter(Boolean);

  try {
    if (flag === 'normal') {
      upsertEvalCase(SEED_QUESTIONS_PATH, question, {
        caseType: 'admin_normal',
        expectedIntent: reviewNote.expectedIntent || String(logItem.type || '').trim() || undefined,
        expectedSource: reviewNote.expectedSource || sourceTitles.join(' / ') || undefined,
        expectedAnswerHint: reviewNote.expectedAnswerHint || note || answerFull.slice(0, 500),
        adminNote: reviewNote.adminNote || '',
        reviewedLogId: logItem.id || '',
      });
      removeEvalCaseByQuestion(WRONG_ANSWERS_PATH, question);
      return;
    }

    if (flag === 'needs_review') {
      upsertEvalCase(WRONG_ANSWERS_PATH, question, {
        caseType: 'actual_wrong_answer',
        wrongAnswer: answerFull,
        expectedIntent: reviewNote.expectedIntent || '',
        expectedSource: reviewNote.expectedSource || sourceTitles.join(' / ') || '',
        expectedAnswerHint: reviewNote.expectedAnswerHint || note || '관리자 메모에 기대 답변 방향을 적어 주세요.',
        adminNote: reviewNote.adminNote || '',
        reviewedLogId: logItem.id || '',
      });
      removeEvalCaseByQuestion(SEED_QUESTIONS_PATH, question);
      return;
    }

    removeEvalCaseByQuestion(SEED_QUESTIONS_PATH, question);
    removeEvalCaseByQuestion(WRONG_ANSWERS_PATH, question);
  } catch (error) {
    console.error('[eval-sync-error]', error);
  }
}

function getAdminEvalStatus() {
  return {
    ok: true,
    cwd: __dirname,
    evalDir: EVAL_DIR,
    seedQuestionsPath: SEED_QUESTIONS_PATH,
    wrongAnswersPath: WRONG_ANSWERS_PATH,
    seedQuestionsCount: readJsonArray(SEED_QUESTIONS_PATH).length,
    wrongAnswersCount: readJsonArray(WRONG_ANSWERS_PATH).length,
    timestamp: new Date().toISOString(),
  };
}

function updateChatLogFlag(logId, flag, note = '') {
  chatLogDb.prepare(`
    UPDATE chat_logs
    SET flag = ?, note = ?, reviewed_at = ?
    WHERE id = ?
  `).run(
    String(flag || ''),
    String(note || '').trim(),
    flag ? new Date().toISOString() : null,
    String(logId)
  );

  const updated = mapChatLogRow(
    chatLogDb.prepare(`SELECT * FROM chat_logs WHERE id = ?`).get(String(logId))
  );
  syncAdminReviewToEvalFiles(updated);
  return updated;
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
    if (flag === 'normal') {
      conditions.push('reviewed_at IS NOT NULL');
    }
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
    if (flag === 'normal') {
      conditions.push('reviewed_at IS NOT NULL');
    }
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
  return buildWrongAnswerEvalRows(query).map((row) => ({
    question: row.question,
    ...row.entry,
  }));
}

function buildSeedQuestionExportRows(query) {
  return buildSeedQuestionEvalRows(query).map((row) => ({
    question: row.question,
    ...row.entry,
  }));
}

function buildSeedQuestionEvalRows(query) {
  const exportQuery = new URLSearchParams();
  const getQueryValue = (key) => (typeof query?.get === 'function' ? query.get(key) : query?.[key]);
  const search = String(getQueryValue('q') || '').trim();
  const startAt = String(getQueryValue('startAt') || '').trim();
  const endAt = String(getQueryValue('endAt') || '').trim();

  exportQuery.set('flag', 'normal');
  if (search) {
    exportQuery.set('q', search);
  }
  if (startAt) {
    exportQuery.set('startAt', startAt);
  }
  if (endAt) {
    exportQuery.set('endAt', endAt);
  }

  return getChatLogsForAdmin(exportQuery, { disableLimit: true })
    .map((item) => {
      const question = String(item.question || '').trim();
      if (!question || !item.reviewedAt) {
        return null;
      }

      const reviewNote = parseAdminReviewNote(item.note);
      const answerFull = String(item.answerFull || item.answer || '').trim();
      const sourceTitles = (Array.isArray(item.sources) ? item.sources : [])
        .map((source) => String(source?.title || source?.url || '').trim())
        .filter(Boolean);

      return {
        question,
        entry: {
          caseType: 'admin_normal',
          expectedIntent: reviewNote.expectedIntent || String(item.type || '').trim() || '',
          expectedSource: reviewNote.expectedSource || sourceTitles.join(' / ') || '',
          expectedAnswerHint: reviewNote.expectedAnswerHint || reviewNote.adminNote || answerFull.slice(0, 500),
          adminNote: reviewNote.adminNote || '',
          reviewedLogId: item.id || '',
        },
      };
    })
    .filter(Boolean);
}

function buildWrongAnswerEvalRows(query) {
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

  return getChatLogsForAdmin(exportQuery, { disableLimit: true })
    .map((item) => {
      const question = String(item.question || '').trim();
      if (!question) {
        return null;
      }

      const reviewNote = parseAdminReviewNote(item.note);
      const answerFull = String(item.answerFull || item.answer || '').trim();
      const sourceTitles = (Array.isArray(item.sources) ? item.sources : [])
        .map((source) => String(source?.title || source?.url || '').trim())
        .filter(Boolean);

      return {
        question,
        entry: {
          caseType: 'actual_wrong_answer',
          wrongAnswer: answerFull,
          expectedIntent: reviewNote.expectedIntent || '',
          expectedSource: reviewNote.expectedSource || sourceTitles.join(' / ') || '',
          expectedAnswerHint: reviewNote.expectedAnswerHint || reviewNote.adminNote || '관리자 메모에 기대 답변 방향을 적어 주세요.',
          adminNote: reviewNote.adminNote || '',
          reviewedLogId: item.id || '',
        },
      };
    })
    .filter(Boolean);
}

function saveWrongAnswerEvalRows(query) {
  const rows = buildWrongAnswerEvalRows(query);

  rows.forEach((row) => {
    upsertEvalCase(WRONG_ANSWERS_PATH, row.question, row.entry);
    removeEvalCaseByQuestion(SEED_QUESTIONS_PATH, row.question);
  });

  return {
    ok: true,
    savedCount: rows.length,
    wrongAnswersPath: WRONG_ANSWERS_PATH,
    seedQuestionsPath: SEED_QUESTIONS_PATH,
    wrongAnswersCount: readJsonArray(WRONG_ANSWERS_PATH).length,
    timestamp: new Date().toISOString(),
  };
}

function saveSeedQuestionEvalRows(query) {
  const rows = buildSeedQuestionEvalRows(query);

  rows.forEach((row) => {
    upsertEvalCase(SEED_QUESTIONS_PATH, row.question, row.entry);
    removeEvalCaseByQuestion(WRONG_ANSWERS_PATH, row.question);
  });

  return {
    ok: true,
    savedCount: rows.length,
    seedQuestionsPath: SEED_QUESTIONS_PATH,
    wrongAnswersPath: WRONG_ANSWERS_PATH,
    seedQuestionsCount: readJsonArray(SEED_QUESTIONS_PATH).length,
    timestamp: new Date().toISOString(),
  };
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
  res.end(JSON.stringify(sanitizeOutgoingPayload(payload)));
}

function readJsonRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];

    req.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString('utf8');
        resolve(JSON.parse(body || '{}'));
      } catch (error) {
        reject(error);
      }
    });

    req.on('error', reject);
  });
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
  if (!isGoodPopularQuestion(question)) {
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

function isGoodPopularQuestion(question) {
  const value = String(question || '').trim();
  const normalized = normalizeSearchTextSafe(value);

  if (!normalized) {
    return false;
  }

  if (getSmallTalkIntent(value)) {
    return false;
  }

  if (/^(수술|검사|서류|비용|금액|입원|진료)\s*(알려줘|안내|설명)?$/u.test(value)) {
    return false;
  }

  const tokens = getInformativeSearchTokens(value);
  return value.length >= 4 && tokens.some((token) => !SEARCH_TOKEN_STOPWORDS.has(token));
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
      && isGoodPopularQuestion(item.question)
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
      answer: '질문이 너무 빠르게 이어지고 있습니다. 1분 정도 뒤에 다시 시도해 주세요.',
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
      answer: '오늘 이 세션의 사용 한도에 도달했습니다. 내일 다시 이용해 주세요.',
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

function looksLikeBrokenKoreanText(value) {
  const text = String(value || '');
  return /[\uF900-\uFAFF]|[\u3400-\u9FFF]{2,}|(?:\?[가-힣])|(?:\?{2,})/.test(text);
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
  if (!result) {
    return result;
  }

  if (looksLikeBrokenKoreanText(result)) {
    result = result.replace(/[\u3400-\u9FFF\uF900-\uFAFF?]{2,}/g, (token) => (
      /[\u3400-\u9FFF\uF900-\uFAFF]/.test(token) ? decodeCompatMojibakeToken(token) : token
    ));
  }

  return result
    .replace(/\u0000/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
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

function isChatLikePayload(payload) {
  return Boolean(
    payload
    && typeof payload === 'object'
    && (
      typeof payload.answer === 'string'
      || Array.isArray(payload.followUp)
      || Array.isArray(payload.sources)
      || Array.isArray(payload.images)
    )
  );
}

function textHasMojibake(value) {
  const text = String(value || '');
  if (!text) {
    return false;
  }

  return /\uFFFD|[\uF900-\uFAFF]|[\u3400-\u9FFF]{2,}|(?:\?[가-힣])|(?:\?{2,})/.test(text);
}

function collectPayloadStrings(value, result = []) {
  if (typeof value === 'string') {
    result.push(value);
    return result;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectPayloadStrings(item, result));
    return result;
  }

  if (value && typeof value === 'object') {
    Object.values(value).forEach((item) => collectPayloadStrings(item, result));
  }

  return result;
}

function payloadHasMojibake(payload) {
  return collectPayloadStrings(payload).some((value) => textHasMojibake(value));
}

function createMojibakeSafeFallback(originalPayload = {}) {
  return {
    type: `sanitized_${originalPayload.type || 'fallback'}`,
    answer: '현재 확인된 문서 기준으로 바로 안내드리기 어려운 질문입니다. 질문을 조금 더 구체적으로 남겨 주시거나 대표전화 02-6925-1111로 확인해 주세요.',
    followUp: ['진료시간 알려줘', '의료진 안내해줘', '서류 발급 방법 알려줘'],
    sources: [],
    images: [],
  };
}

function sanitizeOutgoingPayload(payload) {
  if (!isChatLikePayload(payload)) {
    return payload;
  }

  const repaired = repairChatPayloadFields(payload);
  if (payloadHasMojibake(repaired)) {
    return createMojibakeSafeFallback(repaired);
  }

  return repaired;
}

function shouldUseConsultationTone(payload) {
  const type = String(payload?.type || '');
  return ![
    'smalltalk',
    'welcome',
    'guided_question',
    'privacy_warning',
    'config_error',
    'emergency',
    'restricted',
    'request_blocked',
    'rate_limited',
    'error',
    'fallback_insufficient_evidence',
    'fallback_needs_clarification',
    'fallback_inference',
    'fallback_restricted',
    'consultation_clarification',
    'parking_info',
    'nasal_irrigation_surgery',
    'nasal_irrigation_general',
    'network_hospital_info',
    'guardian_meal',
    'referral_document',
    'pharmacy_location',
    'mounjaro_fee',
    'representative_nonpay',
    'rhinoplasty_consult',
    'smoking_policy',
    'tonsil_postop_bleeding',
  ].includes(type);
}

function getConsultationTopicLabel(payload, question) {
  const type = String(payload?.type || '');
  const text = String(question || '');

  if (/doctor|medical_staff|의료진|의사|원장/u.test(type) || /(의료진|의사|원장|전문분야|진료과)/u.test(text)) {
    return '의료진 관련해서';
  }

  if (/reservation|reception|예약|접수/u.test(type) || /(예약|접수)/u.test(text)) {
    return '예약과 접수 관련해서';
  }

  if (/surgery|postop|operation|수술/u.test(type) || /(수술|수술후|수술 후)/u.test(text)) {
    return '수술 관련해서';
  }

  if (/fee|cost|nonpay|payment|비용|금액|비급여|수납/u.test(type) || /(비용|금액|얼마|비급여|수납)/u.test(text)) {
    return '비용 관련해서';
  }

  if (/exam|test|검사/u.test(type) || /(검사|검진)/u.test(text)) {
    return '검사 관련해서';
  }

  if (/inpatient|admission|ward|입원|병동/u.test(type) || /(입원|병동|병실|보호자)/u.test(text)) {
    return '입원 생활 관련해서';
  }

  if (/document|receipt|certificate|서류|영수증/u.test(type) || /(서류|영수증|진료비|세부내역|증명서)/u.test(text)) {
    return '서류 발급 관련해서';
  }

  if (/shuttle|parking|transport|셔틀|주차/u.test(type) || /(셔틀|주차|오시는 길|교통)/u.test(text)) {
    return '내원 안내 관련해서';
  }

  if (/medication|medicine|약/u.test(type) || /(약|복용|중단|금지약)/u.test(text)) {
    return '약 복용 안내 관련해서';
  }

  return '문의하신 내용에 대해';
}

function startsWithConsultationLead(answer) {
  const text = String(answer || '').trim();
  return /^(안내드릴게요|안내드립니다|.+관련해서\s+안내드릴게요|문의하신 내용에 대해\s+안내드릴게요)[.!?\n\s]/u.test(text)
    || /^.+관련해서\s+안내드릴게요[.!?]?$/u.test(text);
}

function applyConsultationTone(payload, question) {
  if (!shouldUseConsultationTone(payload) || isEnglishDominantText(question)) {
    return payload;
  }

  const answer = String(payload.answer || '').trim();
  if (!answer || startsWithConsultationLead(answer)) {
    return payload;
  }

  const lead = `${getConsultationTopicLabel(payload, question)} 안내드릴게요.`;
  return {
    ...payload,
    answer: `${lead}\n\n${answer}`,
  };
}

function enrichResponsePayload(payload, question) {
  if (!payload || typeof payload !== 'object') {
    return payload;
  }

  const localizedPayload = repairChatPayloadFields(localizeFixedResponsePayload(payload, question));
  const consultationPayload = applyConsultationTone(localizedPayload, question);
  const images = Array.isArray(localizedPayload.images) && localizedPayload.images.length > 0
    ? localizedPayload.images
    : findRelevantImages(question);
  const shouldAppendSupportLinks = ![
    'doctor_specialty',
    'doctor_overview',
    'smalltalk',
    'welcome',
    'guided_question',
    'privacy_warning',
    'config_error',
    'emergency',
    'restricted',
    'hearing_test_process',
    'tonsillectomy_info',
    'rhinitis_exam_info',
    'exam_type_clarification',
    'doctor_career',
    'payment_method',
    'first_return_visit_process',
    'waiting_time_visit',
    'clinic_hours_night_weekend',
    'referral_document',
    'hospital_location',
    'doctor_schedule_image',
    'room_fee',
    'symptom_visit_guidance',
    'ear_fullness_hearing_loss',
    'center_doctor_list',
    'sinusitis_care',
    'throat_mass_care',
    'discharge_time',
    'facility_location',
    'anti_aging_clinic_location',
    'pharmacy_location',
    'exam_location',
    'accessibility_support',
    'medical_record_copy',
    'result_notification',
    'infection_prevention',
    'additional_consultation',
    'mounjaro_fee',
    'representative_nonpay',
    'rhinoplasty_consult',
    'smoking_policy',
    'tonsil_postop_bleeding',
  ].includes(localizedPayload.type);

  return sanitizeOutgoingPayload({
    ...consultationPayload,
    answer: shouldAppendSupportLinks
      ? appendSupportLinks(consultationPayload.answer, question)
      : consultationPayload.answer,
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
      followUp: ['The recovery period is usually about 3 to 4 weeks', "The exact number of visits may vary depending on the procedure and recovery, so it is safest to follow the doctor's final guidance"],
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

function getIntegratedFaqDocPath() {
  return path.join(DOCS_DIR, INTEGRATED_FAQ_DOC_FILENAME);
}

function cleanIntegratedFaqQuestionLine(line) {
  return normalizeDocLine(line)
    .replace(/^[?？]{1,3}\s*/u, '')
    .replace(/^[•ㆍ·*-]\s*/u, '')
    .replace(/^\d+\s*[.)]\s*/u, '')
    .replace(/^(q|질문|吏덈Ц)\s*[:.)-]\s*/iu, '')
    .trim();
}

function splitIntegratedFaqQuestionAliases(question) {
  const cleaned = cleanIntegratedFaqQuestionLine(question);
  if (!cleaned) {
    return [];
  }

  const rawAliases = cleaned
    .split(/\s*,\s*/u)
    .map((part) => part.trim())
    .filter(Boolean);

  const aliases = rawAliases.length > 0 ? rawAliases : [cleaned];
  const uniqueAliases = [];
  const seen = new Set();

  aliases.forEach((alias) => {
    const normalized = normalizeSearchTextSafe(alias);
    if (!normalized || seen.has(normalized)) {
      return;
    }
    seen.add(normalized);
    uniqueAliases.push(alias);
  });

  return uniqueAliases;
}

function isIntegratedFaqQuestionLine(line) {
  const cleaned = cleanIntegratedFaqQuestionLine(line);
  if (!cleaned || /^\[[^\]]+\]$/u.test(cleaned) || /^-+$/.test(cleaned)) {
    return false;
  }

  const hasStructuredQuestionPrefix = /^(q|질문|吏덈Ц)\s*[:.)-]\s*/iu.test(line);
  const hasQuestionPrefix = hasStructuredQuestionPrefix
    || /^[•ㆍ·*-]\s*/u.test(line)
    || /^[?？]{1,3}\s*/u.test(line)
    || /^\d+\s*[.)]\s*/u.test(line);
  const hasQuestionShape = /[?？]$/.test(cleaned)
    || /(가능|되나|되나요|하나요|인가요|있나요|없나요|무엇|뭐|어떻게|어디|언제|얼마|주소|홈페이지|알려|궁금)/u.test(cleaned);

  if (hasStructuredQuestionPrefix) {
    return cleaned.length <= 140;
  }

  return hasQuestionPrefix && hasQuestionShape && cleaned.length <= 90;
}

function cleanIntegratedFaqAnswerLine(line) {
  return normalizeDocLine(line)
    .replace(/^답변\s*[:.)-]\s*/u, '')
    .replace(/^a\s*[:.)-]\s*/iu, '')
    .trim();
}

function buildIntegratedFaqCards() {
  const faqPath = getIntegratedFaqDocPath();
  if (!fs.existsSync(faqPath)) {
    return [];
  }

  const text = repairBrokenKoreanText(fs.readFileSync(faqPath, 'utf8'));
  const cards = [];
  let current = null;
  let currentCategory = '';

  const pushCurrent = () => {
    if (!current) {
      return;
    }

    const aliases = splitIntegratedFaqQuestionAliases(current.question);
    const question = aliases[0] || cleanIntegratedFaqQuestionLine(current.question);
    const answer = current.answerLines
      .map((line) => cleanIntegratedFaqAnswerLine(line))
      .filter(Boolean)
      .join(' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    if (question && answer) {
      const questionTokens = tokenizeSafe(question);
      const answerTokens = tokenizeSafe(answer);
      cards.push({
        id: `integrated_faq_${cards.length + 1}`,
        category: current.category || '',
        question,
        aliases,
        normalizedAliases: aliases.map((alias) => normalizeSearchTextSafe(alias)).filter(Boolean),
        compactAliases: aliases.map((alias) => compactSearchTextSafe(alias)).filter(Boolean),
        answer,
        normalizedQuestion: normalizeSearchTextSafe(question),
        compactQuestion: compactSearchTextSafe(question),
        normalizedAnswer: normalizeSearchTextSafe(answer),
        tokens: [...new Set([...questionTokens, ...answerTokens])],
      });
    }

    current = null;
  };

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = normalizeDocLine(rawLine);

    if (!line) {
      if (current?.answerLines?.length > 0) {
        pushCurrent();
      }
      return;
    }

    const categoryMatch = line.match(/^\[([^\]]+)\]$/u);
    if (categoryMatch) {
      pushCurrent();
      currentCategory = categoryMatch[1].trim();
      return;
    }

    if (isIntegratedFaqQuestionLine(line)) {
      pushCurrent();
      current = {
        question: line,
        category: currentCategory,
        answerLines: [],
      };
      return;
    }

    if (current) {
      current.answerLines.push(line);
    }
  });

  pushCurrent();
  return cards;
}

function getIntegratedFaqQueryTokens(message) {
  const tokens = new Set(tokenizeSafe(message));
  const text = String(message || '');

  if (/(되나|되나요|가능|할\s*수|있나요)/u.test(text)) {
    tokens.add('가능');
  }
  if (/(보험|실비|실손|적용)/u.test(text)) {
    tokens.add('보험');
    tokens.add('실비보험');
    tokens.add('적용');
  }
  if (/(면회|방문객|보호자\s*방문)/u.test(text)) {
    tokens.add('면회');
  }
  if (/(준비물|챙겨|가져|준비해야)/u.test(text)) {
    tokens.add('준비물');
  }
  if (/(예약|접수)/u.test(text)) {
    tokens.add('예약');
  }
  if (/(검사|검진)/u.test(text)) {
    tokens.add('검사');
  }
  if (/(영수증|세부내역|상세내역|서류|발급)/u.test(text)) {
    tokens.add('서류');
  }

  return [...tokens].filter((token) => !['알려줘', '알려주세요', '궁금해요', '문의'].includes(token));
}

function scoreIntegratedFaqCard(message, card) {
  const normalizedMessage = normalizeSearchTextSafe(message);
  const compactMessage = compactSearchTextSafe(message);
  const tokens = getIntegratedFaqQueryTokens(message);
  let score = 0;
  let titleTokenHits = 0;
  let aliasExactMatch = false;

  if (!normalizedMessage || !card?.normalizedQuestion) {
    return { score: 0, titleTokenHits: 0, aliasExactMatch: false };
  }

  const normalizedCandidates = card.normalizedAliases?.length ? card.normalizedAliases : [card.normalizedQuestion];
  const compactCandidates = card.compactAliases?.length ? card.compactAliases : [card.compactQuestion];

  compactCandidates.forEach((candidate) => {
    if (!candidate) {
      return;
    }
    if (compactMessage === candidate) {
      score += 90;
      aliasExactMatch = true;
    } else if (compactMessage.length >= 4 && candidate.includes(compactMessage)) {
      score += 55;
    } else if (candidate.length >= 4 && compactMessage.includes(candidate)) {
      score += 45;
    }
  });

  normalizedCandidates.forEach((candidate) => {
    if (!candidate) {
      return;
    }
    if (normalizedMessage.length >= 4 && candidate.includes(normalizedMessage)) {
      score += 35;
    }
  });

  tokens.forEach((token) => {
    if (normalizedCandidates.some((candidate) => candidate.includes(token))) {
      score += 14;
      titleTokenHits += 1;
    } else if (card.normalizedAnswer.includes(token)) {
      score += 3;
    }
  });

  if (titleTokenHits >= 2) {
    score += 10;
  }

  return { score, titleTokenHits, aliasExactMatch };
}

function findIntegratedFaqCardResponse(message) {
  const cards = runtimeData?.integratedFaqCards || [];
  if (!cards.length || !normalizeSearchTextSafe(message)) {
    return null;
  }

  const rankedCards = cards
    .map((card) => ({
      card,
      ...scoreIntegratedFaqCard(message, card),
    }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!rankedCards.length) {
    return null;
  }

  const [bestMatch, secondMatch] = rankedCards;
  const scoreGap = secondMatch ? bestMatch.score - secondMatch.score : bestMatch.score;
  const reliable = bestMatch.aliasExactMatch
    || bestMatch.score >= 34
    || (bestMatch.titleTokenHits >= 2 && bestMatch.score >= 24 && scoreGap >= 4)
    || (bestMatch.titleTokenHits >= 1 && bestMatch.score >= 22 && scoreGap >= 10);

  if (!reliable) {
    return null;
  }

  return {
    type: 'integrated_faq',
    answer: bestMatch.card.answer,
    followUp: [],
    sources: [buildIntegratedFaqDocSource()],
    matchMeta: {
      score: bestMatch.score,
      scoreGap,
      question: bestMatch.card.question,
    },
  };
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

function readDoctorOverviewEntriesFromDocs() {
  if (!fs.existsSync(DOCTOR_SPECIALTY_DOC_PATH)) {
    return [];
  }

  const text = repairBrokenKoreanText(fs.readFileSync(DOCTOR_SPECIALTY_DOC_PATH, 'utf8'));
  const doctorNames = [
    ...new Set([
      ...DOCTOR_NAME_FALLBACK_LIST.filter((name) => text.includes(name)),
      ...extractDoctorNamesFromText(text),
    ]),
  ]
    .map((name) => ({ name, index: text.indexOf(name) }))
    .filter((item) => item.index >= 0)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.name);
  const entries = [];

  doctorNames.forEach((name, index) => {
    const startIndex = text.indexOf(name);
    const nextDoctorIndex = doctorNames
      .slice(index + 1)
      .map((nextName) => text.indexOf(nextName, startIndex + name.length))
      .filter((value) => value > startIndex)
      .sort((a, b) => a - b)[0] || text.length;

    const body = text.slice(startIndex, nextDoctorIndex);
    const lines = body
      .split(/\r?\n/)
      .map((line) => normalizeDocLine(line))
      .filter(Boolean);
    const profile = lines.find((line) => (
      line.includes(name) && /(전문의|병원장|대표원장|원장|부원장|센터장|진료부장|과장|부장)/u.test(line)
    )) || '';
    const center = lines.find((line) => /(진료과목|진료과)/u.test(line)) || '';
    const specialtyLine = lines.find((line) => line.includes('전문분야')) || '';
    const specialty = specialtyLine
      .replace(/^.*?전문분야\s*:?\s*/u, '')
      .trim();
    const roleMatch = profile.match(/(병원장|대표원장|원장|부원장|센터장|진료부장|과장|부장|전문의)/u);

    entries.push({
      name,
      profile: profile.trim(),
      center: center.trim(),
      specialty: specialty.trim(),
      role: roleMatch ? roleMatch[1] : '',
    });
  });

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
  const entries = readDoctorOverviewEntriesFromDocs();
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
  followUp.push('특정 의료진의 자세한 경력이 궁금하시면 “의료진 이름 + 경력”으로 입력해 주세요.');
  followUp.push('세부 일정은 내원 전 대표전화 02-6925-1111로 확인해 주세요.');

  return {
    type: 'doctor_overview',
    answer: representativeDoctors.length > 0
      ? `하나이비인후과병원 홈페이지 기준으로 현재 의료진 정보를 확인할 수 있습니다. 대표 의료진으로는 ${representativeDoctors.join(', ')} 등이 있습니다. 특정 의료진의 자세한 경력이 궁금하시면 “의료진 이름 + 경력”으로 입력해 주세요.`
      : '하나이비인후과병원 홈페이지 기준으로 현재 의료진 정보를 확인할 수 있습니다. 특정 의료진의 자세한 경력이 궁금하시면 “의료진 이름 + 경력”으로 입력해 주세요.',
    followUp,
    sources: [{
      title: '홈페이지-의료진 정보',
      url: 'local://docs/%ED%99%88%ED%8E%98%EC%9D%B4%EC%A7%80-%EC%9D%98%EB%A3%8C%EC%A7%84%20%EC%A0%95%EB%B3%B4.txt',
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

function isReliableDirectFaqResponse(directFaqResponse) {
  const meta = directFaqResponse?.matchMeta;
  if (!meta) {
    return true;
  }

  const score = Number(meta.score || 0);
  const scoreGap = Number(meta.scoreGap || 0);

  if (meta.exactKeywordMatch && score >= 16) {
    return true;
  }

  if (score >= 22 && scoreGap >= 6) {
    return true;
  }

  if (!meta.isConversationalQuestion && score >= 18 && scoreGap >= 5) {
    return true;
  }

  if (meta.category && /doctors_overview|doctor_schedule/i.test(meta.category) && score >= 16 && scoreGap >= 4) {
    return true;
  }

  return false;
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
  return buildReinitializedIntentResponse('restricted', '') || {
    type: 'restricted',
    answer: '이 부분은 상담봇이 판단해 드릴 수 없습니다. 진단, 처방 변경, 약 중단 여부는 의료진과 직접 확인해 주세요.',
    followUp: ['대표전화 02-6925-1111', '증상이 급하면 가까운 응급실 또는 119 이용'],
  };
}

function createEmergencyResponse() {
  return buildReinitializedIntentResponse('emergency', '') || {
    type: 'emergency',
    answer: '응급으로 보일 수 있는 상황입니다. 채팅으로 지연하지 마시고 119 또는 가까운 응급실로 바로 이동해 주세요.',
    followUp: ['심한 호흡곤란, 의식 저하, 심한 출혈은 즉시 응급 대응이 필요합니다.', '대표전화 02-6925-1111'],
  };
}

function createPersonalInfoWarningResponse() {
  return buildReinitializedIntentResponse('personal_info', '') || {
    type: 'privacy_warning',
    answer: '주민등록번호, 전화번호, 주소 같은 개인정보나 민감한 건강정보는 입력하지 말아 주세요.',
    followUp: ['개인정보 없이 증상, 비용, 예약, 진료시간처럼 일반적인 질문만 남겨 주세요.'],
  };
}

function createWelcomeResponse() {
  return {
    type: 'welcome',
    answer: '안녕하세요. 하나이비인후과병원 AI 상담원입니다. 병원 홈페이지와 내부 문서를 바탕으로 예약, 진료시간, 의료진, 입원, 서류 발급 등을 안내해 드립니다.',
    followUp: ['진료시간 알려줘', '동헌종 원장 진료시간 알려줘', '입원 절차 알려줘'],
  };
}

function createApiKeyMissingResponse() {
  return {
    type: 'config_error',
    answer: '현재 OpenAI API 키가 설정되지 않아 AI 기반 상담 기능을 사용할 수 없습니다. PowerShell에서 OPENAI_API_KEY를 설정한 뒤 서버를 다시 실행해 주세요.',
    followUp: ['$env:OPENAI_API_KEY="발급받은키"', 'node .\\server.js', '대표전화 02-6925-1111'],
  };
}

function createReservationOrReceptionResponse() {
  return buildReinitializedIntentResponse('reservation_or_reception', '') || null;
}

function createLateArrivalResponse() {
  return buildReinitializedIntentResponse('late_arrival', '') || null;
}

function createMedicationStopResponse() {
  return buildReinitializedIntentResponse('medication_stop', '') || null;
}

function createInpatientMealPolicyResponse() {
  return buildReinitializedIntentResponse('inpatient_meal_policy', '') || null;
}

function createInpatientOutingResponse() {
  return buildReinitializedIntentResponse('inpatient_outing', '') || null;
}

function createInpatientMealPolicyResponseFixed() {
  return buildReinitializedIntentResponse('inpatient_meal_policy', '') || null;
}

function createShuttleBusResponse() {
  return buildReinitializedIntentResponse('shuttle_bus', '') || null;
}

function createDischargeProcedureResponse() {
  return buildReinitializedIntentResponse('discharge_procedure', '') || null;
}

function createSurgeryDurationResponse() {
  return buildReinitializedIntentResponse('surgery_duration', '') || null;
}

function createSurgeryScheduleResponse() {
  return buildReinitializedIntentResponse('surgery_schedule', '') || null;
}

function createPostOpBleedingResponse() {
  return buildReinitializedIntentResponse('postop_bleeding', '') || null;
}

function createSurgeryCostResponse() {
  return buildReinitializedIntentResponse('surgery_cost', '') || null;
}

function createSameDayExamAvailabilityResponse() {
  return buildReinitializedIntentResponse('same_day_exam_availability', '') || null;
}

function findExamPreparationResponse(message) {
  const text = String(message || '');
  if (!matchesAnyPattern(text, examPreparationPatterns)) {
    return null;
  }
  return buildReinitializedIntentResponse('exam_preparation', text);
}

function createReceiptIssuanceResponse() {
  return buildReinitializedIntentResponse('receipt_issuance', '') || null;
}

function createTypedPostOpCareResponse(kind) {
  const messageByKind = {
    nose: '코 수술 후 주의사항',
    throat: '목 수술 후 주의사항',
    ear: '귀 수술 후 주의사항',
    thyroid: '갑상선 수술 후 주의사항',
    salivary: '침샘 수술 후 주의사항',
  };
  return buildCleanPostOpCareResponse(messageByKind[kind] || '수술 후 주의사항');
}

function findPostOpCareResponse(message) {
  return matchesAnyPattern(String(message || ''), postOpCarePatterns)
    ? buildCleanPostOpCareResponse(message)
    : null;
}

function createNasalIrrigationResponse(mode = 'general') {
  return buildReinitializedIntentResponse(
    mode === 'surgery' ? 'nasal_irrigation_surgery' : 'nasal_irrigation_general',
    mode === 'surgery' ? '수술 후 코세척' : '일반 코세척'
  );
}

function getNasalIrrigationMode(message) {
  const text = String(message || '');
  if (!isNasalIrrigationQuestion(text)) {
    return '';
  }

  if (matchesAnyPattern(text, NASAL_IRRIGATION_SURGERY_PATTERNS)) {
    return 'surgery';
  }

  if (matchesAnyPattern(text, NASAL_IRRIGATION_GENERAL_PATTERNS)) {
    return 'general';
  }

  return 'ambiguous';
}

function createNasalIrrigationClarificationResponse() {
  return createGuidedQuestionResponse(
    '코세척은 수술 후 코세척인지 일반 코세척인지에 따라 안내가 달라집니다. 어느 경우인지 먼저 선택해 주세요.',
    ['수술 후 코세척이에요', '일반 코세척이에요']
  );
}

function createComplaintGuideResponse() {
  return buildReinitializedIntentResponse('complaint_guide', '') || null;
}

function createGuardianShiftResponse() {
  return buildReinitializedIntentResponse('guardian_shift', '') || null;
}

function buildGuardianVisitResponse(message) {
  const text = String(message || '');
  const sources = [
    buildIntegratedFaqDocSource(),
    buildLocalDocSource('홈페이지-입퇴원 안내', '홈페이지-입퇴원 안내.txt'),
  ];

  if (/(문자|연락|진행|상태|알림|어떻게\s*알)/u.test(text)) {
    return {
      type: 'guardian_visit',
      answer: '보호자 면회가 제한되는 경우에도 수술 진행 상황은 입원 시 원무과에 등록한 보호자 연락처로 안내 문자가 발송됩니다. 문서는 병동에서 수술실로 올라갈 때, 수술 종료 후, 회복실 퇴실 후 병동 도착 시점에 총 3회 문자가 발송된다고 안내합니다. 병동 도착 문자 이후에는 환자분과 통화가 가능하고, 수술 경과는 집도의 회진 후 환자분께 직접 설명됩니다.',
      followUp: ['보호자 연락처가 정확히 등록되어 있는지 입원 수속 시 확인해 주세요.', '대표전화 02-6925-1111'],
      sources,
    };
  }

  if (/(같이|함께|상주|있을|계실|머물|병실|입실|출입)/u.test(text)) {
    return {
      type: 'guardian_visit',
      answer: '하나이비인후과병원은 간호간병통합서비스 병동으로, 보호자 상주는 원칙적으로 어렵습니다. 다만 소아 환자(15세 이하)이거나 의료진이 환자 안전과 정서적 지지가 필요하다고 판단하는 경우에는 예외적으로 보호자 상주가 안내될 수 있습니다.',
      followUp: ['출입증을 소지한 보호자 또는 환자 본인만 병동 출입이 가능합니다.', '세부 운영은 입원 전 병동 또는 대표전화 02-6925-1111로 확인해 주세요.'],
      sources,
    };
  }

  return {
    type: 'guardian_visit',
    answer: '입원 환자 면회는 환자 안전관리와 감염병 예방을 위해 전면 금지로 안내되어 있습니다. 면회가 필요한 경우에도 병실 면회가 아니라 다른 환자의 안정과 쾌유를 위해 1층 또는 2층 대기실 이용으로 안내됩니다. 소아 환자(15세 이하)는 보호자 한 분이 계실 수 있습니다.',
    followUp: ['보호자 상주 가능 여부는 환자 상태와 의료진 판단에 따라 달라질 수 있습니다.', '대표전화 02-6925-1111'],
    sources,
  };
}

function createWifiResponse() {
  return buildReinitializedIntentResponse('wifi_info', '') || null;
}

function createHospitalPhoneResponse() {
  return buildReinitializedIntentResponse('hospital_phone', '') || null;
}

function createRhinitisPostOpVisitResponse() {
  return buildReinitializedIntentResponse('rhinitis_postop_visit', '비염 수술 후 내원') || null;
}

function buildParkingInfoResponse(message) {
  const text = String(message || '');
  if (!matchesAnyPattern(text, PARKING_QUERY_PATTERNS)) {
    return null;
  }

  const sources = [
    buildIntegratedFaqDocSource(),
    buildLocalDocSource('홈페이지-셔틀버스 및 오시는길', '홈페이지-셔틀버스 및 오시는길.txt'),
  ];
  const isInpatientParking = matchesAnyPattern(text, PARKING_INPATIENT_PATTERNS);
  const isOutpatientParking = matchesAnyPattern(text, PARKING_OUTPATIENT_PATTERNS);

  if (isInpatientParking) {
    return {
      type: 'parking_info',
      answer: '입원 환자 주차는 경우에 따라 제한이 있습니다. 문서 기준으로 입원 당일 종일 주차는 가능하지만 밤샘 주차는 불가능하고, 홈페이지 안내에는 입원 환자는 퇴원 시 운전이 어려울 수 있어 차량 이용이 권장되지 않는다고 되어 있습니다.',
      followUp: [
        '외래 환자와 방문객은 주차권 또는 영수증 제출 시 무료주차가 가능합니다.',
        '무료 발렛파킹 서비스가 운영되며, 주차장 높이 1.9m 이상 차량은 주차가 어려울 수 있습니다.',
      ],
      sources,
    };
  }

  if (isOutpatientParking) {
    return {
      type: 'parking_info',
      answer: '외래 환자와 방문객은 주차권 또는 영수증 제출 시 무료주차가 가능합니다. 무료 발렛파킹 서비스도 운영됩니다.',
      followUp: [
        '주차장이 협소할 수 있어 혼잡 시간에는 대중교통 이용이 더 편할 수 있습니다.',
        '주차장 높이 1.9m 이상 차량은 주차가 어려울 수 있습니다.',
      ],
      sources,
    };
  }

  return {
    type: 'parking_info',
    answer: '주차는 가능합니다. 문서 기준으로 환자 및 방문객은 주차권 또는 영수증 제출 시 무료주차가 가능하고, 무료 발렛파킹 서비스도 운영됩니다. 다만 입원 환자는 밤샘 주차가 불가능하며, 퇴원 시 운전이 어려울 수 있어 차량 이용이 권장되지 않습니다.',
    followUp: [
      '외래 방문 주차 안내',
      '입원 환자 주차 안내',
      '주차장 높이 1.9m 이상 차량은 주차가 어려울 수 있습니다.',
    ],
    sources,
  };
}

function buildNetworkHospitalInfoResponse() {
  return {
    type: 'network_hospital_info',
    answer: '하나이비인후과는 전국 네트워크 구축을 통해 지역별 전국 43개소 네트워크를 구성하고 있습니다. 하나라는 브랜드를 사용하여 국내 최대 이비인후과 네트워크로 풍부한 경험을 바탕으로 진료의 표준화와 전문화를 추구합니다.',
    followUp: [
      '네트워크 병원 위치나 이용 가능 여부는 시점에 따라 달라질 수 있어 대표전화 02-6925-1111로 확인해 주세요.',
    ],
    sources: [buildIntegratedFaqDocSource()],
  };
}

function buildGuardianMealResponse() {
  const matchedLine = readNonpayDocLines().find((line) => (
    compactSearchTextSafe(line).includes(compactSearchTextSafe('보호자 식대'))
  ));
  const price = extractPriceText(matchedLine);

  return {
    type: 'guardian_meal',
    answer: price
      ? `비급여비용 문서에 보호자 식대 ${price} 항목이 있어 보호자 식사가 제공되거나 신청 가능한 운영일 가능성이 높습니다. 다만 문서에 신청 방법이나 제공 기준이 직접 적혀 있지는 않아 정확한 운영 방식은 병동 또는 대표전화 02-6925-1111로 확인해 주세요.`
      : '비급여비용 문서에 보호자 식대 항목이 있어 보호자 식사가 제공되거나 신청 가능한 운영일 가능성이 높습니다. 다만 신청 방법이나 제공 기준은 문서에 직접 적혀 있지 않아 병동 또는 대표전화 02-6925-1111로 확인해 주세요.',
    followUp: [
      matchedLine ? `문서 근거: ${matchedLine}` : '기준 문서는 기타-비급여비용입니다.',
      '이 답변은 문서의 간접 근거를 바탕으로 한 추정입니다.',
      '정확한 신청 방법이나 제공 기준은 병동 또는 대표전화 02-6925-1111로 확인해 주세요.',
    ],
    sources: [buildLocalDocSource('기타-비급여비용', path.basename(CERTIFICATE_FEES_DOC_PATH || '기타-비급여비용.txt'))],
  };
}

function buildMounjaroFeeResponse(message) {
  const text = String(message || '');
  if (!/(마운자로|Mounjaro|터제파타이드|tirzepatide)/iu.test(text)) {
    return null;
  }

  return {
    type: 'mounjaro_fee',
    answer: '비급여비용 문서 기준으로 마운자로프리필드펜주는 용량별 비용이 다르게 안내되어 있습니다. 2.5mg/0.5mL는 340,000원, 5mg/0.5mL는 440,000원, 7.5mg/0.5mL는 580,000원입니다.',
    followUp: [
      '약제 처방 가능 여부와 실제 적용 용량은 진료 후 의료진 판단이 필요합니다.',
      '비급여 금액은 변경될 수 있어 내원 전 대표전화 02-6925-1111로 확인해 주세요.',
      `비급여 안내 페이지: ${NONPAY_PAGE_URL}`,
    ],
    sources: [buildLocalDocSource('기타-비급여비용', '기타-비급여비용.txt')],
  };
}

function buildRepresentativeNonpayResponse(message) {
  const text = String(message || '');
  if (!/(대표|주요|자주|종류|항목).{0,12}(비급여|비급여\s*항목)|비급여.{0,12}(대표|주요|종류|항목)/u.test(text)) {
    return null;
  }

  return {
    type: 'representative_nonpay',
    answer: '대표적인 비급여 항목으로는 상급병실차액, 미용 목적 비성형술, 발음·발성 검사, 이관 풍선 확장술, 수액치료, 일부 약제비, 제증명 수수료 등이 있습니다.',
    followUp: [
      '예시 금액은 1인실 상급병실차액 350,000원, 비성형술(미용목적) 2,000,000원~3,000,000원, 발음·발성검사 80,000원~300,000원, 이관 풍선 확장술 550,000원 등으로 안내되어 있습니다.',
      '항목과 금액은 변경될 수 있어 정확한 비용은 비급여 안내 페이지나 대표전화 02-6925-1111로 확인해 주세요.',
      `비급여 안내 페이지: ${NONPAY_PAGE_URL}`,
    ],
    sources: [buildLocalDocSource('기타-비급여비용', '기타-비급여비용.txt')],
  };
}

function buildRhinoplastyConsultResponse(message) {
  const text = String(message || '');
  const asksRhinoplasty = /(코\s*성형|코성형|비성형|기능적\s*코성형|성형\s*수술|성형수술|정종인.{0,8}성형|성형.{0,8}정종인)/u.test(text);
  const hasSeptoplasty = /(비중격|비중격만곡|비중격\s*수술)/u.test(text);
  if (!asksRhinoplasty && !hasSeptoplasty) {
    return null;
  }

  return {
    type: 'rhinoplasty_consult',
    answer: hasSeptoplasty
      ? '비중격수술과 코성형을 함께 할 수 있는지는 정종인 진료부장 진료 시 환자분의 상태를 확인한 뒤 결정합니다. 문서상 정종인 진료부장은 기능적코성형과 비중격만곡증을 전문분야로 안내하고 있습니다.'
      : '코성형 가능 여부는 정종인 진료부장 진료 시 환자분의 상태를 확인한 뒤 결정합니다. 문서상 정종인 진료부장은 기능적코성형, 비중격만곡증, 부비동내시경수술 등을 전문분야로 안내하고 있습니다.',
    followUp: [
      '미용 목적 또는 기능적 목적에 따라 상담 내용과 비용이 달라질 수 있습니다.',
      '정확한 가능 여부와 일정은 진료 예약 후 상담하거나 대표전화 02-6925-1111로 확인해 주세요.',
    ],
    sources: [
      buildIntegratedFaqDocSource(),
      buildLocalDocSource('홈페이지-의료진 정보', '홈페이지-의료진 정보.txt'),
      buildLocalDocSource('기타-비급여비용', '기타-비급여비용.txt'),
    ],
  };
}

function buildSmokingPolicyResponse(message) {
  const text = String(message || '');
  if (!/(흡연|담배|금연\s*구역|금연구역|흡연\s*구역|흡연구역)/u.test(text)) {
    return null;
  }

  return {
    type: 'smoking_policy',
    answer: '병원은 금연 구역입니다. 병원 건물 내에는 흡연 장소가 없는 것으로 안내되어 있어 금연을 권고드립니다.',
    followUp: [
      '흡연 장소 확인이 꼭 필요하시면 접수나 병동 직원에게 문의해 주세요.',
      '수술 전후에는 회복과 출혈 예방을 위해 금연이 특히 중요합니다.',
    ],
    sources: [buildIntegratedFaqDocSource()],
  };
}

function buildTonsilPostopBleedingResponse(message) {
  const text = String(message || '');
  if (!/(편도|편도선|편도절제|편도\s*절제|편도수술|편도\s*수술)/u.test(text) || !/(출혈|피|피가|피섞|피\s*섞|목에\s*피|피나요)/u.test(text)) {
    return null;
  }

  return {
    type: 'tonsil_postop_bleeding',
    answer: '편도절제술 후 침에 피가 조금 섞이는 정도라면 시원한 얼음물로 20~30분 정도 가글해 볼 수 있습니다. 다만 출혈이 지속되거나 양이 많으면 대표전화 02-6925-1111로 바로 연락하시고, 진료를 받으셔야 합니다.',
    followUp: [
      '문서 기준으로 편도 수술 후 출혈은 수술 후 5~10일까지 있을 수 있습니다.',
      '즉시 내원이 어렵거나 원거리인 경우에는 이비인후과 의사가 상주하는 가까운 응급실로 내원하는 것을 권장합니다.',
      '빨대 사용이나 무리한 활동은 출혈 예방을 위해 피해주세요.',
    ],
    sources: [
      buildIntegratedFaqDocSource(),
      buildLocalDocSource('입원-수술 후 주의사항', '입원-수술 후 주의사항.txt'),
    ],
  };
}

function buildPaymentMethodResponse(message) {
  const text = String(message || '');
  if (!/(결제|수납|진료비)/u.test(text) || !/(카드|현금)/u.test(text)) {
    return null;
  }

  return {
    type: 'payment_method',
    answer: '진료비 결제는 카드와 현금 모두 가능합니다. 카드 결제 후 환불이나 카드 교체가 필요한 경우에는 결제하신 카드를 가지고 내원하시면 환불 처리가 가능합니다.',
    followUp: [
      '일반 진료 후 건강보험 피보험자 또는 피부양자로 등록된 경우 환불은 2주 이내 내원이 필요할 수 있습니다.',
      '자세한 수납 관련 문의는 대표전화 02-6925-1111로 확인해 주세요.',
    ],
    sources: [buildIntegratedFaqDocSource()],
  };
}

function buildFirstReturnVisitResponse(message) {
  const text = String(message || '');
  if (!/(초진|신환|처음\s*내원|첫\s*방문|재진)/u.test(text) || !/(절차|접수|다른|차이|어떻게)/u.test(text)) {
    return null;
  }

  return {
    type: 'first_return_visit_process',
    answer: '초진과 재진 모두 1층 원무과에서 접수 후 진료로 진행됩니다. 처음 내원하시는 초진 환자는 본인 확인을 위해 건강보험증 또는 신분증을 원무과에 제시해 주셔야 합니다. 예약하신 경우에는 1층 원무과에서 예약 확인을 먼저 받으시면 됩니다.',
    followUp: [
      '당일 방문 진료도 가능하지만 대기시간이 발생할 수 있습니다.',
      '진료의뢰서, 타병원 CD, 소견서가 있으면 접수 시 미리 제출해 주세요.',
      '대표전화 02-6925-1111',
    ],
    sources: [
      buildLocalDocSource('홈페이지-외래진료안내', '홈페이지-외래진료안내.txt'),
      buildIntegratedFaqDocSource(),
    ],
  };
}

function buildWaitingTimeResponse(message) {
  const text = String(message || '');
  if (!/(대기|기다|예약\s*없이|예약없이|방문\s*접수|방문접수)/u.test(text)) {
    return null;
  }

  return {
    type: 'waiting_time_visit',
    answer: '예약 없이 당일 방문 진료도 가능하지만 외래 상황에 따라 대기시간이 발생할 수 있습니다. 홈페이지 외래진료안내에는 당일 방문 진료가 가능하나 대기시간이 발생할 수 있다고 안내되어 있고, 통합 FAQ에는 당일 예약은 1시간 이내 도착 가능할 때 방문 접수로 안내될 수 있다고 되어 있습니다. 대기가 길 수 있어 가능하면 예약 후 내원하시는 것을 권장드립니다.',
    followUp: [
      '당일 외래대기실 상황에 따라 달라질 수 있어 내원 전 대표전화 02-6925-1111로 확인해 주세요.',
      '접수 마감 시간 전에 여유 있게 방문해 주세요.',
    ],
    sources: [
      buildLocalDocSource('홈페이지-외래진료안내', '홈페이지-외래진료안내.txt'),
      buildIntegratedFaqDocSource(),
    ],
  };
}

function buildClinicHoursNightWeekendResponse(message) {
  const text = String(message || '');
  if (!/(야간|주말|토요일|일요일|공휴일|진료시간|진료\s*가능|진료\s*잉정|진료잉정)/u.test(text)) {
    return null;
  }

  return {
    type: 'clinic_hours_night_weekend',
    answer: '진료시간은 평일 오전 9시부터 오후 6시까지이며, 토요일은 오전 9시부터 오후 1시 30분까지입니다. 일요일과 공휴일은 휴진으로 안내되어 있고, 별도 야간진료는 문서에 안내되어 있지 않습니다.',
    followUp: [
      '평일 접수 마감은 오후 5시 30분입니다.',
      '토요일 접수 마감은 오후 1시입니다.',
      '응급수술 등 진료 상황에 따라 접수가 조기 마감될 수 있어 내원 전 확인해 주세요.',
    ],
    sources: [
      buildLocalDocSource('홈페이지-외래진료안내', '홈페이지-외래진료안내.txt'),
      buildIntegratedFaqDocSource(),
    ],
  };
}

function buildReferralDocumentResponse(message) {
  const text = String(message || '');
  if (!/(진료\s*의뢰|진료의뢰|의뢰서|요양급여\s*의뢰서|타병원\s*CD|소견서|전자의뢰)/u.test(text)) {
    return null;
  }

  return {
    type: 'referral_document',
    answer: '진료의뢰서가 있으시면 내원 후 접수하실 때 미리 제출해 주세요. 타병원 CD나 소견서를 가지고 오신 경우에도 접수 시 함께 제출해 주시면 됩니다. 전자의뢰인 경우에는 접수 직원에게 전자의뢰가 되어 있다고 알려 주세요.',
    followUp: [
      '진료의뢰환자는 전용 접수창구를 이용하면 빠르고 편리하게 접수할 수 있습니다.',
      '진료협력센터 담당자 연락처는 문서 기준 010-3661-8998입니다.',
    ],
    sources: [
      buildIntegratedFaqDocSource(),
      buildLocalDocSource('홈페이지-외래진료안내', '홈페이지-외래진료안내.txt'),
    ],
  };
}

function buildHospitalLocationResponse(message) {
  const text = String(message || '');
  if (!/(병원\s*위치|병원위치|병원\s*주소|주소|어디\s*있|어디에\s*있|오시는\s*길|찾아\s*가|건물\s*주소)/u.test(text)) {
    return null;
  }

  return {
    type: 'hospital_location',
    answer: '하나이비인후과병원 주소는 서울특별시 강남구 역삼로 245입니다. 대중교통은 2호선 역삼역 1번 출구를 이용하시면 되고, 역삼역 1번 출구에서 병원 셔틀버스도 이용할 수 있습니다. 자동차로 오실 때는 내비게이션에 “서울특별시 강남구 역삼로 245” 또는 “하나이비인후과병원”을 입력하시면 됩니다.',
    followUp: [
      '역삼역 1번 출구에서 도보 약 10분 거리로 안내되어 있습니다.',
      '버스는 동영문화센터, 개나리아파트, 신한은행 전산센터 정류장 하차 안내가 있습니다.',
    ],
    sources: [
      buildIntegratedFaqDocSource(),
      buildLocalDocSource('홈페이지-셔틀버스 및 오시는길', '홈페이지-셔틀버스 및 오시는길.txt'),
    ],
  };
}

function buildDoctorScheduleImageResponse(message) {
  const text = String(message || '');
  if (!/(오늘.{0,12}(의료진|의사|원장)|외래\s*진료표|외래진료표|진료\s*일정|진료일정|진료표|의료진\s*일정)/u.test(text)) {
    return null;
  }

  return {
    type: 'doctor_schedule_image',
    answer: '의료진 진료일정은 외래 진료표 기준으로 확인하시면 됩니다. 다만 오늘 실제 진료 가능 여부는 당일 수술, 휴진, 대기 상황에 따라 달라질 수 있어 내원 전 대표전화 02-6925-1111로 확인해 주세요.',
    followUp: [
      '아래 진료일정표 이미지를 참고해 주세요.',
      '특정 의료진 이름을 알려주시면 해당 의료진 기준으로도 안내해 드릴게요.',
    ],
    images: [{
      title: '진료일정 안내',
      description: '의료진 외래 진료일정표입니다.',
      display: 'document',
      url: resolvePublicImagePath('/images/%EC%A7%84%EB%A3%8C%EC%9D%BC%EC%A0%95%EC%A0%84%EC%B2%B4.png'),
    }],
    sources: [buildLocalDocSource('진료일정', '진료일정전체.png')],
  };
}

function buildRoomFeeResponse(message) {
  const text = String(message || '');
  if (!/(병실\s*비용|병실비용|입원료|병실료|병실\s*료|[124]\s*인실.{0,8}(비용|얼마|가격|금액)|비용.{0,8}[124]\s*인실)/u.test(text)) {
    return null;
  }

  return {
    type: 'room_fee',
    answer: '병실 비용은 통합 FAQ 기준으로 1인실 350,000원, 2인실 대략 7~8만원, 4인실 대략 3만원으로 안내되어 있습니다. 1인실 당일퇴원 비용은 비급여비용 문서 기준 175,000원 항목도 확인됩니다.',
    followUp: [
      '병실 배정과 실제 적용 금액은 입원 형태와 당일 병실 상황에 따라 달라질 수 있습니다.',
      '정확한 금액은 입원 상담 또는 대표전화 02-6925-1111로 확인해 주세요.',
    ],
    sources: [
      buildIntegratedFaqDocSource(),
      buildLocalDocSource('기타-비급여비용', path.basename(CERTIFICATE_FEES_DOC_PATH || '기타-비급여비용.txt')),
    ],
  };
}

function buildSymptomVisitGuidanceResponse(message) {
  const text = String(message || '');
  const asksVisitToday = /(진료|진료보|진료\s*보|내원|오늘|가능|접수|예약)/u.test(text);
  if (!asksVisitToday) {
    return null;
  }

  if (/(감기|감기기운|몸살|기침|콧물|목감기)/u.test(text)) {
    return {
      type: 'symptom_visit_guidance',
      answer: '감기기운이나 호흡기 증상이 있어도 이비인후과 진료는 가능합니다. 당일 방문 진료도 가능하지만 대기시간이 발생할 수 있고, 실제 진료 가능 여부는 접수 마감 시간과 당일 진료 상황에 따라 달라질 수 있습니다.',
      followUp: [
        '평일 접수 마감은 오후 5시 30분, 토요일 접수 마감은 오후 1시입니다.',
        '감기나 인플루엔자 등 호흡기 증상이 있는 경우 병원 내 감염 예방 안내에 따라 마스크 착용과 직원 안내를 따라 주세요.',
        '아래 진료일정표 이미지를 참고해 주세요.',
      ],
      images: [{
        title: '진료일정 안내',
        description: '의료진 외래 진료일정표입니다.',
        display: 'document',
        url: resolvePublicImagePath('/images/%EC%A7%84%EB%A3%8C%EC%9D%BC%EC%A0%95%EC%A0%84%EC%B2%B4.png'),
      }],
      sources: [
        buildLocalDocSource('홈페이지-외래진료안내', '홈페이지-외래진료안내.txt'),
        buildLocalDocSource('홈페이지-의료진 정보', '홈페이지-의료진 정보.txt'),
        buildIntegratedFaqDocSource(),
      ],
    };
  }

  if (/(코막힘|코\s*막힘|코막혀|코\s*막혀|비염|축농증|부비동염|코질환|코\s*질환)/u.test(text)) {
    return {
      type: 'symptom_visit_guidance',
      answer: '코막힘이나 코 질환 진료는 코센터 기준으로 안내드릴 수 있습니다. 당일 방문 진료도 가능하지만 대기시간이 발생할 수 있고, 실제 진료 가능 여부는 접수 마감 시간과 당일 진료 상황에 따라 달라질 수 있습니다.',
      followUp: [
        '코센터 의료진은 동헌종 대표원장, 이상덕 병원장, 정도광 원장, 김태현 부원장, 정종인 진료부장, 장규선 과장, 김병길 과장입니다.',
        '평일 접수 마감은 오후 5시 30분, 토요일 접수 마감은 오후 1시입니다.',
        '아래 진료일정표 이미지를 참고해 주세요.',
      ],
      images: [{
        title: '진료일정 안내',
        description: '의료진 외래 진료일정표입니다.',
        display: 'document',
        url: resolvePublicImagePath('/images/%EC%A7%84%EB%A3%8C%EC%9D%BC%EC%A0%95%EC%A0%84%EC%B2%B4.png'),
      }],
      sources: [
        buildLocalDocSource('외래-의료진 명단', DOCTOR_LIST_DOC_FILENAME),
        buildLocalDocSource('홈페이지-외래진료안내', '홈페이지-외래진료안내.txt'),
        buildLocalDocSource('홈페이지-의료진 정보', '홈페이지-의료진 정보.txt'),
      ],
    };
  }

  if (/(목\s*아파|목아파|목통증|목\s*통증|성대|인후두|두경부|목질환|목\s*질환)/u.test(text)) {
    return {
      type: 'symptom_visit_guidance',
      answer: '목 통증이나 목 질환 진료는 목센터 또는 두경부센터 기준으로 안내드릴 수 있습니다. 당일 방문 진료도 가능하지만 대기시간이 발생할 수 있고, 실제 진료 가능 여부는 접수 마감 시간과 당일 진료 상황에 따라 달라질 수 있습니다.',
      followUp: [
        '목센터 의료진은 남순열 두경부 센터장, 주형로 원장입니다.',
        '평일 접수 마감은 오후 5시 30분, 토요일 접수 마감은 오후 1시입니다.',
        '아래 진료일정표 이미지를 참고해 주세요.',
      ],
      images: [{
        title: '진료일정 안내',
        description: '의료진 외래 진료일정표입니다.',
        display: 'document',
        url: resolvePublicImagePath('/images/%EC%A7%84%EB%A3%8C%EC%9D%BC%EC%A0%95%EC%A0%84%EC%B2%B4.png'),
      }],
      sources: [
        buildLocalDocSource('외래-의료진 명단', DOCTOR_LIST_DOC_FILENAME),
        buildLocalDocSource('홈페이지-외래진료안내', '홈페이지-외래진료안내.txt'),
        buildLocalDocSource('홈페이지-의료진 정보', '홈페이지-의료진 정보.txt'),
      ],
    };
  }

  return null;
}

function buildEarFullnessHearingLossResponse(message) {
  const text = String(message || '');
  if (!/(귀.{0,8}(먹먹|답답|안\s*들|안들|소리.{0,6}안)|먹먹.{0,8}귀|청력.{0,8}(떨어|저하)|소리.{0,8}안\s*들|소리.{0,8}안들)/u.test(text)) {
    return null;
  }

  return {
    type: 'ear_fullness_hearing_loss',
    answer: '귀가 먹먹하거나 소리가 잘 안 들리는 증상은 단순한 이관기능장애일 수도 있지만, 실제로 청력이 떨어진 경우에는 빠른 치료를 받지 못하면 영구적 난청이 남을 수 있어 내원해서 검사를 받으시는 것이 좋습니다.',
    followUp: [
      '청력검사와 귀 진료를 통해 난청 여부를 확인할 수 있습니다.',
      '갑자기 청력이 떨어졌거나 한쪽 귀가 잘 안 들리면 늦추지 말고 진료를 권장드립니다.',
    ],
    sources: [
      buildIntegratedFaqDocSource(),
      buildLocalDocSource('홈페이지-난청', '홈페이지-난청.txt'),
    ],
  };
}

function buildCenterDoctorListResponse(message) {
  const text = String(message || '');
  const asksDoctor = /(의료진|의사|원장|선생|명단|누구|소개)/u.test(text);

  if (/(코\s*진료|코센터|코\s*센터|코질환|코\s*질환)/u.test(text) && asksDoctor) {
    return {
      type: 'center_doctor_list',
      answer: '코진료는 코센터 의료진 기준으로 안내드릴 수 있습니다. 외래 의료진 명단 기준 코센터 의료진은 동헌종 대표원장, 이상덕 병원장, 정도광 원장, 김태현 부원장, 정종인 진료부장, 장규선 과장, 김병길 과장입니다.',
      followUp: [
        '의료진별 진료일정은 외래 진료표와 당일 상황에 따라 달라질 수 있습니다.',
        '비염, 축농증, 비중격만곡증, 코물혹 등 코 질환 문의는 코센터 기준으로 안내됩니다.',
      ],
      sources: [buildLocalDocSource('외래-의료진 명단', DOCTOR_LIST_DOC_FILENAME)],
    };
  }

  if (/(목\s*진료|목센터|목\s*센터|두경부센터|두경부\s*센터|목질환|목\s*질환)/u.test(text) && asksDoctor) {
    return {
      type: 'center_doctor_list',
      answer: '목진료는 목센터 또는 두경부센터 의료진 기준으로 안내드릴 수 있습니다. 외래 의료진 명단 기준 목센터 의료진은 남순열 두경부 센터장, 주형로 원장입니다.',
      followUp: ['의료진별 진료일정은 외래 진료표와 당일 상황에 따라 달라질 수 있습니다.'],
      sources: [buildLocalDocSource('외래-의료진 명단', DOCTOR_LIST_DOC_FILENAME)],
    };
  }

  if (/(귀\s*진료|귀센터|귀\s*센터|귀질환|귀\s*질환)/u.test(text) && asksDoctor) {
    return {
      type: 'center_doctor_list',
      answer: '귀진료는 귀센터 의료진 기준으로 안내드릴 수 있습니다. 외래 의료진 명단 기준 귀센터 의료진은 장선오 귀질환 센터장, 장정훈 원장, 김종세 과장입니다.',
      followUp: ['의료진별 진료일정은 외래 진료표와 당일 상황에 따라 달라질 수 있습니다.'],
      sources: [buildLocalDocSource('외래-의료진 명단', DOCTOR_LIST_DOC_FILENAME)],
    };
  }

  return null;
}

function buildSinusitisCareResponse(message) {
  const text = String(message || '');
  if (!/(부비동염|축농증)/u.test(text) || !/(진료|가능|치료|검사|수술|봐|보나요|보는지)/u.test(text)) {
    return null;
  }

  return {
    type: 'sinusitis_care',
    answer: '부비동염은 축농증과 같은 코 질환으로, 하나이비인후과병원 코 질환 센터에서 진료 가능합니다. 홈페이지 축농증 안내 기준으로 문진, 내시경검사, X-ray 또는 CT 검사 등을 통해 상태를 확인하고, 급성 축농증은 약물치료와 코세척을 우선 고려하며 만성 축농증은 상태에 따라 부비동 내시경 수술을 시행할 수 있습니다.',
    followUp: [
      '부비동염 진료 의료진은 코센터 기준으로 확인하시면 됩니다.',
      '정확한 치료 방향은 진료와 검사 후 의료진이 결정합니다.',
    ],
    sources: [
      buildLocalDocSource('홈페이지-축농증', '홈페이지-축농증.txt'),
      buildLocalDocSource('외래-의료진 명단', DOCTOR_LIST_DOC_FILENAME),
    ],
  };
}

function buildThroatMassCareResponse(message) {
  const text = String(message || '');
  if (!/(성대\s*물혹|성대물혹|목의\s*혹|목\s*혹|후두\s*혹|후두혹|성대\s*혹|성대혹)/u.test(text)) {
    return null;
  }

  const asksSurgery = /(수술|제거|절제|시술)/u.test(text);
  const answer = asksSurgery
    ? '성대물혹이나 목의 혹은 진료 가능합니다. 홈페이지 목의 혹 안내 기준으로 문진과 함께 후두내시경검사, 혈액검사, 초음파검사, 방사선검사, CT검사 등을 통해 혹의 위치와 원인을 확인할 수 있습니다. 수술이나 시술이 필요한지는 검사 결과와 의료진 판단에 따라 결정됩니다.'
    : '성대물혹이나 목의 혹은 진료 가능합니다. 홈페이지 목의 혹 안내 기준으로 환자 나이, 혹의 위치, 발생 시기, 크기, 통증 여부 등을 확인하고 후두내시경검사, 혈액검사, 초음파검사, 방사선검사, CT검사 등을 시행할 수 있습니다.';

  return {
    type: 'throat_mass_care',
    answer,
    followUp: [
      '성대물혹 관련 진료는 목질환센터 또는 두경부센터 의료진 기준으로 확인해 주세요.',
      '검사와 치료 방향은 진료 후 의료진이 결정합니다.',
    ],
    sources: [
      buildLocalDocSource('홈페이지-목의 혹', '홈페이지-목의 혹.txt'),
      buildLocalDocSource('외래-의료진 명단', DOCTOR_LIST_DOC_FILENAME),
    ],
  };
}

function buildDischargeTimeResponse(message) {
  const text = String(message || '');
  if (!/(퇴원\s*시간|퇴원시간|몇\s*시.{0,8}퇴원|퇴원.{0,8}몇\s*시|언제.{0,8}퇴원|퇴원.{0,8}언제)/u.test(text)) {
    return null;
  }

  return {
    type: 'discharge_time',
    answer: '퇴원시간은 수술 종류와 환자 상태에 따라 달라지며, 퇴원 전 회진이나 진료 후 퇴원하게 됩니다. 문서 기준으로 코수술 환자는 오전 퇴원 시 9시~9시 30분, 오후 퇴원 시 2시로 안내되어 있습니다. 목수술 환자는 오전 9시~9시 30분, 귀수술 환자는 오전 퇴원 시 9시~9시 30분, 오후 퇴원 시 2시로 안내됩니다.',
    followUp: [
      '당일 상태나 회진 일정에 따라 실제 퇴원시간은 달라질 수 있습니다.',
      '퇴원 당일에는 수술부위 확인, 주의사항 안내, 진료비 수납 등이 함께 진행됩니다.',
    ],
    sources: [
      buildIntegratedFaqDocSource(),
      buildLocalDocSource('홈페이지-입퇴원 안내', '홈페이지-입퇴원 안내.txt'),
    ],
  };
}

function buildFacilityLocationResponse(message) {
  const text = String(message || '');
  const sources = [buildLocalDocSource('기타-층별안내도', '기타-층별안내도.txt')];

  if (/(항노화|항\s*노화|H\s*Reverse|리버스\s*에이징|reverse\s*aging)/iu.test(text)) {
    return {
      type: 'anti_aging_clinic_location',
      answer: '항노화클리닉(H Reverse Aging Center)은 층별안내도 기준 7층에 있습니다.',
      followUp: ['내원 당일 위치가 헷갈리면 1층 원무과 또는 가까운 직원에게 문의해 주세요.'],
      sources,
    };
  }

  if (/(입원실|병동|회복실)/u.test(text) && /(시설|갖추|있나|위치|어디|층)/u.test(text)) {
    return {
      type: 'facility_location',
      answer: '입원실은 병동이 있는 4층과 5층에 있고, 수술실·회복실·마취과는 6층에 있습니다. 층별안내도 기준으로 4층은 병동 401~409호와 약제과, 5층은 병동 501~509호로 안내됩니다.',
      followUp: ['입원 관련 세부 이용 기준은 입원 전 병동 안내를 함께 확인해 주세요.'],
      sources,
    };
  }

  if (/(약국|약제과|약\s*타|약\s*받)/u.test(text)) {
    return {
      type: 'pharmacy_location',
      answer: '병원 4층에 약제과가 있으나 주로 입원환자 이용과 관련된 공간입니다. 외래 환자의 처방약은 병원 내부 약국이 아니라 병원 입구 기준 양쪽에 있는 외부 약국을 이용하시면 됩니다.',
      followUp: ['처방전이나 약 수령 위치가 헷갈리면 1층 원무과 또는 직원에게 문의해 주세요.'],
      sources,
    };
  }

  if (/(청력검사|청력\s*검사|내시경|검사).{0,12}(건물|위치|어디|층|가능|모두)/u.test(text)) {
    return {
      type: 'exam_location',
      answer: '검사 종류에 따라 위치가 다릅니다. 층별안내도 기준으로 청력검사실은 지하 2층에 있고, CT·보청기상담실·외래검사실 등은 1층에 안내되어 있습니다. 코 내시경은 일반적으로 진료실에서 진료 중 시행될 수 있습니다.',
      followUp: [
        '검사 동선은 당일 진료 후 직원 안내에 따라 이동하시면 됩니다.',
        '검사 종류와 당일 상황에 따라 위치나 순서가 달라질 수 있습니다.',
      ],
      sources,
    };
  }

  return null;
}

function buildAccessibilityResponse(message) {
  const text = String(message || '');
  if (!/(장애|휠체어|몸이\s*불편|거동|편의시설)/u.test(text)) {
    return null;
  }

  return {
    type: 'accessibility_support',
    answer: '몸이 불편하시거나 휠체어를 이용 중인 고객은 2층에서 접수와 수납을 도와드리고 있으며, 진료도 가능합니다. 휠체어가 필요하시면 가까운 직원에게 말씀해 주세요.',
    followUp: ['홈페이지 외래진료안내에도 휠체어 이용자는 2층 안내에서 접수/수납을 도와드린다고 안내되어 있습니다.'],
    sources: [
      buildIntegratedFaqDocSource(),
      buildLocalDocSource('홈페이지-외래진료안내', '홈페이지-외래진료안내.txt'),
    ],
  };
}

function buildMedicalRecordCopyResponse(message) {
  const text = String(message || '');
  if (!/(진료\s*기록|진료기록|검사\s*결과|검사결과|의무기록|기록|결과).{0,16}(복사|사본|발급|받|떼|출력)/u.test(text)) {
    return null;
  }

  return {
    type: 'medical_record_copy',
    answer: '진료기록이나 검사 결과는 서류 종류에 따라 발급 방식이 다릅니다. 검사 영상자료는 CD 복사로 발급할 수 있고, 기타 진료기록은 진료기록사본으로 발급할 수 있습니다. 비급여비용 문서 기준으로 CD복사는 10,000원, 진료기록사본은 1,000원 항목이 안내되어 있습니다.',
    followUp: [
      '개인정보보호법에 따라 본인이 신분증을 지참하고 내원해 본인 확인 후 발급하는 것이 원칙입니다.',
      '보호자나 대리인이 내원하는 경우 필요한 구비서류를 확인해 주세요.',
    ],
    sources: [
      buildIntegratedFaqDocSource(),
      buildLocalDocSource('기타-비급여비용', path.basename(CERTIFICATE_FEES_DOC_PATH || '기타-비급여비용.txt')),
      buildLocalDocSource('홈페이지-외래진료안내', '홈페이지-외래진료안내.txt'),
    ],
  };
}

function buildResultNotificationResponse(message) {
  const text = String(message || '');
  if (!/(진료\s*후|진료후|검사\s*후|검사후|결과)/u.test(text) || !/(문자|앱|카톡|알림|받아볼|전송)/u.test(text)) {
    return null;
  }

  return {
    type: 'result_notification',
    answer: '일반 진료 결과나 검사 결과를 문자나 앱으로 받아볼 수 있는지에 대해서는 현재 문서에서 명확히 확인되지 않습니다. 다만 입원 수술 진행 상황은 원무과에 등록한 보호자 연락처로 안내 문자가 3회 발송된다고 안내되어 있습니다. 검사 결과는 문서 기준으로 진료 당일 확인 가능한 경우가 많지만, 별도 문자나 앱 제공 여부는 대표전화 02-6925-1111로 확인해 주세요.',
    followUp: [
      '검사 결과 사본이나 진료기록이 필요하면 서류 발급 절차로 문의해 주세요.',
      '수술 진행 안내 문자는 병동에서 수술실 이동, 수술 종료, 회복실 퇴실 후 병동 도착 시점에 발송됩니다.',
    ],
    sources: [buildIntegratedFaqDocSource()],
  };
}

function buildInfectionPreventionResponse(message) {
  const text = String(message || '');
  if (!(/(병원|병동|입원|면회)/u.test(text) && /(감염|감염병|예방|방역|면회\s*제한)/u.test(text))) {
    return null;
  }

  return {
    type: 'infection_prevention',
    answer: '입원환자 면회는 환자 안전관리와 감염병 예방을 위해 전면 금지로 안내되어 있습니다. 병동 4층과 5층은 환자의 안정과 감염예방을 위해 출입을 제한하며, 출입증을 소지한 보호자 또는 환자 본인만 병동 출입이 가능합니다. 면회가 필요한 경우에는 1층 또는 2층 대기실 이용으로 안내됩니다.',
    followUp: [
      '감기나 인플루엔자 등 호흡기 질환자, 급성 장 관계 감염이 있는 면회객 등은 제한 대상입니다.',
      '보호자 상주는 의료진 판단에 따라 예외적으로 안내될 수 있습니다.',
    ],
    sources: [
      buildIntegratedFaqDocSource(),
      buildLocalDocSource('홈페이지-입퇴원 안내', '홈페이지-입퇴원 안내.txt'),
    ],
  };
}

function buildAdditionalConsultationResponse(message) {
  const text = String(message || '');
  if (!/(추가\s*상담|진료과목\s*외|건강검진|예방관리|예방\s*관리|예방접종)/u.test(text)) {
    return null;
  }

  return {
    type: 'additional_consultation',
    answer: '진료과목 외 추가 상담은 상담 내용에 따라 가능 여부가 달라집니다. 병원 문서에는 이비인후과 질환 진료와 검사, 내과 진료, 예방접종 관련 진료 분야가 확인됩니다. 건강검진이나 예방관리처럼 구체적인 항목은 운영 여부와 담당 진료과 확인이 필요하므로 대표전화 02-6925-1111로 문의해 주세요.',
    followUp: [
      '예방접종은 의료진 정보의 내과 전문분야 및 비급여비용 문서에 관련 항목이 확인됩니다.',
      '원하시는 상담 항목을 말씀해 주시면 관련 진료과나 문의 방향을 안내해 드릴게요.',
    ],
    sources: [
      buildLocalDocSource('홈페이지-의료진 정보', '홈페이지-의료진 정보.txt'),
      buildLocalDocSource('기타-비급여비용', path.basename(CERTIFICATE_FEES_DOC_PATH || '기타-비급여비용.txt')),
    ],
  };
}

function buildHearingTestProcessResponse(message) {
  const text = String(message || '');
  if (!/(청력|난청|귀\s*검사|귀검사)/u.test(text) || !/(검사|진행|어떻게|방법|종류)/u.test(text)) {
    return null;
  }

  return {
    type: 'hearing_test_process',
    answer: '청력검사는 문진과 진료 후 필요한 검사로 청력 상태와 난청의 정도, 종류를 확인하는 과정입니다. 홈페이지 난청 안내 기준으로 순음청력검사, 어음청력검사, 임피던스청력검사, 이음향방사검사, 청성뇌간반응청력검사 등이 청력검사 종류에 포함됩니다. 어지럼증이 함께 있으면 청력검사와 전정기능검사, 필요 시 영상검사까지 함께 검토될 수 있습니다.',
    followUp: [
      '수면검사와는 다른 귀/난청 관련 검사입니다.',
      '검사 종류와 소요시간은 증상과 진료 결과에 따라 달라질 수 있습니다.',
      '정확한 검사 안내는 진료 후 의료진이 결정합니다.',
    ],
    sources: [
      buildLocalDocSource('홈페이지-난청', '홈페이지-난청.txt'),
      buildLocalDocSource('홈페이지-어지러움증', '홈페이지-어지러움증.txt'),
    ],
  };
}

function buildTonsillectomyInfoResponse(message) {
  const text = String(message || '');
  const isTonsil = /(편도|편도선|편도절제|편도\s*절제|편도수술|편도\s*수술|편도수숙)/u.test(text);
  if (!isTonsil) {
    return null;
  }

  if (/(후|주의|출혈|피|음식|식사|통증)/u.test(text)) {
    return null;
  }

  const asksIndication = /(언제|필요|해야|하나요|하는가|고려|적응증|대상)/u.test(text);
  const asksGeneral = /^(편도|편도수술|편도\s*수술|편도절제|편도\s*절제|편도수숙)$/u.test(text.trim());
  const asksExam = /(검사|뭐\s*있|무슨\s*검사)/u.test(text);
  const asksCost = /(비용|금액|가격|얼마)/u.test(text);
  const asksStay = /(입원|며칠|기간|회복|수술시간|마취)/u.test(text);

  if (!(asksIndication || asksGeneral || asksExam || asksCost || asksStay)) {
    return null;
  }

  const answerParts = [
    '편도절제술은 홈페이지 편도 안내 기준으로 1년에 3번 이상 고열을 동반한 편도선염을 앓는 경우, 편도결석이 반복되어 불편한 경우, 편도비대로 코골이나 수면무호흡증이 심한 경우 고려할 수 있습니다.',
    '하나이비인후과병원 안내에는 편도절제술 수술시간은 약 20~30분, 마취방법은 전신마취, 입원기간은 2박 3일, 회복기간은 약 2~3주로 안내되어 있습니다.',
  ];

  if (asksExam) {
    answerParts.push('편도수술 전 어떤 검사가 필요한지는 진료와 환자 상태에 따라 결정됩니다. 문서에는 편도수술의 적응증과 수술 정보가 중심으로 안내되어 있어, 개별 검사 항목은 진료 후 안내를 받으시는 것이 정확합니다.');
  }

  return {
    type: 'tonsillectomy_info',
    answer: answerParts.join('\n\n'),
    followUp: [
      '성인 편도절제술 수술비용은 문서 기준 90만원으로 안내되어 있습니다.',
      '소아 편도절제술은 130만원으로 안내되어 있습니다.',
      '실제 수술 여부는 진찰과 검사 후 의료진 판단이 필요합니다.',
    ],
    sources: [buildLocalDocSource('홈페이지-편도', '홈페이지-편도.txt')],
  };
}

function buildRhinitisExamResponse(message) {
  const text = String(message || '');
  if (!/(비염|알레르기비염|알러지|알레르기)/u.test(text) || !/(검사|외래|진단|뭐|종류)/u.test(text)) {
    return null;
  }

  return {
    type: 'rhinitis_exam_info',
    answer: '외래 비염 검사로는 홈페이지 알레르기비염 안내 기준 문진, 코내시경, 알레르기 피부반응검사, 비강통기도검사, X-ray 또는 CT 검사가 안내되어 있습니다. 특히 알레르기 원인 확인이 필요한 경우 알레르기 피부반응검사를 시행할 수 있습니다.',
    followUp: [
      '검사 항목은 증상과 진료 결과에 따라 달라질 수 있습니다.',
      '코막힘이나 축농증 의심 여부에 따라 영상검사가 함께 검토될 수 있습니다.',
    ],
    sources: [buildLocalDocSource('홈페이지-알레르기비염', '홈페이지-알레르기비염.txt')],
  };
}

function buildExamTypeClarificationResponse(message) {
  const text = String(message || '').trim();
  if (!/^(검사\s*종류|검사종류|검사\s*안내|검사)$/u.test(text)) {
    return null;
  }

  return {
    type: 'exam_type_clarification',
    answer: '검사는 진료 분야에 따라 종류가 달라서 먼저 어느 검사를 말씀하시는지 확인이 필요합니다. 예를 들어 귀/난청은 청력검사, 어지럼증은 전정기능검사, 비염은 코내시경·알레르기 피부반응검사·비강통기도검사, 수면무호흡은 수면다원검사로 나뉩니다.',
    followUp: [
      '청력검사 종류 알려줘',
      '외래 비염검사 뭐가 있나요?',
      '수면검사는 어떻게 하나요?',
    ],
    sources: [
      buildLocalDocSource('홈페이지-난청', '홈페이지-난청.txt'),
      buildLocalDocSource('홈페이지-알레르기비염', '홈페이지-알레르기비염.txt'),
      buildIntegratedFaqDocSource(),
    ],
  };
}

function resolveMeaningIntentResponse(meaning, message, sessionId) {
  const intent = String(meaning?.intent || '');

  switch (intent) {
    case 'network_hospital_info':
      return buildNetworkHospitalInfoResponse();
    case 'parking_info':
      return buildParkingInfoResponse(message);
    case 'nasal_irrigation_surgery':
      clearConversationState(sessionId);
      return createNasalIrrigationResponse('surgery');
    case 'nasal_irrigation_general':
      clearConversationState(sessionId);
      return createNasalIrrigationResponse('general');
    case 'nasal_irrigation':
      if (meaning.needsClarification) {
        setConversationState(sessionId, {
          topic: 'nasal_irrigation',
          originalMessage: message,
        });
        return createGuidedQuestionResponse(
          meaning.clarificationQuestion || '코세척은 수술 후 코세척인지 일반 코세척인지 먼저 확인이 필요합니다.',
          meaning.options?.length ? meaning.options : ['수술 후 코세척이에요', '일반 코세척이에요']
        );
      }
      return null;
    case 'guardian_meal':
      return buildGuardianMealResponse();
    case 'medication_stop':
      return createMedicationStopResponse();
    case 'admission_prep_items':
      return buildReinitializedIntentResponse('admission_prep_items', message);
    default:
      return null;
  }
}

function createFallbackInsufficientEvidenceResponse(contextTitles) {
  return {
    type: 'fallback_insufficient_evidence',
    answer: '현재 확인된 병원 문서만으로는 정확히 안내드리기 어렵습니다. 질문을 조금 더 구체적으로 남겨 주시거나 대표전화 02-6925-1111로 확인해 주세요.',
    followUp: contextTitles.length > 0 ? contextTitles : ['진료시간 안내', '의료진 일정', '서류 발급 안내'],
  };
}

function createFallbackNeedsClarificationResponse() {
  return {
    type: 'fallback_needs_clarification',
    answer: '질문 범위가 넓어 한 번에 정확히 안내드리기 어렵습니다. 궁금한 항목을 조금만 더 구체적으로 알려주시면 그 내용부터 바로 안내해 드릴게요.',
    followUp: ['수술 종류를 알려주세요', '검사 종류를 알려주세요', '외래인지 입원인지 알려주세요'],
  };
}

function createConsultationClarificationResponse(message) {
  const text = String(message || '');
  const followUp = [];

  if (/(수술|수술후|수술 후)/u.test(text)) {
    followUp.push('수술 비용이 궁금해요', '수술 후 주의사항이 궁금해요');
  }

  if (/(검사|검진)/u.test(text)) {
    followUp.push('당일 검사 가능 여부가 궁금해요', '검사 전 준비사항이 궁금해요');
  }

  if (/(입원|병동|병실)/u.test(text)) {
    followUp.push('입원 준비물이 궁금해요', '병실 비용이 궁금해요');
  }

  if (/(예약|접수)/u.test(text)) {
    followUp.push('예약 방법이 궁금해요', '당일 접수가 가능한지 궁금해요');
  }

  const normalizedFollowUp = followUp.length > 0
    ? [...new Set(followUp)].slice(0, 3)
    : ['진료시간이 궁금해요', '의료진 정보가 궁금해요', '서류 발급이 궁금해요'];

  return {
    type: 'consultation_clarification',
    answer: '질문 의도는 이해했지만, 비슷한 안내가 여러 개라 바로 단정하면 엉뚱한 답변이 될 수 있습니다. 아래 중 어느 쪽인지 알려주시면 그 기준으로 정확히 안내드릴게요.',
    followUp: normalizedFollowUp,
  };
}

function createFallbackInferenceResponse() {
  return {
    type: 'fallback_inference',
    answer: '문서에서 관련 근거는 확인되지만 직접 명시된 안내는 아니라 확정해서 말씀드리기는 어렵습니다. 정확한 운영 방식은 병동 또는 대표전화 02-6925-1111로 확인해 주세요.',
    followUp: ['문서에서 확인한 관련 항목을 기준으로 안내드립니다.', '운영 방식은 시점에 따라 달라질 수 있습니다.'],
  };
}

function createFallbackRestrictedResponse() {
  return {
    type: 'fallback_restricted',
    answer: '이 부분은 상담봇이 판단해 드릴 수 없습니다. 진료과 또는 의료진과 직접 확인해 주세요.',
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
    ['안녕하세요', '안녕', 'ㅎㅇ', '하이', '반가워요', '반갑습니다', '처음 왔어요'].includes(normalized)
    || compact === '안녕하세요'
    || compact === '안녕'
    || compact === 'ㅎㅇ'
    || compact === '하이'
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
      answer: '안녕하세요. 하나이비인후과병원 안내 상담봇입니다. 예약, 진료시간, 의료진, 입원, 셔틀버스 같은 병원 안내를 도와드릴게요.',
      followUp: ['진료시간 알려줘', '셔틀버스 시간표 알려줘', '입원 안내 알려줘'],
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

  return `${value}\n검색 보강: ${[...hints].join(', ')}`;
}

function tokenizeSafe(text) {
  return normalizeSearchTextSafe(text)
    .split(' ')
    .filter((token) => token.length >= 2);
}

function getInformativeSearchTokens(text) {
  const tokens = tokenizeSafe(text);
  const filtered = tokens.filter((token) => !SEARCH_TOKEN_STOPWORDS.has(token));
  return filtered.length > 0 ? filtered : tokens;
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
  const addDoctorName = (name) => {
    const value = String(name || '').trim();
    if (
      /^[가-힣]{2,4}$/u.test(value)
      && !/(이비|비인|진료|센터|전문|수면|두경|내과|소아|코|목|귀)/u.test(value)
      && !value.endsWith('과')
    ) {
      names.add(value);
    }
  };
  const titlePattern = /(대표원장|병원장|원장|부원장|센터장|진료부장|과장|부장|전문의)/u;
  const structuredNamePattern = /이름\s*:\s*([가-힣]{2,4})/gu;
  for (const match of value.matchAll(structuredNamePattern)) {
    addDoctorName(match[1]);
  }

  const blocks = value
    .split(/\r?\n\s*\r?\n+/)
    .map((block) => block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length > 0);

  blocks.forEach((lines) => {
    const [firstLine = '', secondLine = ''] = lines;

    if (/^[가-힣]{2,4}$/u.test(firstLine) && titlePattern.test(secondLine)) {
      addDoctorName(firstLine);
      return;
    }

    // Inline titles like "이비인후과 전문의" are not names, so only standalone
    // name blocks and structured "이름:" rows are used for automatic extraction.
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

  const text = repairBrokenKoreanText(fs.readFileSync(DOCTOR_SPECIALTY_DOC_PATH, 'utf8'));
  const specialtyConfigs = buildDoctorSpecialtyKeywordConfigs();
  const doctorNames = [
    ...new Set([
      ...DOCTOR_NAME_FALLBACK_LIST.filter((name) => text.includes(name)),
      ...extractDoctorNamesFromText(text),
    ]),
  ];
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
      .find((line) => line.includes('전문분야'));

    const specialtyText = specialtyLine
      ? specialtyLine
        .replace(/^.*?전문분야\s*:?\s*/u, '')
        .split(/\s+(주간\s*진료\s*시간표|주요경력|논문및연구|세부설명)/u)[0]
        .trim()
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
    .map((line) => repairBrokenKoreanText(String(line || '').replace(/\r/g, '').trim()))
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
    .map((line) => repairBrokenKoreanText(String(line || '').replace(/\r/g, '').trim()))
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
    .map((line) => repairBrokenKoreanText(String(line || '').trim()))
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
          '다른 층 안내가 필요하시면 1층, 2층, 3층처럼 다시 질문해 주세요.',
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
  { disease: '비염', aliases: ['비염', '만성비염', '알레르기비염', '비염수술', '비염 수술', '비염수술비'], filename: '홈페이지-만성비염.txt' },
  { disease: '축농증', aliases: ['축농증', '부비동염', '축농증수술', '축농증 수술', '부비동염수술'], filename: '홈페이지-축농증.txt' },
  { disease: '편도', aliases: ['편도', '편도수술', '편도 수술'], filename: '홈페이지-편도.txt' },
  { disease: '비중격만곡증', aliases: ['비중격만곡증', '비중격', '비중격수술', '비중격 수술'], filename: '홈페이지-비중격만곡증.txt' },
  { disease: '코물혹', aliases: ['코물혹', '비용종', '코물혹수술', '코물혹 수술'], filename: '홈페이지-코물혹.txt' },
  { disease: '중이염', aliases: ['중이염', '만성중이염', '소아중이염'], filename: '홈페이지-만성중이염.txt' },
  { disease: '갑상선', aliases: ['갑상선', '갑상선수술', '갑상선 수술'], filename: '홈페이지-갑상선.txt' },
  { disease: '침샘', aliases: ['침샘', '침샘수술', '침샘 수술'], filename: '홈페이지-침샘.txt' },
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

function normalizeHomepageSurgerySectionLine(line) {
  return normalizeDocLine(line)
    .replace(/약(?=\d)/g, '약 ')
    .replace(/실비보험\s*적용가능/g, '실비보험 적용 가능')
    .replace(/실비보험적용가능/g, '실비보험 적용 가능')
    .replace(/(\d)박\s*(\d)일/g, '$1박 $2일')
    .replace(/(\d)주~(\d)주/g, '$1주~$2주')
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
      || normalizedLine.includes('특장')
    ) {
      break;
    }
    collected.push(line);
    if (collected.length >= 3) {
      break;
    }
  }

  return collected.map((line) => normalizeHomepageSurgerySectionLine(line)).filter(Boolean);
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
  const repairedText = repairBrokenKoreanText(text);
  const stopLabels = ['수술비용', '수술시간', '마취방법', '입원기간', '내원치료', '회복기간', '치료 특장'];
  const costLines = extractHomepageSurgerySectionLines(repairedText, ['수술비용'], stopLabels);
  const timeLines = extractHomepageSurgerySectionLines(repairedText, ['수술시간'], stopLabels);
  const anesthesiaLines = extractHomepageSurgerySectionLines(repairedText, ['마취방법'], stopLabels);
  const admissionLines = extractHomepageSurgerySectionLines(repairedText, ['입원기간'], stopLabels);
  const followupLines = extractHomepageSurgerySectionLines(repairedText, ['내원치료'], stopLabels);
  const recoveryLines = extractHomepageSurgerySectionLines(repairedText, ['회복기간'], stopLabels);

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

  sentences.push('정확한 수술 적응증과 비용 적용 방식은 진료와 검사 후 결정되므로 자세한 상담이나 예약은 대표전화 02-6925-1111로 문의해 주세요.');

  return {
    type: 'homepage_surgery_cost',
    answer: sentences.join(' '),
    followUp: [
      '보험 적용 여부와 실제 비용은 질환 상태와 검사 결과에 따라 달라질 수 있습니다.',
      '다른 수술이나 질환명을 말씀해 주시면 해당 문서 기준으로 다시 안내해 드릴게요.',
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

  const docText = repairBrokenKoreanText(fs.readFileSync(docPath, 'utf8'));
  const stopLabels = ['수술비용', '수술시간', '마취방법', '입원기간', '내원치료', '회복기간', '치료 특장'];
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

  sentences.push('정확한 수술 적응증과 방법은 진료와 검사 후 결정되므로 자세한 상담이나 예약은 대표전화 02-6925-1111로 문의해 주세요.');

  return {
    type: 'homepage_surgery_info',
    answer: sentences.join(' '),
    followUp: [
      '원하시는 수술명을 구체적으로 말씀해 주시면 비용, 입원기간, 회복기간 기준으로 다시 안내해 드릴게요.',
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
    answer: `${matchedEntry.title} 비용은 ${matchedEntry.price}입니다.`,
    followUp: [
      '기준 문서: 기타-비급여비용.txt',
      wantsReissue ? '재발급 기준 금액으로 안내드립니다.' : '초발급 기준 금액으로 안내드립니다.',
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
    answer: `${matchedEntry.title} 비용은 ${matchedEntry.price}입니다.`,
    followUp: [
      '기준 문서: 기타-비급여비용.txt',
      '실제 적용 기준이나 변경 여부는 대표전화 02-6925-1111로 다시 확인해 주세요.',
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
    .map((line) => repairBrokenKoreanText(String(line || '').replace(/\r/g, '').trim()))
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
      '기준 문서: 기타-비급여비용.txt',
      '입원 형태와 적용 기준에 따라 실제 안내가 달라질 수 있어 대표전화 02-6925-1111로 다시 확인해 주세요.',
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
    .map((line) => repairBrokenKoreanText(String(line || '').replace(/\r/g, '').trim()))
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
      compactSearchTextSafe(line).includes(compactSearchTextSafe('보호자 식대'))
    ));

    if (!matchedLine) {
      return null;
    }

    const price = extractPriceText(matchedLine);

    return {
      type: 'operational_inference',
      answer: price
        ? `비급여비용 문서에 보호자 식대 ${price} 항목이 있어 보호자 식사가 제공되거나 신청 가능한 운영일 가능성이 높습니다. 다만 문서에 신청 방법이나 제공 기준이 직접 적혀 있지는 않아 정확한 운영 방식은 병동 또는 대표전화 02-6925-1111로 확인해 주세요.`
        : '비급여비용 문서에 보호자 식대 항목이 있어 보호자 식사가 제공되거나 신청 가능한 운영일 가능성이 높습니다. 다만 신청 방법이나 제공 기준은 문서에 직접 적혀 있지 않아 병동 또는 대표전화 02-6925-1111로 확인해 주세요.',
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
    answer: `비급여비용 문서에 ${matchedEntry.title} 비용 항목이 있어 해당 서비스는 운영 중일 가능성이 높습니다. 다만 적용 기준이나 대상은 문서에 직접 정리되어 있지 않아 정확한 운영 방식은 대표전화 02-6925-1111로 확인해 주세요.`,
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
    return repairBrokenKoreanText(fs.readFileSync(filePath, 'utf8'));
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
        title: '로컬 문서',
        sourceTitle: '로컬 문서',
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

function collectPreferredLocalDocumentInputs() {
  const inputs = [];

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
semanticSearchService = createSemanticSearchService({
  apiKey: OPENAI_API_KEY,
  getSources: () => ({
    faqEntries: runtimeData?.faqEntries || [],
    integratedFaqCards: runtimeData?.integratedFaqCards || [],
    localDocuments: runtimeData?.localDocuments || [],
    imageGuides,
  }),
});

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
  const candidates = ['통합-FAQ', '통합 FAQ', '통합-faq', '홈페이지-FAQ', '홈페이지 FAQ', 'homepage-faq'];

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
  const informativeTokens = getInformativeSearchTokens(normalizedQuestion);
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
        if (!normalizedKeyword) {
          return score;
        }
        const matched = normalizedQuestionVariants.some((variant) => variant.includes(normalizedKeyword));
        return matched ? score + 1 : score;
      }, 0);
      const titleScore = informativeTokens.reduce((score, token) => (
        normalizedTitle.includes(token) ? score + 3 : score
      ), 0);
      const tokenScore = informativeTokens.reduce((score, token) => (
        normalizedText.includes(token) ? score + 1 : score
      ), 0);
      const phraseScore = normalizedQuestionVariants.some((variant) => variant && normalizedText.includes(variant)) ? 10 : 0;
      const titlePhraseScore = normalizedQuestionVariants.some((variant) => variant && normalizedTitle.includes(variant)) ? 14 : 0;
      const compactScore = compactQuestionVariants.some((variant) => (
        variant && (compactTitle.includes(variant) || compactText.includes(variant))
      )) ? 8 : 0;
      const localDocBonus = doc.sourceType === 'local' && (titleScore > 0 || phraseScore > 0 || compactScore > 0) ? 3 : 0;
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

function mergeSemanticAndKeywordDocuments(semanticDocs, keywordDocs, limit = 7) {
  const merged = [];
  const seen = new Set();

  [...(semanticDocs || []), ...(keywordDocs || [])].forEach((doc) => {
    if (!doc || !String(doc.text || '').trim()) {
      return;
    }

    const key = [
      String(doc.url || '').trim(),
      String(doc.chunkLabel || '').trim(),
      normalizeSearchTextSafe(String(doc.title || doc.sourceTitle || '')),
      normalizeSearchTextSafe(String(doc.text || '').slice(0, 160)),
    ].join('::');

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    merged.push(doc);
  });

  return merged.slice(0, limit);
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
        '코세척 안내는 수술 후 코세척인지 일반 코세척인지에 따라 달라집니다. 수술 후 코세척인지, 일반 코세척인지 알려주세요.',
        ['수술 후 코세척이에요', '일반 코세척이에요']
      ),
    };
  }

  if (matchesAnyPattern(message, PREP_BROAD_PATTERNS) && !matchesAnyPattern(message, PREP_DETAIL_PATTERNS)) {
    return {
      topic: 'admission_prep',
      originalMessage: message,
      prompt: createGuidedQuestionResponse(
        '입원이나 수술 준비는 항목이 나뉘어 있습니다. 준비물, 주차, 보호자, 수술 전 검사, 복용 중단 약물 중 어떤 내용이 궁금하신가요?',
        ['준비물이 궁금해요', '주차가 궁금해요', '보호자가 궁금해요', '수술 전 검사가 궁금해요', '복용 중단 약물이 궁금해요']
      ),
    };
  }

  if (
    matchesAnyPattern(message, postOpCarePatterns)
    && !/(코|비염|축농증|비중격|코물혹|목|편도|귀|갑상선|침샘|이하선|악하선)/u.test(String(message || ''))
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
        answer: `${doctorName} 의료진의 전문분야는 ${doctorEntry.specialtyText} 입니다.`,
        followUp: [
          '진료 일정은 의료진별 외래 진료표와 당일 상황에 따라 달라질 수 있습니다.',
        ],
        sources: [{
          title: '홈페이지-의료진 정보',
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
    answer: `관련 전문분야 기준으로 안내드리면 ${uniqueDoctors.join(', ')} 의료진이 있습니다.`,
    followUp: [
      '진료 일정은 의료진별 외래 진료표와 당일 상황에 따라 달라질 수 있습니다.',
      `전문분야 참고: ${summary}`,
    ],
    sources: [{
      title: '홈페이지-의료진 정보',
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
      return { resolved: true, message: '외래 방문 주차 안내' };
    }

    if (matchesAnyPattern(message, PARKING_INPATIENT_PATTERNS)) {
      return { resolved: true, message: '입원 환자 주차 안내' };
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
      return { resolved: true, message: '수술 후 코세척 방법' };
    }

    if (matchesAnyPattern(message, NASAL_IRRIGATION_GENERAL_PATTERNS)) {
      return { resolved: true, message: '일반 코세척 방법' };
    }

    return {
      resolved: false,
      prompt: createGuidedQuestionResponse(
        '코세척 안내를 맞춰 드리려면 수술 후 코세척인지 일반 코세척인지 확인이 필요합니다. 어느 경우인지 알려주세요.',
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
        '원하시는 준비 항목을 먼저 알려주세요. 준비물, 주차, 보호자, 수술 전 검사, 복용 중단 약물 중에서 선택해 주세요.',
        ['준비물', '주차', '보호자', '수술 전 검사', '복용 중단 약물']
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
        '수술 후 주의사항을 정확히 안내하려면 수술 종류가 필요합니다. 아래 중에서 골라 주세요.',
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

  if (matchesAnyPattern(text, ADMISSION_PREP_ITEMS_PATTERNS)) {
    return { type: 'admission_prep_items' };
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

  if (buildCleanNonpayItemResponse(text)) {
    return { type: 'nonpay_item_fee' };
  }

  if (matchesAnyPattern(text, hospitalPhonePatterns)) {
    return { type: 'hospital_phone' };
  }

  if (matchesAnyPattern(text, lateArrivalPatterns)) {
    return { type: 'late_arrival' };
  }

  if (matchesAnyPattern(text, inpatientAmenityPatterns)) {
    return { type: 'inpatient_amenity' };
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

  if (matchesAnyPattern(text, guardianVisitPatterns)) {
    return { type: 'guardian_visit' };
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

  if (normalized.includes('예약') || normalized.includes('접수')) {
    return { type: 'reservation_or_reception' };
  }

  return { type: 'unknown' };
}

function buildLocalDocSource(title, filename) {
  return {
    title,
    url: `local://docs/${encodeURIComponent(filename)}`,
  };
}

function buildIntegratedFaqDocSource() {
  return buildLocalDocSource(INTEGRATED_FAQ_DOC_TITLE, INTEGRATED_FAQ_DOC_FILENAME);
}

function cleanIntentPayload(payload) {
  return payload ? repairChatPayloadFields(payload) : null;
}

function buildCleanCertificateFeeResponse(message) {
  const normalizedMessage = normalizeSearchTextSafe(message);
  if (!normalizedMessage || !/(비용|금액|수수료|가격|얼마)/u.test(message)) {
    return null;
  }

  const wantsReissue = /(재발급|재발행|재본)/u.test(message);
  const targets = [
    { baseKey: 'diagnosis', reissueKey: 'diagnosis_reissue', aliases: ['진단서'] },
    { baseKey: 'surgery_confirmation', reissueKey: 'surgery_confirmation_reissue', aliases: ['수술확인서', '수술 확인서'] },
    { baseKey: 'admission_discharge', reissueKey: 'admission_discharge_reissue', aliases: ['입퇴원확인서', '입원확인서', '퇴원확인서'] },
  ];

  const matchedTarget = targets.find((target) => (
    target.aliases.some((alias) => normalizedMessage.includes(normalizeSearchTextSafe(alias)))
  ));
  if (!matchedTarget) {
    return null;
  }

  const entryKey = wantsReissue ? matchedTarget.reissueKey : matchedTarget.baseKey;
  const matchedEntry = (runtimeData.certificateFeeEntries || []).find((entry) => entry.key === entryKey);
  if (!matchedEntry) {
    return null;
  }

  return {
    type: 'certificate_fee',
    answer: `${matchedEntry.title} 비용은 ${matchedEntry.price}입니다.`,
    followUp: [
      '기준 문서는 기타-비급여비용입니다.',
      wantsReissue ? '재발급 비용 기준으로 안내드렸습니다.' : '초발급 비용 기준으로 안내드렸습니다.',
      '발급 절차는 원무과 또는 대표전화 02-6925-1111로 다시 확인해 주세요.',
    ],
    sources: [buildLocalDocSource('기타-비급여비용', path.basename(CERTIFICATE_FEES_DOC_PATH || '기타-비급여비용.txt'))],
  };
}

function buildCleanNonpayItemResponse(message) {
  const normalizedMessage = normalizeSearchTextSafe(message);
  const compactMessage = compactSearchTextSafe(message);
  if (!normalizedMessage || !/(비용|금액|가격|얼마)/u.test(message)) {
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
    answer: `${matchedEntry.title} 비용은 ${matchedEntry.price}입니다.`,
    followUp: [
      '기준 문서는 기타-비급여비용입니다.',
      '실제 적용 금액이나 운영 여부는 대표전화 02-6925-1111로 다시 확인해 주세요.',
      `비급여 안내 페이지: ${NONPAY_PAGE_URL}`,
    ],
    sources: [
      buildLocalDocSource('기타-비급여비용', path.basename(CERTIFICATE_FEES_DOC_PATH || '기타-비급여비용.txt')),
      { title: '비급여 안내 페이지', url: NONPAY_PAGE_URL },
    ],
  };
}

function buildCleanSingleRoomFeeResponse(message) {
  const payload = findSingleRoomFeeResponse(message);
  if (!payload) {
    return null;
  }

  return {
    type: 'single_room_fee',
    answer: payload.answer,
    followUp: [
      '기준 문서는 기타-비급여비용입니다.',
      '실제 적용 금액은 입원 형태에 따라 달라질 수 있어 대표전화 02-6925-1111로 다시 확인해 주세요.',
      `비급여 안내 페이지: ${NONPAY_PAGE_URL}`,
    ],
    sources: [
      buildLocalDocSource('기타-비급여비용', path.basename(CERTIFICATE_FEES_DOC_PATH || '기타-비급여비용.txt')),
      { title: '비급여 안내 페이지', url: NONPAY_PAGE_URL },
    ],
  };
}

function buildCleanDoctorSpecialtyResponse(message) {
  const text = String(message || '').trim();
  const directDoctorName = extractDoctorName(text)
    || DOCTOR_NAME_FALLBACK_LIST.find((name) => text.includes(name))
    || '';
  const hasDirectSpecialtyCue = Boolean(directDoctorName)
    && /(전문분야|전문\s*분야|전문|분야|무슨\s*진료|어떤\s*진료|뭐야|뭐예요|뭐에요|알려|궁금)/u.test(text);

  if (!isDoctorSpecialtyQuestion(text) && !hasDirectSpecialtyCue) {
    return null;
  }

  const doctorEntries = (runtimeData.doctorSpecialtyEntries || []).length > 0
    ? runtimeData.doctorSpecialtyEntries
    : buildDoctorSpecialtyEntries();

  const doctorName = directDoctorName;
  if (doctorName) {
    const doctorEntry = doctorEntries.find((entry) => entry.doctorName === doctorName);
    if (doctorEntry) {
      return {
        type: 'doctor_specialty',
        answer: `${doctorName} 의료진의 전문분야는 ${doctorEntry.specialtyText} 입니다.`,
        followUp: ['진료 일정은 외래 진료표와 당일 상황에 따라 달라질 수 있습니다.'],
        sources: [buildLocalDocSource('홈페이지-의료진 정보', '홈페이지-의료진 정보.txt')],
      };
    }
  }

  const expandedState = buildExpandedSearchState(message);
  const matchedEntries = doctorEntries.filter((entry) => (
    (entry.labels || []).some((label) => expandedState.normalizedVariants.some((variant) => (
      variant.includes(normalizeSearchTextSafe(label)) || normalizeSearchTextSafe(label).includes(variant)
    )))
  ));

  if (!matchedEntries.length) {
    return null;
  }

  const uniqueDoctors = [...new Set(matchedEntries.map((entry) => entry.doctorName))];
  const summary = matchedEntries
    .map((entry) => `${entry.doctorName}: ${entry.specialtyText}`)
    .join(' / ');

  return {
    type: 'doctor_specialty',
    answer: `관련 전문분야 기준으로 안내드리면 ${uniqueDoctors.join(', ')} 의료진이 있습니다.`,
    followUp: [
      '진료 일정은 외래 진료표와 당일 상황에 따라 달라질 수 있습니다.',
      `전문분야 참고: ${summary}`,
    ],
    sources: [buildLocalDocSource('홈페이지-의료진 정보', '홈페이지-의료진 정보.txt')],
  };
}

function buildDoctorCareerResponse(message) {
  const text = String(message || '').trim();
  const doctorName = extractDoctorName(text);
  if (!doctorName || !/(경력|학력|이력|프로필|약력)/u.test(text)) {
    return null;
  }

  if (!fs.existsSync(DOCTOR_SPECIALTY_DOC_PATH)) {
    return null;
  }

  const docText = repairBrokenKoreanText(fs.readFileSync(DOCTOR_SPECIALTY_DOC_PATH, 'utf8'));
  const startIndex = docText.indexOf(`이름: ${doctorName}`);
  if (startIndex < 0) {
    return null;
  }

  const nextDoctorIndex = docText.indexOf('\n\n이름:', startIndex + doctorName.length);
  const body = docText.slice(startIndex, nextDoctorIndex > startIndex ? nextDoctorIndex : undefined);
  const specialtyMatch = body.match(/전문분야\s+(.+)/u);
  const careerStart = body.indexOf('경력');
  if (careerStart < 0) {
    return null;
  }

  const careerEndCandidates = ['논문&연구실적', '주간 진료 시간표']
    .map((marker) => body.indexOf(marker, careerStart + 2))
    .filter((index) => index > careerStart)
    .sort((a, b) => a - b);
  const careerEnd = careerEndCandidates[0] || body.length;
  const careerLines = body
    .slice(careerStart, careerEnd)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && line !== '경력')
    .slice(0, 14);

  if (!careerLines.length) {
    return null;
  }

  const specialtyText = specialtyMatch ? specialtyMatch[1].trim() : '';
  const intro = specialtyText
    ? `${doctorName} 의료진의 전문분야는 ${specialtyText}입니다. 주요 경력은 다음과 같습니다.`
    : `${doctorName} 의료진의 주요 경력은 다음과 같습니다.`;

  return {
    type: 'doctor_career',
    answer: `${intro}\n\n${careerLines.map((line) => `- ${line}`).join('\n')}`,
    followUp: ['진료 일정은 외래 진료표와 당일 상황에 따라 달라질 수 있습니다.'],
    sources: [buildLocalDocSource('홈페이지-의료진 정보', '홈페이지-의료진 정보.txt')],
  };
}

function buildCleanPostOpCareResponse(message) {
  const source = [buildLocalDocSource('입원-수술 후 주의사항', '입원-수술 후 주의사항.txt')];
  const text = String(message || '');

  if (/(코|비염|축농증|비중격|코물혹)/u.test(text)) {
    return {
      type: 'postop_care_nose',
      answer: '코 수술 후에는 코를 세게 풀거나 강하게 건드리지 말고, 안내받은 시기부터 코세척과 외래 치료를 이어가시는 것이 중요합니다.',
      followUp: ['출혈이 많아지거나 통증이 심하면 대표전화 02-6925-1111로 바로 연락해 주세요.', '사우나, 음주, 흡연, 격한 운동은 회복 기간 동안 피하는 편이 좋습니다.'],
      sources: source,
    };
  }

  if (/(목|편도)/u.test(text)) {
    return {
      type: 'postop_care_throat',
      answer: '목 수술 후에는 뜨겁고 자극적인 음식보다 부드러운 식사를 권장하며, 출혈 여부를 잘 관찰하셔야 합니다.',
      followUp: ['선홍색 피가 계속 나거나 양이 많으면 즉시 병원으로 연락해 주세요.', '회복 초반에는 무리한 운동과 과도한 목 사용을 피하는 것이 좋습니다.'],
      sources: source,
    };
  }

  if (/귀/u.test(text)) {
    return {
      type: 'postop_care_ear',
      answer: '귀 수술 후에는 수술 부위에 물이 들어가지 않도록 주의하고, 압력이 많이 걸리는 행동은 피하는 편이 좋습니다.',
      followUp: ['어지럼이 심해지거나 출혈, 분비물이 계속되면 병원으로 연락해 주세요.', '세안이나 샤워는 안내받은 시점부터 조심스럽게 진행해 주세요.'],
      sources: source,
    };
  }

  if (/갑상선/u.test(text)) {
    return {
      type: 'postop_care_thyroid',
      answer: '갑상선 수술 후에는 목을 무리하게 젖히거나 강한 운동을 피하고, 상처 부위를 과하게 자극하지 않는 것이 중요합니다.',
      followUp: ['붓기, 통증, 목소리 변화가 심해지면 병원에 확인해 주세요.', '흡연과 음주는 회복 기간 동안 피하는 편이 좋습니다.'],
      sources: source,
    };
  }

  if (/(침샘|이하선|악하선)/u.test(text)) {
    return {
      type: 'postop_care_salivary',
      answer: '침샘 수술 후에는 상처 부위를 자극하지 말고, 부드러운 식사와 충분한 휴식을 권장합니다.',
      followUp: ['붓기나 통증이 심해지거나 열이 나면 병원으로 연락해 주세요.', '무거운 물건을 드는 행동과 격한 운동은 회복 기간 동안 피하는 것이 좋습니다.'],
      sources: source,
    };
  }

  return {
    type: 'postop_care',
    answer: '수술 후 주의사항은 수술 종류에 따라 달라집니다. 어떤 수술 후 주의사항이 필요한지 말씀해 주시면 맞춰서 안내해 드릴게요.',
    followUp: ['코 수술 후 주의사항', '목 수술 후 주의사항', '귀 수술 후 주의사항', '갑상선 수술 후 주의사항'],
    sources: source,
  };
}

function buildCleanInpatientAmenityResponse(message) {
  const text = String(message || '');
  const sources = [
    buildIntegratedFaqDocSource(),
    buildLocalDocSource('입원-입원생활안내문', '입원-입원생활안내문.txt'),
  ];

  if (/가습기/u.test(text)) {
    return {
      type: 'inpatient_amenity',
      answer: '병동 FAQ 기준으로 공용 가습기는 감염 문제로 제공되지 않습니다. 필요하시면 개인 가습기를 준비해 오시는 쪽으로 안내되어 있습니다.',
      followUp: ['개인 물품 사용 가능 여부는 병동 상황에 따라 달라질 수 있어 입원 전 병동에 한 번 더 확인해 주세요.', '대표전화 02-6925-1111'],
      sources: [sources[0]],
    };
  }

  if (/전자\s*레인지|전자\s*렌지/u.test(text)) {
    return {
      type: 'inpatient_amenity',
      answer: '입원생활 안내문 기준으로 병동 내 전자레인지는 비치되어 있지 않으며, 원내 취사는 금지되어 있습니다.',
      followUp: ['식사는 조식 8시, 중식 12시, 석식 오후 5시 30분 기준으로 안내됩니다.', '대표전화 02-6925-1111'],
      sources,
    };
  }

  if (/배달\s*음식|배달음식/u.test(text)) {
    return {
      type: 'inpatient_amenity',
      answer: '입원생활 안내문 기준으로 배달음식은 가능하지만, 외부 음식 섭취 후 소화 불편이나 합병증 가능성을 고려해 주의해서 주문해 주세요. 가능 시간은 오전 7시부터 오후 9시까지이며 지하 1층에서 수령하는 방식으로 안내되어 있습니다.',
      followUp: ['수술 직후나 식이 제한이 있는 경우에는 병동에 먼저 확인해 주세요.', '대표전화 02-6925-1111'],
      sources,
    };
  }

  return {
    type: 'inpatient_amenity',
    answer: '병동 비치 물품은 항목에 따라 다릅니다. 가습기, 전자레인지, 배달음식처럼 궁금한 물품이나 이용 항목을 알려주시면 문서 기준으로 안내해 드릴게요.',
    followUp: ['가습기 있어?', '전자레인지 있어?', '배달음식 가능한가요?'],
    sources,
  };
}

function buildReinitializedIntentResponse(intentType, message) {
  switch (intentType) {
    case 'welcome':
      return createWelcomeResponse();
    case 'emergency':
      return {
        type: 'emergency',
        answer: '응급으로 보일 수 있는 상황입니다. 채팅으로 지연하지 마시고 119 또는 가까운 응급실로 바로 이동해 주세요.',
        followUp: ['심한 호흡곤란, 의식 저하, 심한 출혈은 즉시 응급 대응이 필요합니다.', '대표전화 02-6925-1111'],
      };
    case 'restricted':
      return {
        type: 'restricted',
        answer: '이 부분은 상담봇이 판단해 드릴 수 없습니다. 진단, 처방 변경, 약 중단 여부는 의료진과 직접 확인해 주세요.',
        followUp: ['대표전화 02-6925-1111', '증상이 급하면 가까운 응급실 또는 119 이용'],
      };
    case 'personal_info':
      return {
        type: 'privacy_warning',
        answer: '주민등록번호, 전화번호, 주소 같은 개인정보나 민감한 건강정보는 입력하지 말아 주세요.',
        followUp: ['개인정보 없이 증상, 비용, 예약, 진료시간처럼 일반적인 질문만 남겨 주세요.'],
      };
    case 'receipt_issuance':
      return {
        type: 'receipt_issuance',
        answer: '영수증과 진료상세내역 같은 서류는 외래에서는 원무과에서 본인 확인 후 발급받으시면 됩니다. 입원 환자는 퇴원 하루 전 병동에 미리 신청하고, 퇴원 수납 시 원무과에서 받는 방식으로 안내됩니다.',
        followUp: ['퇴원 후에는 외래 방문 시 다시 신청할 수 있습니다.', '대리 발급은 동의서와 신분증 사본 등 추가 서류가 필요할 수 있습니다.', '대표전화 02-6925-1111'],
        sources: [
          buildIntegratedFaqDocSource(),
          buildLocalDocSource('홈페이지-입퇴원 안내', '홈페이지-입퇴원 안내.txt'),
        ],
      };
    case 'same_day_exam_availability':
      return {
        type: 'same_day_exam_availability',
        answer: '대부분 검사는 진료 당일 진행하고 결과까지 확인하는 흐름으로 안내됩니다. 다만 검사 종류와 당일 상황에 따라 예약 검사로 전환될 수 있습니다.',
        followUp: ['귀 검사와 청력·전정기능 검사는 상황에 따라 예약으로 안내될 수 있습니다.', '코골이·수면무호흡 검사는 1박 2일 입원 검사입니다.', '대표전화 02-6925-1111'],
        sources: [buildIntegratedFaqDocSource()],
      };
    case 'admission_prep_items':
      return {
        type: 'admission_prep_items',
        answer: '입원 준비물은 병실 종류에 따라 조금 다릅니다. 1인실은 환자용 세면도구(치약, 칫솔, 비누, 수건, 티슈)가 제공되며, 개인컵, 화장품, 드라이기, 샴푸, 린스 등 개인 물품은 지참하셔야 합니다. 2인실과 4인실은 세면도구와 개인용품(티슈, 수건, 개인컵, 슬리퍼, 화장품, 드라이기, 샴푸, 린스 등)을 모두 챙겨오셔야 합니다.',
        followUp: ['수술 종류나 병실 배정에 따라 추가 준비물이 있을 수 있어 입원 전 안내를 함께 확인해 주세요.', '대표전화 02-6925-1111'],
        sources: [
          buildIntegratedFaqDocSource(),
          buildLocalDocSource('입원-입원생활안내문', '입원-입원생활안내문.txt'),
        ],
      };
    case 'exam_preparation':
      if (/(수면|코골이|수면무호흡|수면다원|수면내시경)/u.test(message)) {
        return {
          type: 'exam_preparation',
          answer: '수면검사는 1박 2일 입원으로 진행됩니다. 기본 침구는 병동에 준비되어 있고, 개인 세면도구 정도 챙기시면 됩니다.',
          followUp: ['금식이나 마취 관련 안내는 검사 전 병원에서 다시 확인해 주세요.', '대표전화 02-6925-1111'],
          sources: [buildIntegratedFaqDocSource()],
        };
      }
      if (/(귀|청력|어지럼|전정)/u.test(message)) {
        return {
          type: 'exam_preparation',
          answer: '귀 검사 전 특별히 챙길 준비물은 없습니다. 검사 시간이 길 수 있어 가능한 한 일찍 내원하시는 편이 좋습니다.',
          followUp: ['청력검사와 전정기능검사는 당일 검사와 결과 상담이 가능하지만 상황에 따라 예약 검사로 전환될 수 있습니다.', '약 복용 중이거나 급성 심한 어지러움이 있으면 검사 시점이 달라질 수 있습니다.'],
          sources: [buildIntegratedFaqDocSource()],
        };
      }
      return {
        type: 'exam_preparation',
        answer: '검사 전 특별한 준비물이 필요한 경우는 많지 않지만, 검사 종류에 따라 예외가 있을 수 있습니다.',
        followUp: ['코 검사인지 귀 검사인지, 수면검사인지 알려주시면 더 정확히 안내해 드릴게요.', '대표전화 02-6925-1111'],
        sources: [buildIntegratedFaqDocSource()],
      };
    case 'medication_stop':
      return {
        type: 'medication_stop',
        answer: '입원 전이나 수술 전에 복용을 중단해야 하는 약은 별도 리스트로 안내됩니다. 복용 중인 약이 있다면 입원 전 복용중단 약물 리스트를 먼저 확인해 주세요.',
        followUp: ['리스트에 없는 약이거나 중단 여부가 애매하면 대표전화 02-6925-1111로 확인해 주세요.'],
        sources: [buildIntegratedFaqDocSource()],
        images: [{
          title: '입원 전 복용 중단 약물 리스트',
          description: '입원 전에 중단이 필요한 약물 안내 이미지입니다.',
          display: 'document',
          url: resolvePublicImagePath('/images/%EC%9E%85%EC%9B%90%EC%A0%84%20%EB%B3%B5%EC%9A%A9%EC%A4%91%EB%8B%A8%20%EC%95%BD%EB%AC%BC%20%EB%A6%AC%EC%8A%A4%ED%8A%B8.jpg'),
        }],
      };
    case 'postop_bleeding':
      return {
        type: 'postop_bleeding',
        answer: '수술 후 출혈이 있으면 우선 안정을 취하고, 소량이면 얼음물 가글을 시도해 보실 수 있습니다. 출혈이 계속되거나 양이 많으면 즉시 병원으로 연락해 주세요.',
        followUp: ['대표전화 02-6925-1111', '즉시 내원이 어렵다면 가까운 이비인후과 응급실 이용을 권장합니다.'],
        sources: [
          buildLocalDocSource('입원-수술 후 주의사항', '입원-수술 후 주의사항.txt'),
          buildLocalDocSource('입원-입원생활안내문', '입원-입원생활안내문.txt'),
        ],
      };
    case 'nasal_irrigation_surgery':
      return {
        type: 'nasal_irrigation_surgery',
        answer: '수술 후 코세척은 보통 수술 후 3일부터, 빠르면 퇴원 당일 저녁부터 시작하도록 안내됩니다. 미지근한 물과 세척 분말을 사용해 천천히 세척해 주세요.',
        followUp: ['세척 후 나온 물은 코를 세게 풀지 말고 닦는 정도로 정리해 주세요.', '불편감이 심하면 외래나 대표전화 02-6925-1111로 확인해 주세요.'],
        sources: [buildLocalDocSource('외래-코세척 방법', '외래-코세척 방법.txt')],
      };
    case 'nasal_irrigation_general':
      return {
        type: 'nasal_irrigation_general',
        answer: '일반 코세척은 생리식염수 또는 세척 분말을 미지근한 물에 풀어 부드럽게 시행하시면 됩니다. 한쪽 코로 넣고 반대쪽으로 자연스럽게 흘러나오게 해 주세요.',
        followUp: ['통증이 있거나 귀가 먹먹하면 세게 하지 말고 중단해 주세요.', '자세한 방법은 외래-코세척 방법 문서를 기준으로 안내됩니다.'],
        sources: [buildLocalDocSource('외래-코세척 방법', '외래-코세척 방법.txt')],
      };
    case 'postop_care':
      return buildCleanPostOpCareResponse(message);
    case 'homepage_surgery_cost':
      return cleanIntentPayload(findHomepageSurgeryCostResponse(message));
    case 'homepage_surgery_info':
      return cleanIntentPayload(findHomepageSurgeryInfoResponse(message));
    case 'surgery_cost':
      return {
        type: 'surgery_cost',
        answer: '수술 비용은 수술 종류, 질환명, 보험 적용 여부에 따라 달라집니다. 질환명을 알려주시면 관련 문서를 기준으로 다시 안내해 드릴게요.',
        followUp: [`비급여 안내 페이지: ${NONPAY_PAGE_URL}`, '대표전화 02-6925-1111'],
        sources: [{ title: '비급여 안내 페이지', url: NONPAY_PAGE_URL }],
      };
    case 'surgery_schedule':
      return {
        type: 'surgery_schedule',
        answer: '수술 시작 시간은 수술 동의와 설명 과정에서 안내되지만, 당일 상황과 환자 상태에 따라 변경될 수 있습니다.',
        followUp: ['정확한 시간은 입원 후 병동 또는 수술 안내 과정에서 다시 확인해 주세요.', '대표전화 02-6925-1111'],
        sources: [buildIntegratedFaqDocSource()],
      };
    case 'surgery_duration':
      return {
        type: 'surgery_duration',
        answer: '수술 소요시간은 수술 종류와 환자 상태에 따라 달라집니다. 수술실 입실 후 준비 시간과 회복실 회복 시간까지 포함하면 실제 체감 시간은 더 길 수 있습니다.',
        followUp: ['코 수술은 국소마취 후 효과를 기다리는 시간이 있어 대기시간이 더 길 수 있습니다.', '정확한 예상 시간은 수술 설명 시 다시 확인해 주세요.'],
        sources: [
          buildIntegratedFaqDocSource(),
          buildLocalDocSource('입원-입원생활안내문', '입원-입원생활안내문.txt'),
        ],
      };
    case 'certificate_fee':
      return buildCleanCertificateFeeResponse(message);
    case 'single_room_fee':
      return buildCleanSingleRoomFeeResponse(message);
    case 'nonpay_item_fee':
      return buildCleanNonpayItemResponse(message);
    case 'hospital_phone':
      return {
        type: 'hospital_phone',
        answer: '하나이비인후과병원 대표전화는 02-6925-1111입니다.',
        followUp: ['예약 변경, 문의, 병동 확인 모두 대표전화로 연결하실 수 있습니다.'],
      };
    case 'late_arrival':
      return {
        type: 'late_arrival',
        answer: '예약 후 늦을 것 같으면 먼저 02-6925-1111로 연락해 주세요. 도착 예정 시간과 외래 대기 상황에 따라 방문 접수 또는 재예약으로 안내될 수 있습니다.',
        followUp: ['1시간 이상 늦는 경우에는 먼저 전화로 확인하는 편이 안전합니다.'],
        sources: [buildIntegratedFaqDocSource()],
      };
    case 'inpatient_amenity':
      return buildCleanInpatientAmenityResponse(message);
    case 'inpatient_meal_policy':
      return {
        type: 'inpatient_meal_policy',
        answer: '입원생활 안내 기준으로 병동 내 취사나 외부 음식 조리는 불가합니다. 배달음식은 가능할 수 있지만, 식사 후 불편이나 합병증 가능성을 고려해 주의가 필요합니다.',
        followUp: ['식사시간은 보통 아침 8시, 점심 12시, 저녁 5시 30분으로 안내됩니다.', '세부 운영은 병동에 다시 확인해 주세요.'],
        sources: [
          buildLocalDocSource('입원-입원생활안내문', '입원-입원생활안내문.txt'),
          buildIntegratedFaqDocSource(),
        ],
      };
    case 'inpatient_outing':
      return {
        type: 'inpatient_outing',
        answer: '입원 중 외출과 외박은 특별한 사유가 없는 한 제한됩니다. 꼭 필요한 경우에는 요청서를 작성하고 주치의 또는 담당 의료진의 승인을 받아야 합니다.',
        followUp: ['승인된 시간 안에 복귀하셔야 합니다.', '무단 외출·외박은 인정되지 않습니다.'],
        sources: [buildIntegratedFaqDocSource()],
      };
    case 'shuttle_bus':
      return {
        type: 'shuttle_bus',
        answer: '셔틀버스는 평일 약 15분 간격으로 운행합니다. 오전은 8시 55분부터 12시 25분까지, 오후는 1시 40분부터 5시 40분까지 안내됩니다.',
        followUp: ['토요일은 약 30분 간격으로 8시 55분부터 12시 55분까지 운행합니다.', '셔틀 승차 위치는 역삼역 1번 출구 인근입니다.'],
        sources: [
          buildLocalDocSource('기타-병원셔틀시간표', '기타-병원셔틀시간표.txt'),
          buildLocalDocSource('홈페이지-셔틀버스 및 오시는길', '홈페이지-셔틀버스 및 오시는길.txt'),
        ],
      };
    case 'discharge_procedure':
      return {
        type: 'discharge_procedure',
        answer: '퇴원은 보통 퇴원 안내, 진료비 수납, 서류 수령 순서로 진행됩니다. 퇴원 당일에는 수술 부위 확인과 주의사항 설명이 함께 진행될 수 있습니다.',
        followUp: ['서류가 필요하면 병동에 미리 말씀해 주세요.', '수납 후 다음 외래 일정이 안내될 수 있습니다.'],
        sources: [buildLocalDocSource('홈페이지-입퇴원 안내', '홈페이지-입퇴원 안내.txt')],
      };
    case 'rhinitis_postop_visit':
      return {
        type: 'rhinitis_postop_visit',
        answer: '비염 수술 후 내원 치료는 문서 기준으로 보통 8회에서 12회 정도 안내됩니다. 회복 기간은 보통 3주에서 4주 정도로 안내됩니다.',
        followUp: ['정확한 내원 횟수는 수술 범위와 회복 상태에 따라 달라질 수 있습니다.', '대표전화 02-6925-1111'],
        sources: [buildLocalDocSource('홈페이지-만성비염', '홈페이지-만성비염.txt')],
      };
    case 'guardian_shift':
      return {
        type: 'guardian_shift',
        answer: '간호간병통합서비스 병동 운영 기준으로 보호자 상주나 잦은 교대는 제한될 수 있습니다. 꼭 필요한 경우에는 병동 또는 의료진 판단 아래 일시적으로 안내될 수 있습니다.',
        followUp: ['세부 운영은 병동에 먼저 확인해 주세요.', '대표전화 02-6925-1111'],
        sources: [
          buildLocalDocSource('입원-입원생활안내문', '입원-입원생활안내문.txt'),
          buildIntegratedFaqDocSource(),
        ],
      };
    case 'guardian_visit':
      return buildGuardianVisitResponse(message);
    case 'wifi_info':
      return {
        type: 'wifi_info',
        answer: '병동 와이파이는 HANA_ENT_병동2 또는 HANA_ENT_병동5를 이용하시면 되고, 비밀번호는 0269251111입니다.',
        followUp: ['층별 운영에 따라 접속명이 다를 수 있어 병동 안내를 함께 확인해 주세요.'],
        sources: [buildLocalDocSource('입원-입원생활안내문', '입원-입원생활안내문.txt')],
      };
    case 'complaint_guide':
      return {
        type: 'complaint_guide',
        answer: '불편사항이나 건의사항은 병동 안내문, 고객의 소리 창구, 또는 대표전화 02-6925-1111을 통해 접수하실 수 있습니다.',
        followUp: ['입원 중이면 병동 간호사실에 먼저 말씀해 주셔도 됩니다.'],
      };
    case 'floor_guide':
      return cleanIntentPayload(findFloorGuideResponse(message));
    case 'doctor_specialty':
      return buildCleanDoctorSpecialtyResponse(message);
    case 'doctor_overview':
      return cleanIntentPayload(findDoctorOverviewResponse(message) || buildDynamicDoctorOverviewResponse());
    case 'reservation_or_reception':
      return {
        type: 'reservation_or_reception',
        answer: '예약은 온라인 예약, 전화 예약, 방문 예약으로 가능합니다. 처음 내원하시는 경우에는 신분증을 지참하고 1층 접수 데스크에서 등록 후 진료실로 안내됩니다.',
        followUp: ['예약 변경은 대표전화 02-6925-1111로 문의해 주세요.', '온라인 예약은 병원 홈페이지에서 요청 후 상담 확인 절차로 진행됩니다.'],
        sources: [
          buildIntegratedFaqDocSource(),
          buildLocalDocSource('홈페이지-외래진료안내', '홈페이지-외래진료안내.txt'),
        ],
      };
    default:
      return null;
  }
}

function resolveIntentResponse(intentType, message) {
  const rebuiltResponse = buildReinitializedIntentResponse(intentType, message);
  if (rebuiltResponse) {
    return rebuiltResponse;
  }

  return null;
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

  return `${lastUserMessage}\n후속 질문: ${current}`;
}

function extractDoctorName(text) {
  const value = String(text || '');
  if (!value) {
    return '';
  }

  const fallbackDoctorName = DOCTOR_NAME_FALLBACK_LIST.find((name) => value.includes(name));
  if (fallbackDoctorName) {
    return fallbackDoctorName;
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

  return `${anchor}\n후속 질문: ${current}`;
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
      '문서에 없는 내용은 추측하지 말고 확인이 필요하다고 답하세요.',
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
        '병원 공식 홈페이지와 FAQ 문서에 있는 내용만 근거로 자연스럽고 간결하게 답하세요.',
        '공식 홈페이지와 FAQ를 최우선 근거로 사용하고 external 자료는 보조 참고로만 사용하세요.',
        '서로 충돌하면 official > external > low_trust 순서로 우선합니다.',
        '금지: 진단, 응급 최종판단, 처방 변경, 약 복용 지시, 추측성 의료정보.',
        '답변은 3~5문장으로 하고 필요한 경우 마지막 문장에 대표전화 02-6925-1111을 안내하세요.',
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
  const raw = String(message || '').trim().toLowerCase();
  if (/^(ㅎㅇ|ㅎㅇ요|하이|hi|hello)$/iu.test(raw)) {
    return 'greeting';
  }

  const normalized = normalizeSearchTextSafe(message);
  const compact = compactSearchTextSafe(message);

  if (!normalized) {
    return null;
  }

  if (
    ['안녕하세요', '안녕', 'ㅎㅇ', '하이', '반가워요', '반갑습니다', '처음 왔어요'].includes(normalized)
    || compact === '안녕하세요'
    || compact === '안녕'
    || compact === 'ㅎㅇ'
    || compact === '하이'
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
      '문서에 있는 사실은 질문 의도에 맞게 정리해서 설명해 주세요.',
      '문서에 없는 병원 운영 정보는 추측하지 말고 확인이 필요하다고 안내해 주세요.',
      '질문 의도를 이해하는 데 필요한 경우 1~2문장 정도 부드럽게 맥락을 설명해도 됩니다.',
      '답변 언어는 사용자의 마지막 질문 언어를 그대로 따르세요. 한국어 질문에는 한국어로, 영어 질문에는 영어로 답하세요.',
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
          '답변은 챗봇 템플릿보다 실제 상담원에 가깝게, 친절하고 자연스럽게 작성하세요.',
          '병원 운영 정보는 제공된 문서를 최우선 근거로 사용하세요.',
          'local 문서와 FAQ를 가장 우선하고, official 홈페이지 문서를 그 다음 근거로 사용하세요. external 자료는 보조 참고로만 사용하세요.',
          '문서에 없는 병원 정보는 추측하지 말고 확인이 필요하다고 안내하세요.',
          '문서에 있는 사실을 그대로 반복만 하지 말고, 질문 의도에 맞게 정리해서 설명하세요.',
          '첫 문장은 사용자가 물은 핵심에 바로 답하세요. 불필요한 인사말이나 "문의하신 내용" 같은 일반 선문구로 시작하지 마세요.',
          '관련 문서가 여러 개일 때는 가장 직접적으로 맞는 문서의 사실을 먼저 쓰고, 보조 문서는 필요한 경우에만 덧붙이세요.',
          '안전한 범위에서는 이유, 절차, 준비사항, 주의사항 같은 맥락 설명을 1~2문장 추가해도 됩니다.',
          '단순 인사, 감사, 재질문 연결 문장은 문서 인용 없이 자연스럽게 답해도 됩니다.',
          '답변 언어는 사용자의 마지막 질문 언어를 그대로 따르세요.',
          '금지: 진단, 응급 최종판단, 처방 변경, 약 복용 지시 같은 의료 판단.',
          '답변은 보통 3~6문장으로 하되, 필요한 핵심을 먼저 말하세요.',
          '대표전화 02-6925-1111 안내는 확인이 필요한 경우에만 붙이세요.',
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
          'Mark valid=false if the answer shifts to a different topic, answers the wrong question, or adds specific hospital facts not supported by the documents.',
          'Natural paraphrasing, polite framing, and brief explanatory wording are allowed when the core facts remain supported.',
          'Be strict about topic mismatch, but do not reject answers only because they sound conversational.',
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
  const rawIntent = classifyUserIntent(buildIntentProbeMessage(message));
  const meaningIntent = classifyIntentMeaning(message);

  if (!message) {
    return enrichResponsePayload(createWelcomeResponse(), message);
  }

  const meaningIntentResponse = resolveMeaningIntentResponse(meaningIntent, message, sessionId);
  if (meaningIntentResponse) {
    return enrichResponsePayload(meaningIntentResponse, message);
  }

  const directRepresentativeNonpayResponse = buildRepresentativeNonpayResponse(message);
  if (directRepresentativeNonpayResponse) {
    return enrichResponsePayload(directRepresentativeNonpayResponse, message);
  }

  const directMounjaroFeeResponse = buildMounjaroFeeResponse(message);
  if (directMounjaroFeeResponse) {
    return enrichResponsePayload(directMounjaroFeeResponse, message);
  }

  const directRhinoplastyConsultResponse = buildRhinoplastyConsultResponse(message);
  if (directRhinoplastyConsultResponse) {
    return enrichResponsePayload(directRhinoplastyConsultResponse, message);
  }

  const directSmokingPolicyResponse = buildSmokingPolicyResponse(message);
  if (directSmokingPolicyResponse) {
    return enrichResponsePayload(directSmokingPolicyResponse, message);
  }

  const directTonsilPostopBleedingResponse = buildTonsilPostopBleedingResponse(message);
  if (directTonsilPostopBleedingResponse) {
    return enrichResponsePayload(directTonsilPostopBleedingResponse, message);
  }

  const directPaymentMethodResponse = buildPaymentMethodResponse(message);
  if (directPaymentMethodResponse) {
    return enrichResponsePayload(directPaymentMethodResponse, message);
  }

  const directFirstReturnVisitResponse = buildFirstReturnVisitResponse(message);
  if (directFirstReturnVisitResponse) {
    return enrichResponsePayload(directFirstReturnVisitResponse, message);
  }

  const directReferralDocumentResponse = buildReferralDocumentResponse(message);
  if (directReferralDocumentResponse) {
    return enrichResponsePayload(directReferralDocumentResponse, message);
  }

  const directDoctorScheduleImageResponse = buildDoctorScheduleImageResponse(message);
  if (directDoctorScheduleImageResponse) {
    return enrichResponsePayload(directDoctorScheduleImageResponse, message);
  }

  const directRoomFeeResponse = buildRoomFeeResponse(message);
  if (directRoomFeeResponse) {
    return enrichResponsePayload(directRoomFeeResponse, message);
  }

  const directEarFullnessHearingLossResponse = buildEarFullnessHearingLossResponse(message);
  if (directEarFullnessHearingLossResponse) {
    return enrichResponsePayload(directEarFullnessHearingLossResponse, message);
  }

  const directCenterDoctorListResponse = buildCenterDoctorListResponse(message);
  if (directCenterDoctorListResponse) {
    return enrichResponsePayload(directCenterDoctorListResponse, message);
  }

  const directSinusitisCareResponse = buildSinusitisCareResponse(message);
  if (directSinusitisCareResponse) {
    return enrichResponsePayload(directSinusitisCareResponse, message);
  }

  const directThroatMassCareResponse = buildThroatMassCareResponse(message);
  if (directThroatMassCareResponse) {
    return enrichResponsePayload(directThroatMassCareResponse, message);
  }

  const directSymptomVisitGuidanceResponse = buildSymptomVisitGuidanceResponse(message);
  if (directSymptomVisitGuidanceResponse) {
    return enrichResponsePayload(directSymptomVisitGuidanceResponse, message);
  }

  const directWaitingTimeResponse = buildWaitingTimeResponse(message);
  if (directWaitingTimeResponse) {
    return enrichResponsePayload(directWaitingTimeResponse, message);
  }

  const directDischargeTimeResponse = buildDischargeTimeResponse(message);
  if (directDischargeTimeResponse) {
    return enrichResponsePayload(directDischargeTimeResponse, message);
  }

  const directFacilityLocationResponse = buildFacilityLocationResponse(message);
  if (directFacilityLocationResponse) {
    return enrichResponsePayload(directFacilityLocationResponse, message);
  }

  const directAccessibilityResponse = buildAccessibilityResponse(message);
  if (directAccessibilityResponse) {
    return enrichResponsePayload(directAccessibilityResponse, message);
  }

  const directHospitalLocationResponse = buildHospitalLocationResponse(message);
  if (directHospitalLocationResponse) {
    return enrichResponsePayload(directHospitalLocationResponse, message);
  }

  const directClinicHoursNightWeekendResponse = buildClinicHoursNightWeekendResponse(message);
  if (directClinicHoursNightWeekendResponse) {
    return enrichResponsePayload(directClinicHoursNightWeekendResponse, message);
  }

  const directResultNotificationResponse = buildResultNotificationResponse(message);
  if (directResultNotificationResponse) {
    return enrichResponsePayload(directResultNotificationResponse, message);
  }

  const directMedicalRecordCopyResponse = buildMedicalRecordCopyResponse(message);
  if (directMedicalRecordCopyResponse) {
    return enrichResponsePayload(directMedicalRecordCopyResponse, message);
  }

  const directInfectionPreventionResponse = buildInfectionPreventionResponse(message);
  if (directInfectionPreventionResponse) {
    return enrichResponsePayload(directInfectionPreventionResponse, message);
  }

  const directAdditionalConsultationResponse = buildAdditionalConsultationResponse(message);
  if (directAdditionalConsultationResponse) {
    return enrichResponsePayload(directAdditionalConsultationResponse, message);
  }

  const directHearingTestResponse = buildHearingTestProcessResponse(message);
  if (directHearingTestResponse) {
    return enrichResponsePayload(directHearingTestResponse, message);
  }

  const directTonsillectomyResponse = buildTonsillectomyInfoResponse(message);
  if (directTonsillectomyResponse) {
    return enrichResponsePayload(directTonsillectomyResponse, message);
  }

  const directRhinitisExamResponse = buildRhinitisExamResponse(message);
  if (directRhinitisExamResponse) {
    return enrichResponsePayload(directRhinitisExamResponse, message);
  }

  const directExamTypeClarificationResponse = buildExamTypeClarificationResponse(message);
  if (directExamTypeClarificationResponse) {
    return enrichResponsePayload(directExamTypeClarificationResponse, message);
  }

  const directDoctorCareerResponse = buildDoctorCareerResponse(message);
  if (directDoctorCareerResponse) {
    return enrichResponsePayload(directDoctorCareerResponse, message);
  }

  const directDoctorSpecialtyResponse = buildCleanDoctorSpecialtyResponse(message);
  if (directDoctorSpecialtyResponse) {
    return enrichResponsePayload(directDoctorSpecialtyResponse, message);
  }

  const directDoctorOverviewResponse = findDoctorOverviewResponse(message);
  if (directDoctorOverviewResponse) {
    return enrichResponsePayload(directDoctorOverviewResponse, message);
  }

  const directParkingResponse = buildParkingInfoResponse(message);
  if (directParkingResponse) {
    return enrichResponsePayload(directParkingResponse, message);
  }

  const directNasalIrrigationMode = getNasalIrrigationMode(message);
  if (directNasalIrrigationMode === 'surgery' || directNasalIrrigationMode === 'general') {
    clearConversationState(sessionId);
    return enrichResponsePayload(createNasalIrrigationResponse(directNasalIrrigationMode), message);
  }
  if (directNasalIrrigationMode === 'ambiguous') {
    setConversationState(sessionId, {
      topic: 'nasal_irrigation',
      originalMessage: message,
    });
    return enrichResponsePayload(createNasalIrrigationClarificationResponse(), message);
  }

  const looseTopicResponse = findLooseTopicResponse(message);
  if (looseTopicResponse) {
    return enrichResponsePayload(looseTopicResponse, message);
  }

  const directIntegratedFaqResponse = findIntegratedFaqCardResponse(message);
  if (directIntegratedFaqResponse) {
    return enrichResponsePayload(directIntegratedFaqResponse, message);
  }

  if (/(예약|접수)/u.test(message) && rawIntent.type === 'reservation_or_reception') {
    return enrichResponsePayload(buildReinitializedIntentResponse('reservation_or_reception', message), message);
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

  const preRetrievalParkingResponse = buildParkingInfoResponse(intentProbeMessage);
  if (preRetrievalParkingResponse) {
    return enrichResponsePayload(preRetrievalParkingResponse, message);
  }

  const preRetrievalNasalIrrigationMode = getNasalIrrigationMode(intentProbeMessage);
  if (preRetrievalNasalIrrigationMode === 'surgery' || preRetrievalNasalIrrigationMode === 'general') {
    clearConversationState(sessionId);
    return enrichResponsePayload(createNasalIrrigationResponse(preRetrievalNasalIrrigationMode), message);
  }
  if (preRetrievalNasalIrrigationMode === 'ambiguous') {
    setConversationState(sessionId, {
      topic: 'nasal_irrigation',
      originalMessage: message,
    });
    return enrichResponsePayload(createNasalIrrigationClarificationResponse(), message);
  }

  const preRetrievalLooseTopicResponse = findLooseTopicResponse(intentProbeMessage);
  if (preRetrievalLooseTopicResponse) {
    return enrichResponsePayload(preRetrievalLooseTopicResponse, message);
  }

  const preRetrievalIntegratedFaqResponse = findIntegratedFaqCardResponse(intentProbeMessage);
  if (preRetrievalIntegratedFaqResponse) {
    return enrichResponsePayload(preRetrievalIntegratedFaqResponse, message);
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

  const parkingResponse = buildParkingInfoResponse(retrievalMessage);
  if (parkingResponse) {
    return enrichResponsePayload(parkingResponse, message);
  }

  const retrievalNasalIrrigationMode = getNasalIrrigationMode(retrievalMessage);
  if (retrievalNasalIrrigationMode === 'surgery' || retrievalNasalIrrigationMode === 'general') {
    clearConversationState(sessionId);
    return enrichResponsePayload(createNasalIrrigationResponse(retrievalNasalIrrigationMode), message);
  }
  if (retrievalNasalIrrigationMode === 'ambiguous') {
    setConversationState(sessionId, {
      topic: 'nasal_irrigation',
      originalMessage: message,
    });
    return enrichResponsePayload(createNasalIrrigationClarificationResponse(), message);
  }

  const retrievalLooseTopicResponse = findLooseTopicResponse(retrievalMessage);
  if (retrievalLooseTopicResponse) {
    return enrichResponsePayload(retrievalLooseTopicResponse, message);
  }

  const integratedFaqResponse = findIntegratedFaqCardResponse(retrievalMessage);
  if (integratedFaqResponse) {
    const enrichedIntegratedFaqResponse = enrichResponsePayload(integratedFaqResponse, message);
    setCachedResponse(retrievalMessage, enrichedIntegratedFaqResponse);
    return enrichedIntegratedFaqResponse;
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
    const reliableDirectFaqResponse = isReliableDirectFaqResponse(directFaqResponse);
    if (reliableDirectFaqResponse && shouldPreferGenerativeDocAnswer(retrievalMessage, directFaqResponse)) {
      // Let document-grounded AI answer broader or more conversational questions
      // so responses feel less templated while keeping source-backed safety.
    } else if (!reliableDirectFaqResponse) {
      return enrichResponsePayload(createConsultationClarificationResponse(retrievalMessage), message);
    } else {
      const simplifiedFaqResponse = {
        ...directFaqResponse,
        answer: applyPatientFriendlyTemplate(directFaqResponse.answer, effectiveMessage),
        followUp: (directFaqResponse.followUp || []).map((item) => applyPatientFriendlyTemplate(item, message)),
        images: findRelevantImages(message),
      };
      const enrichedFaqResponse = enrichResponsePayload(simplifiedFaqResponse, message);
      setCachedResponse(retrievalMessage, enrichedFaqResponse);
      return enrichedFaqResponse;
    }
  }

  const operationalInferenceResponse = findOperationalInferenceResponse(retrievalMessage);
  if (operationalInferenceResponse) {
    return enrichResponsePayload(operationalInferenceResponse, message);
  }

  if (!OPENAI_API_KEY) {
    return enrichResponsePayload(createFallbackResponse(retrievalMessage, []), message);
  }

  const docs = await getDocumentsForRequest();
  const keywordContextDocs = rankDocuments(retrievalMessage, docs);
  const semanticContextDocs = semanticSearchService
    ? await semanticSearchService.search(retrievalMessage, 5)
    : [];
  const contextDocs = mergeSemanticAndKeywordDocuments(semanticContextDocs, keywordContextDocs);

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

async function handleApiChat(req, res) {
  try {
      const parsed = await readJsonRequestBody(req);
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
      const response = sanitizeOutgoingPayload(await buildChatResponse(parsed.message, parsed.sessionId));
      recordSessionTurn(parsed.sessionId, parsed.message, response.answer);
      appendChatLog({
        id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        timestamp: new Date().toISOString(),
        sessionId: parsed.sessionId || '',
        question: repairBrokenKoreanText(String(parsed.message || '').trim()),
        answer: response.answer || '',
        followUp: response.followUp || [],
        answerFull: [
          response.answer || '',
          ...((response.followUp || []).map((item) => `- ${item}`)),
        ].filter(Boolean).join('\n'),
        type: response.type || 'unknown',
        sources: response.sources || [],
        flag: '',
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
}

async function handleApiAdminLogFlag(req, res) {
  try {
      const parsed = await readJsonRequestBody(req);
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
}

function handleApiAdminLogsExport(req, res, requestUrl) {
  const exportFlag = String(requestUrl.searchParams.get('flag') || '').trim();
  const isNormalExport = exportFlag === 'normal';
  const items = isNormalExport
    ? buildSeedQuestionExportRows(requestUrl.searchParams)
    : buildWrongAnswerExportRows(requestUrl.searchParams);
  const fileName = isNormalExport ? 'seed-questions.json' : 'wrong-answers.json';
  const payload = JSON.stringify(items, null, 2);

  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Disposition': `attachment; filename="${fileName}"`,
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

function handleApiAdminLogsExportSave(req, res, requestUrl) {
  try {
    const exportFlag = String(requestUrl.searchParams.get('flag') || '').trim();
    sendJson(res, 200, exportFlag === 'normal'
      ? saveSeedQuestionEvalRows(requestUrl.searchParams)
      : saveWrongAnswerEvalRows(requestUrl.searchParams));
  } catch (error) {
    console.error('[eval-export-save-error]', error);
    sendJson(res, 500, {
      ok: false,
      error: error.message,
    });
  }
}

async function handleApiAdminSessionNote(req, res) {
  try {
      const parsed = await readJsonRequestBody(req);
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

async function handleApiAdminLogin(req, res) {
  try {
      const parsed = await readJsonRequestBody(req);
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

  if (req.method === 'POST' && pathname === '/api/admin/logs/export/save') {
    handleApiAdminLogsExportSave(req, res, requestUrl);
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

  if (req.method === 'GET' && pathname === '/api/admin/eval-status') {
    sendJson(res, 200, getAdminEvalStatus());
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

