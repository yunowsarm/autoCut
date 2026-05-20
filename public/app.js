const desktop = window.autocutDesktop || null;

const textInput = document.querySelector('#textInput');
const imageInput = document.querySelector('#imageInput');
const bgmInput = document.querySelector('#bgmInput');
const bgmSummary = document.querySelector('#bgmSummary');
const bgmVolumeInput = document.querySelector('#bgmVolume');
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
const outputSummary = document.querySelector('#outputSummary');
const segmentList = document.querySelector('#segmentList');
const renderButton = document.querySelector('#renderButton');
const statusEl = document.querySelector('#status');
const progressPanel = document.querySelector('#progressPanel');
const progressLabel = document.querySelector('#progressLabel');
const progressPercent = document.querySelector('#progressPercent');
const progressBar = document.querySelector('#progressBar');
const selectImageFolderButton = document.querySelector('#selectImageFolderButton');
const selectBgmButton = document.querySelector('#selectBgmButton');
const selectOutputFolderButton = document.querySelector('#selectOutputFolderButton');
const openOutputButton = document.querySelector('#openOutputButton');
const imagePreviewModal = document.querySelector('#imagePreviewModal');
const fullImagePreview = document.querySelector('#fullImagePreview');
const closeImagePreviewButton = document.querySelector('#closeImagePreviewButton');

const supportedImages = new Set(['jpg', 'jpeg', 'png', 'webp']);
let segmentImages = [];
let segmentImageCleared = [];
let importedImages = [];
let selectedBgm = null;
let selectedOutputFolder = '';
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
    const nameA = a.webkitRelativePath || a.name || a.originalname || a.path;
    const nameB = b.webkitRelativePath || b.name || b.originalname || b.path;
    return collator.compare(nameA, nameB);
  });
}

function numberValue(input, fallback) {
  return Number(input?.value) || fallback;
}

function imageName(image) {
  return image?.name || image?.originalname || image?.path?.split(/[\\/]/).pop() || '';
}

function imagePreviewSrc(image) {
  if (!image) return '';

  if (image instanceof File) {
    if (!image.previewUrl) {
      image.previewUrl = URL.createObjectURL(image);
    }
    return image.previewUrl;
  }

  if (image.path) {
    const normalized = image.path.replace(/\\/g, '/');
    const withLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`;
    return encodeURI(`file://${withLeadingSlash}`);
  }

  return '';
}

function getSettings() {
  return {
    ttsProvider: ttsProviderInput?.value || 'milora',
    bgmVolume: clamp(numberValue(bgmVolumeInput, 0.18), 0, 1),
    aspectRatio: aspectRatioInput?.value || '9:16',
    charsPerSecond: numberValue(charsPerSecondInput, 4),
    minSeconds: numberValue(minSecondsInput, 2),
    maxSeconds: numberValue(maxSecondsInput, 8),
    subtitleEnabled: subtitleEnabledInput.checked,
    imageMotion: imageMotionInput?.value || 'both',
    imageCropFill: imageCropFillInput?.checked === true,
    imageFit: imageCropFillInput?.checked === true ? 'cover' : 'contain',
    motionZoomStart: numberValue(motionZoomStartInput, 1),
    motionZoomEnd: numberValue(motionZoomEndInput, 1.12),
    motionFloatAmplitude: numberValue(motionFloatAmplitudeInput, 88),
    motionFloatSpeed: numberValue(motionFloatSpeedInput, 1),
    bgmPath: selectedBgm?.path || null,
  };
}

function estimateDuration(segments) {
  const settings = getSettings();
  return segments.reduce((sum, text) => {
    const raw = countReadableChars(text) / settings.charsPerSecond;
    return sum + clamp(raw, settings.minSeconds, settings.maxSeconds);
  }, 0);
}

function syncSegmentImages(segments) {
  if (segmentImages.length > segments.length) {
    segmentImages = segmentImages.slice(0, segments.length);
    segmentImageCleared = segmentImageCleared.slice(0, segments.length);
  }

  while (segmentImages.length < segments.length) {
    const index = segmentImages.length;
    segmentImages.push(importedImages[index] || null);
    segmentImageCleared.push(false);
  }

  for (let i = 0; i < segments.length; i++) {
    if (!segmentImages[i] && !segmentImageCleared[i] && importedImages[i]) {
      segmentImages[i] = importedImages[i];
    }
  }
}

