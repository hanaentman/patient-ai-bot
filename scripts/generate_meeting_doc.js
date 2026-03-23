const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const output = path.join(__dirname, '..', 'ai_tf_meeting_2026-03-20_v2.docx');

const paragraphs = [
  ['AI 상담 프로그램 상용화 TF 1차 회의 자료', true, 32],
  ['일시: 2026.03.20', false, 22],
  ['참석자: 김성준, 하미현, 박완진, 오정혜, 강수인', false, 22],
  ['', false, 22],
  ['1. 회의 목적', true, 26],
  ['AI 상담 프로그램의 상용화 가능성을 검토하고, 실제 운영을 위한 기준과 방향을 정하기 위함입니다.', false, 22],
  ['이번 1차 회의에서는 프로그램의 학습 데이터, 제공 기능, 운영 방식, 배포 방향, 서비스명, 지침 체계를 중심으로 기본 원칙을 확정하고자 합니다.', false, 22],
  ['', false, 22],
  ['2. 회의 개요', true, 26],
  ['회의명: AI 상담 프로그램 상용화 TF 1차 회의', false, 22],
  ['회의 목적: 상용화 전 검증 항목 및 운영 기준 설정', false, 22],
  ['- 학습 데이터 범위 초안', false, 22],
  ['- 우선 기능 범위 초안', false, 22],
  ['- 정기 미팅 일정', false, 22],
  ['- 운영 및 배포 방향 초안', false, 22],
  ['- 프로그램명 후보', false, 22],
  ['- 기본 지침 초안', false, 22],
  ['', false, 22],
  ['3. 현재 논의 배경', true, 26],
  ['현재 AI 상담 프로그램은 병원 홈페이지 및 내부 문서를 기반으로 환자 안내성 질문에 답변하는 구조로 운영 가능합니다.', false, 22],
  ['향후 상용화를 위해서는 단순 개발 완료 여부가 아니라, 실제 환자 안내에 적합한 수준인지 검증하고 다음 항목들을 명확히 정해야 합니다.', false, 22],
  ['- 어떤 데이터를 기준으로 답변할 것인지', false, 22],
  ['- 어떤 기능까지 허용할 것인지', false, 22],
  ['- 어떤 방식으로 운영하고 배포할 것인지', false, 22],
  ['- 어떤 기준으로 검수하고 수정할 것인지', false, 22],
  ['', false, 22],
  ['4. 주요 안건', true, 26],
  ['안건 1. 학습 데이터 결정', true, 24],
  ['AI가 어떤 자료를 근거로 답변할지 결정하는 항목입니다.', false, 22],
  ['검토 내용:', true, 22],
  ['- 병원 홈페이지 내용을 기본 데이터로 사용할지', false, 22],
  ['- 내부 안내문, 비용표, 입퇴원 문서, 셔틀 안내, 의료진 정보 등을 포함할지', false, 22],
  ['- 외부 온라인 데이터를 참고 허용할지', false, 22],
  ['- 최신 정보 반영 주기와 관리 책임자를 누구로 할지', false, 22],
  ['- 내부 학습데이터 범위를 어디까지 둘지', false, 22],
  ['- 예약 안내', false, 22],
  ['- 진료시간 안내', false, 22],
  ['- 위치 및 교통 안내', false, 22],
  ['- 셔틀버스 안내', false, 22],
  ['- 입퇴원 안내', false, 22],
  ['- 서류 발급 안내', false, 22],
  ['- 의료진 및 진료과 안내', false, 22],
  ['- 상담실 연결 유도', false, 22],
  ['- 응급, 진단, 처방 관련 질문 차단 기능', false, 22],
  ['', false, 22],
  ['안건 2. 기능 범위 결정', true, 24],
  ['상용화 전 어떤 기능을 추가 및 보완할지 결정해야 합니다.', false, 22],
  ['', false, 22],
  ['안건 3. 매주 1회 미팅 요일 결정', true, 24],
  ['TF 운영을 위한 정기 회의 체계를 정하는 항목입니다.', false, 22],
  ['검토 내용:', true, 22],
  ['- 매주 1회 고정 회의 요일', false, 22],
  ['- 회의 시간대', false, 22],
  ['- 참석 대상', false, 22],
  ['- 회의 전 준비자료(1주일 간 프로그램 테스트 후 피드백)', false, 22],
  ['', false, 22],
  ['안건 4. 앞으로 어떻게 운영하고 환자에게 배포할지 결정', true, 24],
  ['검토 내용:', true, 22],
  ['- 병원 홈페이지 탑재 방식', false, 22],
  ['- 모바일 웹 운영 방식', false, 22],
  ['- 환자용 QR 안내문 배포 여부', false, 22],
  ['- 일정 기간 시범 운영 후 공개할지', false, 22],
  ['- X배너 등 홍보용 활용 여부', false, 22],
  ['', false, 22],
  ['안건 5. 프로그램 이름 결정', true, 24],
  ['내부 및 외부에서 사용할 서비스명을 정하는 항목입니다.', false, 22],
  ['검토 내용:', true, 22],
  ['- 병원 브랜드와 연결된 이름이 적절한지', false, 22],
  ['- "파란코끼리 상담원" 등 AI 상담, 안내, 도우미, 챗봇 중 어떤 표현이 적합한지', false, 22],
  ['- 환자에게 친숙하고 신뢰감 있는 이름인지', false, 22],
  ['', false, 22],
  ['안건 6. 지침 결정', true, 24],
  ['프로그램이 어떤 원칙으로 답변해야 하는지 기준을 정하는 항목입니다.', false, 22],
  ['검토 내용:', true, 22],
  ['- 답변 우선순위: 홈페이지 > 내부 학습 데이터 > 온라인 데이터 여부', false, 22],
  ['- 외부 데이터 허용 범위', false, 22],
  ['- 답변 불가 항목 정의', false, 22],
  ['- 출처 표시 여부', false, 22],
  ['- 잘못된 답변 발견 시 수정 절차', false, 22],
  ['- 개인정보 및 민감정보 입력 방지 안내 필요 여부', false, 22],
  ['- 상용화 후 학습데이터 업데이트 담당자', false, 22],
];

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function makeParagraph(text, bold, size) {
  if (!text) {
    return '<w:p/>';
  }

  return `<w:p><w:r><w:rPr><w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="Malgun Gothic"/><w:sz w:val="${size}"/><w:szCs w:val="${size}"/>${bold ? '<w:b/>' : ''}</w:rPr><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r></w:p>`;
}

