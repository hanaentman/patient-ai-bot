const chat = document.getElementById('chat');
const form = document.getElementById('chat-form');
const input = document.getElementById('message-input');
const quickActions = document.querySelector('.quick-actions');
const chips = document.querySelectorAll('.chip');
const sessionId = `session-${crypto.randomUUID()}`;

let pendingMessageElement = null;
let imageViewerElement = null;
const fallbackQuickActions = [
  { label: '진료시간', question: '진료시간 알려줘' },
  { label: '셔틀버스', question: '셔틀버스시간 알려줘' },
  { label: '입원전 약물', question: '입원전 금지 약물 알려줘' },
  { label: '병원 진료시간', question: '진료시간 안내해줘' },
  { label: '예약 변경', question: '예약 변경 방법 알려줘' },
  { label: '코골이 상담', question: '코골이 진료 과를 알려줘' },
];

function isValidExternalUrl(value) {
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function splitMessageParagraphs(role, text) {
  const normalized = String(text || '')
    .replace(/\r/g, '\n')
    .trim();

  if (!normalized) {
    return [];
  }

  if (role !== 'bot') {
    return [normalized];
  }

  if (normalized.includes('\n')) {
    return normalized
      .split(/\n+/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean);
  }

  return normalized
    .split(/(?<=[.!?]|니다|세요)\s+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function appendRichText(container, text) {
  const value = String(text || '');
  const pattern = /(https?:\/\/[^\s]+)|(02-6925-1111)/g;
  let lastIndex = 0;
  let match = pattern.exec(value);

  while (match) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
    }

    const token = match[0];
    const link = document.createElement('a');

    if (token === '02-6925-1111') {
      link.href = `tel:${token}`;
      link.textContent = token;
    } else {
      link.href = token;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = token;
    }

    container.appendChild(link);
    lastIndex = pattern.lastIndex;
    match = pattern.exec(value);
  }

  if (lastIndex < value.length) {
    container.appendChild(document.createTextNode(value.slice(lastIndex)));
  }
}

function getChipElements() {
  return quickActions ? Array.from(quickActions.querySelectorAll('.chip')) : [];
}

function renderQuickActions(items) {
  if (!quickActions) {
    return;
  }

  const normalizedItems = Array.isArray(items) && items.length > 0
    ? items
    : fallbackQuickActions;
  const chipElements = Array.from(chips);

  chipElements.forEach((button, index) => {
    const item = normalizedItems[index] || fallbackQuickActions[index];
    if (!item) {
      button.hidden = true;
      return;
    }

    button.hidden = false;
    button.dataset.question = item.question;
    button.textContent = item.label || item.question;
  });
}

async function loadPopularQuestions() {
  try {
    const response = await fetch('/api/popular-questions');
    if (!response.ok) {
      renderQuickActions(fallbackQuickActions);
      return;
    }

    const data = await response.json();
    renderQuickActions(data.items);
  } catch (error) {
    renderQuickActions(fallbackQuickActions);
  }
}

function ensureImageViewer() {
  if (imageViewerElement) {
    return imageViewerElement;
  }

  const overlay = document.createElement('div');
  overlay.className = 'image-viewer hidden';
  overlay.innerHTML = `
    <div class="image-viewer-backdrop"></div>
    <div class="image-viewer-dialog" role="dialog" aria-modal="true" aria-label="이미지 크게 보기">
      <button type="button" class="image-viewer-close" aria-label="닫기">×</button>
      <img class="image-viewer-image" alt="" />
      <div class="image-viewer-caption"></div>
    </div>
  `;

  const closeViewer = () => {
    overlay.classList.add('hidden');
    document.body.classList.remove('viewer-open');
  };

  overlay.querySelector('.image-viewer-backdrop').addEventListener('click', closeViewer);
  overlay.querySelector('.image-viewer-close').addEventListener('click', closeViewer);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) {
      closeViewer();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && imageViewerElement && !imageViewerElement.classList.contains('hidden')) {
      closeViewer();
    }
  });

  document.body.appendChild(overlay);
  imageViewerElement = overlay;
  return overlay;
}

function openImageViewer(image) {
  const viewer = ensureImageViewer();
  const imageElement = viewer.querySelector('.image-viewer-image');
  const captionElement = viewer.querySelector('.image-viewer-caption');

  imageElement.src = image.url;
  imageElement.alt = image.title || '안내 이미지';
  captionElement.textContent = image.description
    ? `${image.title || ''}${image.title ? ' · ' : ''}${image.description}`
    : (image.title || '');

  viewer.classList.remove('hidden');
  document.body.classList.add('viewer-open');
}