function updateTextSegment(index, value) {
  const segments = splitSegments(textInput.value);
  segments[index] = value.trim();
  textInput.value = segments.filter(Boolean).join('\n');
  const nextSegments = splitSegments(textInput.value);
  syncSegmentImages(nextSegments);
  segmentCount.textContent = String(nextSegments.length);
  durationTotal.textContent = `${estimateDuration(nextSegments).toFixed(1)}s`;
}

function openImagePreview(image) {
  const src = imagePreviewSrc(image);
  if (!src) return;
  fullImagePreview.src = src;
  imagePreviewModal.hidden = false;
}

function closeImagePreview() {
  imagePreviewModal.hidden = true;
  fullImagePreview.removeAttribute('src');
}

function renderSegmentList(segments) {
  segmentList.innerHTML = '';

  if (segments.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'segment-empty';
    empty.textContent = '输入文本后，这里会显示每个段落的配图状态。';
    segmentList.append(empty);
    return;
  }

  segments.forEach((text, index) => {
    const item = document.createElement('article');
    item.className = 'segment-item';

    const meta = document.createElement('div');
    meta.className = 'segment-meta';

    const title = document.createElement('strong');
    title.textContent = `第 ${index + 1} 段`;

    const preview = document.createElement('textarea');
    preview.className = 'segment-text-editor';
    preview.value = text;
    preview.rows = 3;
    preview.addEventListener('input', () => {
      updateTextSegment(index, preview.value);
    });
    preview.addEventListener('blur', updateStats);

    meta.append(title, preview);

    const imageBox = document.createElement('div');
    imageBox.className = 'segment-image-box';

    const image = segmentImages[index];
    const imagePreview = document.createElement('div');
    imagePreview.className = image ? 'segment-preview has-image' : 'segment-preview';

    if (image) {
      const img = document.createElement('img');
      img.alt = `第 ${index + 1} 段配图预览`;
      img.src = imagePreviewSrc(image);
      imagePreview.title = '双击预览完整图片';
      imagePreview.addEventListener('dblclick', () => openImagePreview(image));
      imagePreview.append(img);
    } else {
      const placeholder = document.createElement('span');
      placeholder.textContent = '无图';
      imagePreview.append(placeholder);
    }

    const imageLabel = document.createElement('span');
    imageLabel.textContent = image ? imageName(image) : '未配图，生成时显示黑底字幕';
    imageLabel.className = image ? 'segment-image-name' : 'segment-image-empty';

    const actions = document.createElement('div');
    actions.className = 'segment-actions';

    const chooseButton = document.createElement('button');
    chooseButton.type = 'button';
    chooseButton.className = 'mini-button';
    chooseButton.textContent = '选择图片';
    chooseButton.addEventListener('click', () => chooseImageForSegment(index));

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'mini-button subtle';
    clearButton.textContent = '清空';
    clearButton.disabled = !image;
    clearButton.addEventListener('click', () => {
      segmentImages[index] = null;
      segmentImageCleared[index] = true;
      updateStats();
    });

    actions.append(chooseButton, clearButton);
    imageBox.append(imagePreview, imageLabel, actions);
    item.append(meta, imageBox);
    segmentList.append(item);
  });
}

