const crypto = require('crypto');

const DEFAULT_EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL || 'text-embedding-3-small';
const DEFAULT_RESULT_LIMIT = 5;
const MAX_TEXT_LENGTH = 1600;
const MIN_TEXT_LENGTH = 20;

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function compactKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncateText(value, limit = MAX_TEXT_LENGTH) {
  const text = normalizeText(value);
  return text.length > limit ? `${text.slice(0, limit).trim()}...` : text;
}

function buildContentWithLabels({ title, filename, heading, text }) {
  return [
    title ? `문서 제목: ${title}` : '',
    filename ? `파일명: ${filename}` : '',
    heading ? `항목: ${heading}` : '',
    '',
    text,
  ].filter((line) => line !== '').join('\n');
}

function inferFilenameFromUrl(url) {
  const value = String(url || '');
  if (!value.startsWith('local://docs/')) {
    return '';
  }

  try {
    return decodeURIComponent(value.replace('local://docs/', '')).split(' #')[0];
  } catch (error) {
    return value.replace('local://docs/', '').split(' #')[0];
  }
}

function createStableId(parts) {
  return crypto
    .createHash('sha1')
    .update(parts.filter(Boolean).join('\n'))
    .digest('hex');
}

function addUniqueChunk(chunks, seen, chunk) {
  const text = normalizeText(chunk.text);
  if (text.length < MIN_TEXT_LENGTH) {
    return;
  }

  const id = createStableId([chunk.sourceType, chunk.title, chunk.filename, chunk.heading, text]);
  if (seen.has(id)) {
    return;
  }

  seen.add(id);
  const pageContent = buildContentWithLabels({
    title: chunk.title,
    filename: chunk.filename,
    heading: chunk.heading,
    text: truncateText(text),
  });

  chunks.push({
    pageContent,
    metadata: {
      id,
      title: chunk.title || chunk.filename || '문서',
      sourceTitle: chunk.sourceTitle || chunk.title || chunk.filename || '문서',
      filename: chunk.filename || '',
      heading: chunk.heading || '',
      url: chunk.url || '',
      sourceType: chunk.sourceType || 'local',
      keywords: Array.isArray(chunk.keywords) ? chunk.keywords : [],
      originalText: text,
    },
  });
}

function buildFaqEntryChunks(faqEntries, chunks, seen) {
  (faqEntries || []).forEach((entry) => {
    const category = String(entry?.category || '').trim();
    const answer = normalizeText(entry?.answer);
    const followUp = Array.isArray(entry?.followUp) ? entry.followUp.map(normalizeText).filter(Boolean) : [];
    const keywords = Array.isArray(entry?.keywords) ? entry.keywords : [];
    const heading = keywords[0] || category || 'FAQ';
    const text = [answer, ...followUp].filter(Boolean).join('\n');

    addUniqueChunk(chunks, seen, {
      title: `FAQ - ${category || heading}`,
      filename: 'data/faq.json + data/faq-extended.json',
      heading,
      text,
      url: entry?.url || '',
      sourceType: 'faq',
      keywords,
    });
  });
}

function buildIntegratedFaqChunks(cards, chunks, seen) {
  (cards || []).forEach((card) => {
    const question = normalizeText(card?.question);
    const answer = normalizeText(card?.answer);
    const aliases = Array.isArray(card?.aliases) ? card.aliases.map(normalizeText).filter(Boolean) : [];
    const text = [
      question ? `대표 질문: ${question}` : '',
      aliases.length > 1 ? `비슷한 질문: ${aliases.slice(1).join(' / ')}` : '',
      answer,
    ].filter(Boolean).join('\n');

    addUniqueChunk(chunks, seen, {
      title: '통합-FAQ',
      filename: '통합-FAQ.txt',
      heading: question || 'FAQ',
      text,
      url: 'local://docs/%ED%86%B5%ED%95%A9-FAQ.txt',
      sourceType: 'local',
      keywords: aliases,
    });
  });
}

