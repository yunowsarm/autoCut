const textInput = document.querySelector('#textInput');
const imageInput = document.querySelector('#imageInput');
const charsPerSecondInput = document.querySelector('#charsPerSecond');
const minSecondsInput = document.querySelector('#minSeconds');
const maxSecondsInput = document.querySelector('#maxSeconds');
const subtitleEnabledInput = document.querySelector('#subtitleEnabled');
const segmentCount = document.querySelector('#segmentCount');
const imageCount = document.querySelector('#imageCount');
const durationTotal = document.querySelector('#durationTotal');
const imageSummary = document.querySelector('#imageSummary');
const renderButton = document.querySelector('#renderButton');
const statusEl = document.querySelector('#status');
const downloadLink = document.querySelector('#downloadLink');

const supportedImages = new Set(['jpg', 'jpeg', 'png', 'webp']);
let selectedImages = [];

function splitSegments(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function countReadableChars(text) {
  return Array.from(text.replace(/\s+/g, '')).length;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function naturalSort(files) {
  const collator = new Intl.Collator('zh-Hans-CN', {
    numeric: true,
    sensitivity: 'base'
  });
  return [...files].sort((a, b) => {
    const nameA = a.webkitRelativePath || a.name;
    const nameB = b.webkitRelativePath || b.name;
    return collator.compare(nameA, nameB);
  });
}

function getSettings() {
  return {
    charsPerSecond: Number(charsPerSecondInput.value) || 4,
    minSeconds: Number(minSecondsInput.value) || 2,
    maxSeconds: Number(maxSecondsInput.value) || 8,
    subtitleEnabled: subtitleEnabledInput.checked
  };
}

function estimateDuration(segments) {
  const settings = getSettings();
  return segments.reduce((sum, text) => {
    const raw = countReadableChars(text) / settings.charsPerSecond;
    return sum + clamp(raw, settings.minSeconds, settings.maxSeconds);
  }, 0);
}

function updateStats() {
  const segments = splitSegments(textInput.value);
  segmentCount.textContent = String(segments.length);
  imageCount.textContent = String(selectedImages.length);
  durationTotal.textContent = `${estimateDuration(segments).toFixed(1)}s`;

  if (selectedImages.length === 0) {
    imageSummary.textContent = '尚未选择图片';
  } else {
    imageSummary.textContent = `已选择 ${selectedImages.length} 张图片，将按文件名顺序使用`;
  }
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', isError);
}

imageInput.addEventListener('change', () => {
  selectedImages = naturalSort(Array.from(imageInput.files || [])).filter((file) => {
    const ext = file.name.split('.').pop().toLowerCase();
    return supportedImages.has(ext);
  });
  updateStats();
});

[textInput, charsPerSecondInput, minSecondsInput, maxSecondsInput, subtitleEnabledInput].forEach((input) => {
  input.addEventListener('input', updateStats);
  input.addEventListener('change', updateStats);
});

renderButton.addEventListener('click', async () => {
  const segments = splitSegments(textInput.value);
  downloadLink.hidden = true;

  if (segments.length === 0) {
    setStatus('请先输入至少一段小说文本。', true);
    return;
  }

  if (selectedImages.length < segments.length) {
    setStatus(`图片数量不足：需要 ${segments.length} 张，当前只有 ${selectedImages.length} 张。`, true);
    return;
  }

  const settings = getSettings();
  const formData = new FormData();
  formData.append('text', textInput.value);
  formData.append('charsPerSecond', String(settings.charsPerSecond));
  formData.append('minSeconds', String(settings.minSeconds));
  formData.append('maxSeconds', String(settings.maxSeconds));
  formData.append('subtitleEnabled', String(settings.subtitleEnabled));

  selectedImages.forEach((file) => {
    formData.append('images', file, file.webkitRelativePath || file.name);
  });

  renderButton.disabled = true;
  setStatus('正在生成视频，图片较多时可能需要几分钟...');

  try {
    const response = await fetch('/api/render', {
      method: 'POST',
      body: formData
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || '视频生成失败。');
    }

    downloadLink.href = payload.downloadUrl;
    downloadLink.download = payload.outputName;
    downloadLink.hidden = false;
    setStatus(`生成完成：${payload.segmentCount} 段，约 ${payload.totalDuration}s。`);
  } catch (error) {
    setStatus(error.message || '视频生成失败。', true);
  } finally {
    renderButton.disabled = false;
  }
});

updateStats();