function crc32(buffer) {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j += 1) {
      crc = (crc >>> 1) ^ (0xEDB88320 & -(crc & 1));
    }
  }
  return (crc ^ -1) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    dosTime: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    dosDate: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

function addFile(name, content) {
  const data = Buffer.from(content, 'utf8');
  const compressed = zlib.deflateRawSync(data);
  return {
    name,
    data,
    compressed,
    crc: crc32(data),
    ...dosDateTime(new Date()),
  };
}

const body = paragraphs.map(([text, bold, size]) => makeParagraph(text, bold, size)).join('');
const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp14="http://schemas.microsoft.com/office/word/2010/wordprocessingDrawing" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:w10="urn:schemas-microsoft-com:office:word" xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wpg="http://schemas.microsoft.com/office/word/2010/wordprocessingGroup" xmlns:wpi="http://schemas.microsoft.com/office/word/2010/wordprocessingInk" xmlns:wne="http://schemas.microsoft.com/office/2006/wordml" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" mc:Ignorable="w14 wp14"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/><w:cols w:space="708"/><w:docGrid w:linePitch="360"/></w:sectPr></w:body></w:document>`;
const contentTypesXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const relsXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>';

const files = [
  addFile('[Content_Types].xml', contentTypesXml),
  addFile('_rels/.rels', relsXml),
  addFile('word/document.xml', documentXml),
];

let localOffset = 0;
const localParts = [];
const centralParts = [];

for (const file of files) {
  const nameBuffer = Buffer.from(file.name, 'utf8');

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(8, 8);
  localHeader.writeUInt16LE(file.dosTime, 10);
  localHeader.writeUInt16LE(file.dosDate, 12);
  localHeader.writeUInt32LE(file.crc, 14);
  localHeader.writeUInt32LE(file.compressed.length, 18);
  localHeader.writeUInt32LE(file.data.length, 22);
  localHeader.writeUInt16LE(nameBuffer.length, 26);
  localHeader.writeUInt16LE(0, 28);
  localParts.push(localHeader, nameBuffer, file.compressed);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(8, 10);
  centralHeader.writeUInt16LE(file.dosTime, 12);
  centralHeader.writeUInt16LE(file.dosDate, 14);
  centralHeader.writeUInt32LE(file.crc, 16);
  centralHeader.writeUInt32LE(file.compressed.length, 20);
  centralHeader.writeUInt32LE(file.data.length, 24);
  centralHeader.writeUInt16LE(nameBuffer.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(localOffset, 42);
  centralParts.push(centralHeader, nameBuffer);

  localOffset += localHeader.length + nameBuffer.length + file.compressed.length;
}

const centralDirectory = Buffer.concat(centralParts);
const endRecord = Buffer.alloc(22);
endRecord.writeUInt32LE(0x06054b50, 0);
endRecord.writeUInt16LE(0, 4);
endRecord.writeUInt16LE(0, 6);
endRecord.writeUInt16LE(files.length, 8);
endRecord.writeUInt16LE(files.length, 10);
endRecord.writeUInt32LE(centralDirectory.length, 12);
endRecord.writeUInt32LE(localOffset, 16);
endRecord.writeUInt16LE(0, 20);

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, Buffer.concat([...localParts, centralDirectory, endRecord]));
console.log(output);