function buildLocalDocumentChunks(localDocuments, chunks, seen) {
  (localDocuments || []).forEach((doc) => {
    const title = normalizeText(doc?.sourceTitle || doc?.title || '로컬 문서');
    const filename = inferFilenameFromUrl(doc?.url) || normalizeText(doc?.chunkLabel || title);
    const heading = normalizeText(doc?.chunkLabel || title).replace(/\s+#\d+$/u, '');

    addUniqueChunk(chunks, seen, {
      title,
      sourceTitle: doc?.sourceTitle || title,
      filename,
      heading,
      text: doc?.text,
      url: doc?.url,
      sourceType: doc?.sourceType || 'local',
      keywords: doc?.keywords || [],
    });
  });
}

function buildImageGuideChunks(imageGuides, chunks, seen) {
  (imageGuides || []).forEach((guide) => {
    const title = normalizeText(guide?.title || guide?.display || '이미지 안내');
    const description = normalizeText(guide?.description || '');
    const pathValue = String(guide?.path || guide?.url || '');
    const cleanAliases = [];

    if (pathValue.includes('%EC%9E%85%EC%9B%90%EC%A0%84%20%EB%B3%B5%EC%9A%A9%EC%A4%91%EB%8B%A8')) {
      cleanAliases.push(
        '입원 전 복용 중단 약물 리스트',
        '입원 전 중단 약물',
        '수술 전 중단 약물',
        '수술 전에 먹으면 안 되는 약',
        '수술 전 먹으면 안 되는 약',
        '복용하면 안 되는 약',
        '아스피린',
        '항응고제',
        '항혈소판제',
        '금지 약물'
      );
    }

    if (pathValue.includes('%EC%85%94%ED%8B%80%EB%B2%84%EC%8A%A4')) {
      cleanAliases.push('셔틀버스 시간표', '셔틀 시간', '버스 시간', '역삼역 셔틀');
    }

    if (pathValue.includes('%EC%A7%84%EB%A3%8C%EC%9D%BC%EC%A0%95')) {
      cleanAliases.push('진료일정 안내', '의료진 일정', '진료시간', '원장님 일정');
    }

    const keywords = [
      title,
      description,
      ...cleanAliases,
      ...(Array.isArray(guide?.keywords) ? guide.keywords : []),
      ...(Array.isArray(guide?.patterns) ? guide.patterns : []),
      ...(Array.isArray(guide?.docHints) ? guide.docHints : []),
    ].map(normalizeText).filter(Boolean);
    const text = [
      `안내 제목: ${title}`,
      description ? `설명: ${description}` : '',
      keywords.length > 0 ? `비슷한 질문 표현: ${keywords.join(' / ')}` : '',
      guide?.path ? `이미지 경로: ${guide.path}` : '',
    ].filter(Boolean).join('\n');

    addUniqueChunk(chunks, seen, {
      title,
      filename: 'data/image-guides.json',
      heading: title,
      text,
      url: guide?.path || guide?.url || '',
      sourceType: 'local',
      keywords,
    });
  });
}

function buildSemanticDocuments(sources) {
  const chunks = [];
  const seen = new Set();

  buildIntegratedFaqChunks(sources.integratedFaqCards, chunks, seen);
  buildFaqEntryChunks(sources.faqEntries, chunks, seen);
  buildLocalDocumentChunks(sources.localDocuments, chunks, seen);
  buildImageGuideChunks(sources.imageGuides, chunks, seen);

  return chunks;
}

function toRuntimeDoc(result, score) {
  const metadata = result.metadata || {};
  return {
    title: metadata.title || '의미 검색 문서',
    sourceTitle: metadata.sourceTitle || metadata.title || '의미 검색 문서',
    url: metadata.url || '',
    text: metadata.originalText || result.pageContent || '',
    keywords: metadata.keywords || [],
    sourceType: metadata.sourceType || 'local',
    semanticScore: score,
    semanticId: metadata.id,
    chunkLabel: metadata.heading || metadata.filename || '',
  };
}

function createSemanticSearchService(options = {}) {
  const apiKey = options.apiKey || process.env.OPENAI_API_KEY || '';
  const getSources = typeof options.getSources === 'function' ? options.getSources : () => ({});
  const embeddingModel = options.embeddingModel || DEFAULT_EMBEDDING_MODEL;
  let vectorStore = null;
  let initPromise = null;
  let documentCount = 0;
  let lastError = null;

  async function createVectorStore() {
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is required for semantic search');
    }

    const [{ MemoryVectorStore }, { OpenAIEmbeddings }] = await Promise.all([
      import('@langchain/classic/vectorstores/memory'),
      import('@langchain/openai'),
    ]);
    const documents = buildSemanticDocuments(getSources());

    if (documents.length === 0) {
      throw new Error('No semantic search documents available');
    }

    const embeddings = new OpenAIEmbeddings({
      apiKey,
      model: embeddingModel,
    });

    const store = await MemoryVectorStore.fromDocuments(documents, embeddings);
    documentCount = documents.length;
    return store;
  }

  async function ensureVectorStore() {
    if (vectorStore) {
      return vectorStore;
    }

    if (!initPromise) {
      initPromise = createVectorStore()
        .then((store) => {
          vectorStore = store;
          lastError = null;
          return store;
        })
        .catch((error) => {
          lastError = error;
          throw error;
        })
        .finally(() => {
          initPromise = null;
        });
    }

    return initPromise;
  }

  return {
    async search(query, limit = DEFAULT_RESULT_LIMIT) {
      const value = normalizeText(query);
      if (!apiKey || !value) {
        return [];
      }

      try {
        const store = await ensureVectorStore();
        const results = await store.similaritySearchWithScore(value, limit);
        return results.map(([doc, score]) => toRuntimeDoc(doc, score));
      } catch (error) {
        lastError = error;
        console.error('[semantic-search-error]', error.message);
        return [];
      }
    },
    invalidate(reason = 'runtime data changed') {
      vectorStore = null;
      initPromise = null;
      documentCount = 0;
      console.log(`[semantic-search] invalidated: ${reason}`);
    },
    getStatus() {
      return {
        enabled: Boolean(apiKey),
        ready: Boolean(vectorStore),
        documentCount,
        embeddingModel,
        lastError: lastError ? lastError.message : '',
      };
    },
    buildSemanticDocumentsForTest: () => buildSemanticDocuments(getSources()),
  };
}

module.exports = {
  createSemanticSearchService,
  buildSemanticDocuments,
};