function updateStats() {
  const segments = splitSegments(textInput.value);
  syncSegmentImages(segments);
  const assignedCount = segmentImages.filter(Boolean).length;

  segmentCount.textContent = String(segments.length);
  imageCount.textContent = String(assignedCount);
  durationTotal.textContent = `${estimateDuration(segments).toFixed(1)}s`;

  if (importedImages.length === 0) {
    imageSummary.textContent = assignedCount > 0
      ? `已手动配置 ${assignedCount} 段图片`
      : '尚未导入图片';
  } else {
    const folder = importedImages[0]?.folderPath;
    imageSummary.textContent = folder
      ? `已从文件夹导入 ${importedImages.length} 张图片：${folder}`
      : `已导入 ${importedImages.length} 张图片，并按顺序分配到段落`;
  }

  bgmSummary.textContent = selectedBgm ? `已选择：${selectedBgm.name}` : '未选择背景音乐';
  outputSummary.textContent = selectedOutputFolder
    ? `输出目录：${selectedOutputFolder}`
    : desktop
      ? '请选择输出目录'
      : '网页模式默认保存到 output/';
  renderSegmentList(segments);
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

function setBusy(isBusy) {
  renderButton.disabled = isBusy;
  selectImageFolderButton.disabled = isBusy;
  selectBgmButton.disabled = isBusy;
  selectOutputFolderButton.disabled = isBusy;
  segmentList.querySelectorAll('button').forEach((button) => {
    button.disabled = isBusy || button.dataset.disabled === 'true';
  });
}

function assignImportedImages(images) {
  const segments = splitSegments(textInput.value);
  syncSegmentImages(segments);
  importedImages = images;
  for (let i = 0; i < segments.length; i++) {
    segmentImages[i] = images[i] || null;
    segmentImageCleared[i] = false;
  }
  updateStats();
}

async function chooseImageForSegment(index) {
  if (!desktop) {
    setStatus('网页模式暂不支持单段选择本地图片；请导入图片文件夹后再调整顺序。', true);
    return;
  }

  const result = await desktop.selectImageFile();
  if (result.canceled || !result.image) return;
  segmentImages[index] = result.image;
  segmentImageCleared[index] = false;
  updateStats();
}

async function pollWebJob(statusUrl) {
  const response = await fetch(statusUrl);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || '读取生成进度失败。');
  }

  setProgress(payload.progress, payload.message);
  setStatus(payload.message || '正在生成视频...');

  if (payload.status === 'done') {
    const result = payload.result;
    openOutputButton.hidden = false;
    openOutputButton.textContent = '下载视频';
    openOutputButton.onclick = () => {
      window.location.href = result.downloadUrl;
    };
    setProgress(100, '生成完成');
    setStatus(`生成完成：${result.segmentCount} 段，约 ${result.totalDuration}s。`);
    setBusy(false);
    return;
  }

  if (payload.status === 'error') {
    throw new Error(payload.error || '视频生成失败。');
  }

  pollTimer = setTimeout(() => {
    pollWebJob(statusUrl).catch((error) => {
      setStatus(error.message || '视频生成失败。', true);
      setBusy(false);
    });
  }, 1000);
}

async function selectImages() {
  if (!desktop) {
    imageInput.click();
    return;
  }

  const result = await desktop.selectImageFolder();
  if (result.canceled) return;
  const images = (result.images || []).map((image) => ({
    ...image,
    folderPath: result.folderPath,
  }));
  assignImportedImages(images);
}

async function selectBgm() {
  if (!desktop) {
    bgmInput.click();
    return;
  }

  const result = await desktop.selectBgmFile();
  if (result.canceled) return;
  selectedBgm = result.file;
  updateStats();
}

async function selectOutputFolder() {
  if (!desktop) return;

  const result = await desktop.selectOutputFolder();
  if (result.canceled) return;
  selectedOutputFolder = result.folderPath;
  updateStats();
}

function validateInputs() {
  const segments = splitSegments(textInput.value);

  if (segments.length === 0) {
    throw new Error('请先输入至少一段文本。');
  }

  if (desktop && !selectedOutputFolder) {
    throw new Error('请先选择输出目录。');
  }

  return segments;
}

async function startDesktopRender() {
  const settings = getSettings();
  const payload = {
    text: textInput.value,
    segmentImages,
    outputDir: selectedOutputFolder,
    settings,
  };

  setBusy(true);
  setProgress(0, '任务已创建');
  setStatus('正在生成视频...');
  openOutputButton.hidden = true;

  const result = await desktop.startRender(payload);
  if (!result.ok) {
    throw new Error(result.error || '视频生成失败。');
  }

  openOutputButton.hidden = false;
  openOutputButton.textContent = '打开输出文件夹';
  openOutputButton.onclick = () => desktop.openOutputFolder(result.result.outputPath);
  setProgress(100, '生成完成');
  setStatus(`生成完成：${result.result.segmentCount} 段，约 ${result.result.totalDuration}s。`);
}

