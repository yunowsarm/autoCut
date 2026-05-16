const textInput = document.querySelector('#textInput');
const imageInput = document.querySelector('#imageInput');
const ttsProviderInput = document.querySelector('#ttsProvider');
const aspectRatioInput = document.querySelector('#aspectRatio');
const charsPerSecondInput = document.querySelector('#charsPerSecond');
const minSecondsInput = document.querySelector('#minSeconds');
const maxSecondsInput = document.querySelector('#maxSeconds');
const subtitleEnabledInput = document.querySelector('#subtitleEnabled');
const imageMotionInput = document.querySelector('#imageMotion');
const imageCropFillInput = document.querySelector('#imageCropFill');
const motionZoomStartInput = document.querySelector('#motionZoomStart');
const motionZoomEndInput = document.querySelector('#motionZoomEnd');
const motionFloatAmplitudeInput = document.querySelector('#motionFloatAmplitude');
const motionFloatSpeedInput = document.querySelector('#motionFloatSpeed');
const segmentCount = document.querySelector('#segmentCount');
const imageCount = document.querySelector('#imageCount');
const durationTotal = document.querySelector('#durationTotal');
const imageSummary = document.querySelector('#imageSummary');
const renderButton = document.querySelector('#renderButton');
const statusEl = document.querySelector('#status');
const downloadLink = document.querySelector('#downloadLink');
const progressPanel = document.querySelector('#progressPanel');
const progressLabel = document.querySelector('#progressLabel');
const progressPercent = document.querySelector('#progressPercent');
const progressBar = document.querySelector('#progressBar');

const supportedImages = new Set(['jpg', 'jpeg', 'png', 'webp']);
let selectedImages = [];
let pollTimer = null;

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
    sensitivity: 'base',
  });
  return [...files].sort((a, b) => {
    const nameA = a.webkitRelativePath || a.name;
    const nameB = b.webkitRelativePath || b.name;
    return collator.compare(nameA, nameB);
  });
}

function numberValue(input, fallback) {
  return Number(input?.value) || fallback;
}

function getSettings() {
  return {
    ttsProvider: ttsProviderInput?.value || 'milora',
    aspectRatio: aspectRatioInput?.value || '9:16',
    charsPerSecond: numberValue(charsPerSecondInput, 4),
    minSeconds: numberValue(minSecondsInput, 2),
    maxSeconds: numberValue(maxSecondsInput, 8),
    subtitleEnabled: subtitleEnabledInput.checked,
    imageMotion: imageMotionInput?.value || 'both',
    imageCropFill: imageCropFillInput?.checked !== false,
    motionZoomStart: numberValue(motionZoomStartInput, 1),
    motionZoomEnd: numberValue(motionZoomEndInput, 1.12),
    motionFloatAmplitude: numberValue(motionFloatAmplitudeInput, 88),
    motionFloatSpeed: numberValue(motionFloatSpeedInput, 1),
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

function setProgress(progress, message) {
  const value = clamp(Math.round(Number(progress) || 0), 0, 100);
  progressPanel.hidden = false;
  progressLabel.textContent = message || '生成中';
  progressPercent.textContent = `${value}%`;
  progressBar.style.width = `${value}%`;
}

function stopPolling() {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
}

async function pollJob(statusUrl) {
  const response = await fetch(statusUrl);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || '读取生成进度失败。');
  }

  setProgress(payload.progress, payload.message);
  setStatus(payload.message || '正在生成视频...');

  if (payload.status === 'done') {
    const result = payload.result;
    downloadLink.href = result.downloadUrl;
    downloadLink.download = result.outputName;
    downloadLink.hidden = false;
    setProgress(100, '生成完成');
    setStatus(`生成完成：${result.segmentCount} 段，约 ${result.totalDuration}s。`);
    renderButton.disabled = false;
    return;
  }

  if (payload.status === 'error') {
    throw new Error(payload.error || '视频生成失败。');
  }

  pollTimer = setTimeout(() => {
    pollJob(statusUrl).catch((error) => {
      setStatus(error.message || '视频生成失败。', true);
      renderButton.disabled = false;
    });
  }, 1000);
}

imageInput.addEventListener('change', () => {
  selectedImages = naturalSort(Array.from(imageInput.files || [])).filter((file) => {
    const ext = file.name.split('.').pop().toLowerCase();
    return supportedImages.has(ext);
  });
  updateStats();
});

[
  textInput,
  ttsProviderInput,
  aspectRatioInput,
  charsPerSecondInput,
  minSecondsInput,
  maxSecondsInput,
  subtitleEnabledInput,
  imageMotionInput,
  imageCropFillInput,
  motionZoomStartInput,
  motionZoomEndInput,
  motionFloatAmplitudeInput,
  motionFloatSpeedInput,
].forEach((input) => {
  input?.addEventListener('input', updateStats);
  input?.addEventListener('change', updateStats);
});

renderButton.addEventListener('click', async () => {
  const segments = splitSegments(textInput.value);
  downloadLink.hidden = true;
  stopPolling();

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
  formData.append('ttsProvider', settings.ttsProvider);
  formData.append('aspectRatio', settings.aspectRatio);
  formData.append('charsPerSecond', String(settings.charsPerSecond));
  formData.append('minSeconds', String(settings.minSeconds));
  formData.append('maxSeconds', String(settings.maxSeconds));
  formData.append('subtitleEnabled', String(settings.subtitleEnabled));
  formData.append('imageMotion', settings.imageMotion);
  formData.append('imageCropFill', String(settings.imageCropFill));
  formData.append('imageFit', settings.imageCropFill ? 'cover' : 'contain');
  formData.append('motionZoomStart', String(settings.motionZoomStart));
  formData.append('motionZoomEnd', String(settings.motionZoomEnd));
  formData.append('motionFloatAmplitude', String(settings.motionFloatAmplitude));
  formData.append('motionFloatSpeed', String(settings.motionFloatSpeed));

  selectedImages.forEach((file) => {
    formData.append('images', file, file.webkitRelativePath || file.name);
  });

  renderButton.disabled = true;
  setProgress(0, '上传素材');
  setStatus('正在提交生成任务...');

  try {
    const response = await fetch('/api/render', {
      method: 'POST',
      body: formData,
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || '视频生成失败。');
    }

    setProgress(1, '任务已创建');
    setStatus('任务已创建，正在生成视频...');
    await pollJob(payload.statusUrl);
  } catch (error) {
    setStatus(error.message || '视频生成失败。', true);
    renderButton.disabled = false;
  }
});

async function loadTtsStatus() {
  try {
    const response = await fetch('/api/config');
    const payload = await response.json();
    if (!payload.ok) return;

    if (ttsProviderInput) {
      ttsProviderInput.value = payload.ttsProvider || 'milora';
    }

    const parts = [
      payload.miloraConfigured ? '曼波可用' : '曼波未配置',
      payload.xfyunConfigured ? '讯飞可用' : '讯飞未配置',
    ];

    const hint = document.querySelector('#ttsStatus');
    if (hint) {
      hint.textContent = `旁白引擎：${parts.join(' / ')}`;
      hint.classList.toggle('error', !payload.miloraConfigured && !payload.xfyunConfigured);
    }
  } catch {
    // 配置状态不影响主要生成流程。
  }
}

loadTtsStatus();
updateStats();
