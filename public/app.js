const chat = document.getElementById('chat');
const form = document.getElementById('chat-form');
const input = document.getElementById('message-input');
const chips = document.querySelectorAll('.chip');
const sessionId = `session-${crypto.randomUUID()}`;

function isValidExternalUrl(value) {
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (error) {
    return false;
  }
}

function appendMessage(role, text, followUp = [], sources = []) {
  const wrapper = document.createElement('article');
  wrapper.className = `message ${role}`;

  const label = document.createElement('span');
  label.className = 'message-label';
  label.textContent = role === 'bot' ? '하나이비인후과병원 상담원' : '환자';
  wrapper.appendChild(label);

  const body = document.createElement('p');
  body.textContent = text;
  wrapper.appendChild(body);

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
    sourceTitle.textContent = '참고한 문서';
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

  chat.appendChild(wrapper);
  chat.scrollTop = chat.scrollHeight;
}

async function sendMessage(message) {
  appendMessage('user', message);

  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, sessionId }),
  });

  const data = await response.json();
  const followUp = data.detail ? [...(data.followUp || []), `오류 상세: ${data.detail}`] : (data.followUp || []);
  appendMessage('bot', data.answer, followUp, data.sources || []);
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = input.value.trim();
  if (!message) {
    return;
  }

  input.value = '';
  input.focus();

  try {
    await sendMessage(message);
  } catch (error) {
    appendMessage('bot', '서버 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  }
});

chips.forEach((chip) => {
  chip.addEventListener('click', async () => {
    input.value = '';
    try {
      await sendMessage(chip.dataset.question);
    } catch (error) {
      appendMessage('bot', '서버 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.');
    }
  });
});

appendMessage(
  'bot',
  '안녕하세요. 하나이비인후과병원 상담원입니다. 홈페이지 문서를 바탕으로 자연스럽게 안내합니다. 문서에 없는 내용은 추측하지 않고 알려드립니다.',
  ['진료의사 알려줘', '동헌종 원장 진료시간', '입원 절차 알려줘']
);