async function startWebRender() {
  const settings = getSettings();
  const formData = new FormData();
  formData.append('text', textInput.value);
  formData.append('ttsProvider', settings.ttsProvider);
  formData.append('bgmVolume', String(settings.bgmVolume));
  formData.append('aspectRatio', settings.aspectRatio);
  formData.append('charsPerSecond', String(settings.charsPerSecond));
  formData.append('minSeconds', String(settings.minSeconds));
  formData.append('maxSeconds', String(settings.maxSeconds));
  formData.append('subtitleEnabled', String(settings.subtitleEnabled));
  formData.append('imageMotion', settings.imageMotion);
  formData.append('imageCropFill', String(settings.imageCropFill));
  formData.append('imageFit', settings.imageFit);
  formData.append('motionZoomStart', String(settings.motionZoomStart));
  formData.append('motionZoomEnd', String(settings.motionZoomEnd));
  formData.append('motionFloatAmplitude', String(settings.motionFloatAmplitude));
  formData.append('motionFloatSpeed', String(settings.motionFloatSpeed));

  segmentImages.forEach((file) => {
    if (file instanceof File) {
      formData.append('images', file, file.webkitRelativePath || file.name);
    }
  });

  if (selectedBgm) {
    formData.append('bgm', selectedBgm, selectedBgm.name);
  }

  setBusy(true);
  setProgress(0, '上传素材');
  setStatus('正在提交生成任务...');

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
  await pollWebJob(payload.statusUrl);
}

imageInput.addEventListener('change', () => {
  const files = naturalSort(Array.from(imageInput.files || [])).filter((file) => {
    const ext = file.name.split('.').pop().toLowerCase();
    return supportedImages.has(ext);
  });
  assignImportedImages(files);
});

bgmInput?.addEventListener('change', () => {
  selectedBgm = bgmInput.files?.[0] || null;
  updateStats();
});

selectImageFolderButton.addEventListener('click', selectImages);
selectBgmButton.addEventListener('click', selectBgm);
selectOutputFolderButton.addEventListener('click', selectOutputFolder);
closeImagePreviewButton.addEventListener('click', closeImagePreview);
imagePreviewModal.addEventListener('click', (event) => {
  if (event.target === imagePreviewModal) {
    closeImagePreview();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !imagePreviewModal.hidden) {
    closeImagePreview();
  }
});

[
  textInput,
  ttsProviderInput,
  bgmVolumeInput,
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
  stopPolling();
  openOutputButton.hidden = true;

  try {
    validateInputs();
    if (desktop) {
      await startDesktopRender();
    } else {
      await startWebRender();
    }
  } catch (error) {
    setStatus(error.message || '视频生成失败。', true);
  } finally {
    if (!pollTimer) {
      setBusy(false);
    }
  }
});

async function loadTtsStatus() {
  try {
    const payload = desktop
      ? await desktop.getConfig()
      : await fetch('/api/config').then((response) => response.json());

    if (!payload.ok) return;

    if (ttsProviderInput) {
      ttsProviderInput.value = payload.ttsProvider || 'milora';
    }

    const parts = [
      payload.miloraConfigured ? 'Milora 可用' : 'Milora 未配置',
      payload.xfyunConfigured ? '讯飞可用' : '讯飞未配置',
    ];

    const hint = document.querySelector('#ttsStatus');
    if (hint) {
      hint.textContent = `旁白引擎：${parts.join(' / ')}`;
      hint.classList.toggle('error', !payload.miloraConfigured && !payload.xfyunConfigured);
    }
  } catch {
    const hint = document.querySelector('#ttsStatus');
    if (hint) {
      hint.textContent = '旁白引擎：读取配置失败';
      hint.classList.add('error');
    }
  }
}

if (desktop) {
  imageInput.hidden = true;
  bgmInput.hidden = true;
  desktop.onRenderProgress(({ progress, message }) => {
    setProgress(progress, message);
    setStatus(message || '正在生成视频...');
  });
} else {
  selectOutputFolderButton.disabled = true;
}

loadTtsStatus();
updateStats();