function appendMessage(role, text, followUp = [], sources = [], images = []) {
  const wrapper = document.createElement('article');
  wrapper.className = `message ${role}`;

  const label = document.createElement('span');
  label.className = 'message-label';
  label.textContent = role === 'bot' ? '파란코끼리 AI상담원' : '고객';
  wrapper.appendChild(label);

  const paragraphs = splitMessageParagraphs(role, text);

  if (paragraphs.length === 0) {
    const body = document.createElement('p');
    body.textContent = '';
    wrapper.appendChild(body);
  } else {
    paragraphs.forEach((paragraph) => {
      const body = document.createElement('p');
      appendRichText(body, paragraph);
      wrapper.appendChild(body);
    });
  }

  if (followUp.length > 0) {
    const list = document.createElement('ul');
    followUp.forEach((item) => {
      const li = document.createElement('li');
      appendRichText(li, item);
      list.appendChild(li);
    });
    wrapper.appendChild(list);
  }

  const linkedSources = (sources || []).filter((source) => isValidExternalUrl(source.url));

  if (linkedSources.length > 0) {
    const sourceBox = document.createElement('div');
    sourceBox.className = 'source-box';

    const sourceTitle = document.createElement('strong');
    sourceTitle.textContent = '참고 문서';
    sourceBox.appendChild(sourceTitle);

    const sourceList = document.createElement('ul');
    linkedSources.forEach((source) => {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = source.url;
      link.target = '_blank';
      link.rel = 'noreferrer';
      link.textContent = source.title;
      li.appendChild(link);
      sourceList.appendChild(li);
    });

    sourceBox.appendChild(sourceList);
    wrapper.appendChild(sourceBox);
  }

  if (role === 'bot' && images.length > 0) {
    const imageBox = document.createElement('div');
    imageBox.className = 'image-box';

    const imageTitle = document.createElement('strong');
    imageTitle.textContent = '관련 이미지';
    imageBox.appendChild(imageTitle);

    images.forEach((image) => {
      const card = document.createElement('figure');
      card.className = 'image-card';
      if (image.display === 'document') {
        card.classList.add('image-card--document');
      }
      card.tabIndex = 0;
      card.setAttribute('role', 'button');
      card.setAttribute('aria-label', `${image.title || '안내 이미지'} 크게 보기`);

      const img = document.createElement('img');
      img.src = image.url;
      img.alt = image.title || '안내 이미지';
      img.loading = 'lazy';
      card.appendChild(img);

      if (image.title || image.description) {
        const caption = document.createElement('figcaption');

        if (image.title) {
          const captionTitle = document.createElement('strong');
          captionTitle.textContent = image.title;
          caption.appendChild(captionTitle);
        }

        if (image.description) {
          const captionText = document.createElement('span');
          captionText.textContent = image.description;
          caption.appendChild(captionText);
        }

        card.appendChild(caption);
      }

      card.addEventListener('click', () => {
        openImageViewer(image);
      });

      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openImageViewer(image);
        }
      });

      imageBox.appendChild(card);
    });

    wrapper.appendChild(imageBox);
  }

  chat.appendChild(wrapper);
  chat.scrollTop = chat.scrollHeight;
}

function removePendingMessage() {
  if (!pendingMessageElement) {
    return;
  }

  pendingMessageElement.remove();
  pendingMessageElement = null;
}

function showPendingMessage() {
  removePendingMessage();

  const wrapper = document.createElement('article');
  wrapper.className = 'message bot pending';

  const label = document.createElement('span');
  label.className = 'message-label';
  label.textContent = '파란코끼리 AI상담원';
  wrapper.appendChild(label);

  const body = document.createElement('p');
  body.className = 'pending-text';
  body.textContent = '답변을 준비하고 있습니다...';
  wrapper.appendChild(body);

  const dots = document.createElement('span');
  dots.className = 'pending-dots';
  dots.setAttribute('aria-hidden', 'true');

  for (let index = 0; index < 3; index += 1) {
    const dot = document.createElement('span');
    dot.className = 'pending-dot';
    dots.appendChild(dot);
  }

  wrapper.appendChild(dots);
  chat.appendChild(wrapper);
  chat.scrollTop = chat.scrollHeight;
  pendingMessageElement = wrapper;
}

function setBusyState(isBusy) {
  input.disabled = isBusy;
  form.querySelector('button[type="submit"]').disabled = isBusy;
  getChipElements().forEach((chip) => {
    chip.disabled = isBusy;
  });
}

async function sendMessage(message) {
  appendMessage('user', message);
  showPendingMessage();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message, sessionId }),
    });

    const data = await response.json();
    const followUp = data.detail
      ? [...(data.followUp || []), `오류 상세: ${data.detail}`]
      : (data.followUp || []);

    removePendingMessage();
    appendMessage('bot', data.answer, followUp, data.sources || [], data.images || []);
    loadPopularQuestions();
  } catch (error) {
    removePendingMessage();
    throw error;
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) {
    return;
  }

  input.value = '';
  input.focus();
  setBusyState(true);

  try {
    await sendMessage(message);
  } catch (error) {
    appendMessage('bot', '서버 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  } finally {
    setBusyState(false);
    input.focus();
  }
});

chips.forEach((chip) => {
  chip.addEventListener('click', async () => {
    input.value = '';
    setBusyState(true);

    try {
      await sendMessage(chip.dataset.question);
    } catch (error) {
      appendMessage('bot', '서버 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    } finally {
      setBusyState(false);
      input.focus();
    }
  });
});

appendMessage(
  'bot',
  '안녕하세요. 파란코끼리 AI상담원입니다. 병원 문서를 바탕으로 안내해 드리며, 문서에 없는 내용은 추측하지 않고 안내합니다.',
  ['진료시간 알려줘', '셔틀버스시간 알려줘', '입원전 금지 약물 알려줘']
);

renderQuickActions(fallbackQuickActions);
loadPopularQuestions();
