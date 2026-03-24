const chat = document.getElementById('chat');
const form = document.getElementById('chat-form');
const input = document.getElementById('message-input');
const chips = document.querySelectorAll('.chip');
const sessionId = `session-${crypto.randomUUID()}`;

let pendingMessageElement = null;

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
    .split(/(?<=[.!?][)"'\]]?)\s+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

function appendMessage(role, text, followUp = [], sources = [], images = []) {
  const wrapper = document.createElement('article');
  wrapper.className = `message ${role}`;

  const label = document.createElement('span');
  label.className = 'message-label';
  label.textContent = role === 'bot' ? '하나이비인후과 AI 상담' : '사용자';
  wrapper.appendChild(label);

  const paragraphs = splitMessageParagraphs(role, text);

  if (paragraphs.length === 0) {
    const body = document.createElement('p');
    body.textContent = '';
    wrapper.appendChild(body);
  } else {
    paragraphs.forEach((paragraph) => {
      const body = document.createElement('p');
      body.textContent = paragraph;
      wrapper.appendChild(body);
    });
  }

  if (followUp.length > 0) {
    const list = document.createElement('ul');
    followUp.forEach((item) => {
      const li = document.createElement('li');
      li.textContent = item;
      list.appendChild(li);
    });
    wrapper.appendChild(list);
  }

  if (sources.length > 0) {
    const sourceBox = document.createElement('div');
    sourceBox.className = 'source-box';

    const sourceTitle = document.createElement('strong');
    sourceTitle.textContent = '참고 문서';
    sourceBox.appendChild(sourceTitle);

    const sourceList = document.createElement('ul');
    sources.forEach((source) => {
      const li = document.createElement('li');
      if (isValidExternalUrl(source.url)) {
        const link = document.createElement('a');
        link.href = source.url;
        link.target = '_blank';
        link.rel = 'noreferrer';
        link.textContent = source.title;
        li.appendChild(link);
      } else {
        li.textContent = source.title;
      }
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
  label.textContent = '하나이비인후과 AI 상담';
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
  chips.forEach((chip) => {
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
  '안녕하세요. 하나이비인후과 AI 상담입니다. 병원 홈페이지 문서를 바탕으로 안내해 드립니다. 문서에 없는 내용은 추측하지 않고 알려드립니다.',
  ['진료과를 알려줘', '이비인후과 원장 진료시간 알려줘', '입원 절차를 알려줘']
);
