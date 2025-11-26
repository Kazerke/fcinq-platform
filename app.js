// Configuration - UPDATE THIS WITH YOUR n8n WEBHOOK URL
const N8N_WEBHOOK_URL = 'https://erolp.app.n8n.cloud/webhook/fcinq-chat-form'; 

// Session management
let sessionId = localStorage.getItem('sessionId') || `session-${Date.now()}`;
localStorage.setItem('sessionId', sessionId);

let sessionTotalCost = 0;
let isGenerating = false;
let generationType = 'image'; // Default to image

// Image context storage
let imageContext = [];

// Model configurations for each generation path
const MODEL_CONFIGS = {
  't2i': [ // Text-to-Image
    { id: 'nano-banana', label: 'Nano Banana', price: '$0.05' },
    { id: 'nano-banana-pro', label: 'Nano Banana Pro', price: '$0.08' },
    { id: 'imagen4', label: 'Imagen 4', price: '$0.12' }
  ],
  'i2i': [ // Image-to-Image (edit)
    { id: 'nano-banana-edit', label: 'Nano Banana Edit', price: '$0.08' },
    { id: 'flux-kontext', label: 'Flux Kontext', price: '$0.10' }
  ],
  't2v': [ // Text-to-Video
    { id: 'kling', label: 'Kling', price: '$0.35' },
    { id: 'veo3-fast', label: 'Veo 3 Fast', price: '$0.75' },
    { id: 'veo3', label: 'Veo 3', price: '$1.00' },
    { id: 'sora2-t2v', label: 'Sora 2', price: '$0.40' },
    { id: 'sora2-t2v-pro', label: 'Sora 2 Pro', price: '$2.00' }
  ],
  'i2v': [ // Image-to-Video
    { id: 'sora2-i2v', label: 'Sora 2 I2V', price: '$0.50' },
    { id: 'sora2-i2v-pro', label: 'Sora 2 I2V Pro', price: '$2.50' },
    { id: 'veo3-fast-i2v', label: 'Veo 3 Fast I2V', price: '$0.85' },
    { id: 'veo3-i2v', label: 'Veo 3 I2V', price: '$1.20' }
  ]
};

// Default models for each path
const DEFAULT_MODELS = {
  't2i': 'nano-banana',
  'i2i': 'nano-banana-edit',
  't2v': 'kling',
  'i2v': 'kling'
};

// Generate unique message ID
function generateMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Determine current generation path based on toggle and image context
function getCurrentPath() {
  const toggleCheckbox = document.getElementById('generation-type-toggle');
  const isVideo = toggleCheckbox ? toggleCheckbox.checked : false;
  const hasImageContext = imageContext.length > 0;

  if (!isVideo && !hasImageContext) return 't2i'; // Text-to-Image
  if (!isVideo && hasImageContext) return 'i2i'; // Image-to-Image (edit)
  if (isVideo && !hasImageContext) return 't2v'; // Text-to-Video
  if (isVideo && hasImageContext) return 'i2v'; // Image-to-Video
}

// Update model dropdown based on current path
function updateModelDropdown() {
  const modelSelect = document.getElementById('model-select');
  if (!modelSelect) return;

  const currentPath = getCurrentPath();
  const models = MODEL_CONFIGS[currentPath];
  const currentValue = modelSelect.value;

  // Clear existing options
  modelSelect.innerHTML = '';

  // Add new options
  models.forEach(model => {
    const option = document.createElement('option');
    option.value = model.id;
    option.textContent = `${model.label} (${model.price})`;
    modelSelect.appendChild(option);
  });

  // Try to preserve selection if the model exists in new path, otherwise use default
  const modelExists = models.some(m => m.id === currentValue);
  if (modelExists) {
    modelSelect.value = currentValue;
  } else {
    modelSelect.value = DEFAULT_MODELS[currentPath];
  }
}

// Handle image upload
async function handleImageUpload(event) {
  const files = Array.from(event.target.files);
  if (files.length === 0) return;

  // Show uploaded images in chat
  const uploadHTML = `
    <div class="mb-2">
      <p class="text-sm text-gray-600">📷 Uploaded ${files.length} image${files.length > 1 ? 's' : ''}</p>
      <div class="upload-preview-grid">
        ${files.map((file, i) => `
          <div class="upload-preview-item">
            <img id="upload-preview-${i}" alt="Upload ${i + 1}" />
          </div>
        `).join('')}
      </div>
    </div>
  `;
  appendMessage('assistant', uploadHTML);

  // Convert images to base64 and add to context
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    try {
      const base64 = await fileToBase64(file);

      // Update preview in chat
      const previewImg = document.getElementById(`upload-preview-${i}`);
      if (previewImg) {
        previewImg.src = base64;
      }

      // Add to context
      addImageToContext({
        id: `upload-${Date.now()}-${i}`,
        url: base64,
        source: 'upload',
        filename: file.name
      });
    } catch (error) {
      console.error('Error processing image:', error);
      appendMessage('error', `Failed to process ${file.name}`);
    }
  }

  // Reset file input
  event.target.value = '';
}

// Convert file to base64
function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Add image to context
function addImageToContext(image) {
  // Check if already in context
  if (imageContext.find(img => img.id === image.id)) {
    return;
  }

  imageContext.push(image);
  updateContextPreview();
  updateModelDropdown(); // Update model options based on new context
}

// Remove image from context
function removeImageFromContext(imageId) {
  imageContext = imageContext.filter(img => img.id !== imageId);

  // Remove selection indicator from generated images
  const imageItem = document.querySelector(`.image-item[data-image-id="${imageId}"]`);
  if (imageItem) {
    imageItem.classList.remove('selected');
  }

  updateContextPreview();
  updateModelDropdown(); // Update model options based on new context
}

// Clear all image context
function clearImageContext() {
  imageContext = [];

  // Remove all selection indicators
  document.querySelectorAll('.image-item.selected').forEach(item => {
    item.classList.remove('selected');
  });

  updateContextPreview();
  updateModelDropdown(); // Update model options based on new context
}

// Update context preview UI
function updateContextPreview() {
  const preview = document.getElementById('context-preview');
  const contextImagesEl = document.getElementById('context-images');
  const contextCount = document.getElementById('context-count');

  if (imageContext.length === 0) {
    preview.classList.add('hidden');
    return;
  }

  preview.classList.remove('hidden');
  contextCount.textContent = imageContext.length;

  contextImagesEl.innerHTML = imageContext.map(img => `
    <div class="context-thumb">
      <img src="${img.url}" alt="${img.source}" />
      <div class="context-thumb-remove" onclick="removeImageFromContext('${img.id}')">×</div>
    </div>
  `).join('');
}

// Toggle image selection (for generated images)
function toggleImageSelection(imageId, imageUrl) {
  const imageItem = document.querySelector(`.image-item[data-image-id="${imageId}"]`);
  if (!imageItem) return;

  const isSelected = imageItem.classList.contains('selected');

  if (isSelected) {
    // Deselect
    imageItem.classList.remove('selected');
    removeImageFromContext(imageId);
  } else {
    // Select
    imageItem.classList.add('selected');
    addImageToContext({
      id: imageId,
      url: imageUrl,
      source: 'generated'
    });
  }
}

// Send message to n8n webhook with timeout
async function sendMessage() {
  const input = document.getElementById('prompt-input');
  const sendButton = document.getElementById('send-button');
  const prompt = input.value.trim();
  const toggleCheckbox = document.getElementById('generation-type-toggle');
  const currentGenType = toggleCheckbox.checked ? 'video' : 'image';
  const modelSelect = document.getElementById('model-select');
  const selectedModel = modelSelect.value;

  if (!prompt || isGenerating) return;

  // Check if webhook URL is configured
  if (N8N_WEBHOOK_URL === 'YOUR_N8N_WEBHOOK_URL_HERE') {
    appendMessage('error', 'Please configure your n8n webhook URL in app.js');
    return;
  }

  // Disable input during generation
  isGenerating = true;
  input.disabled = true;
  sendButton.disabled = true;
  toggleCheckbox.disabled = true;
  modelSelect.disabled = true;

  // Clear input
  input.value = '';

  // Display user message
  appendMessage('user', prompt);

  // Determine timeout based on model and generation type
  const currentPath = getCurrentPath();
  let timeout = 120000; // Default 2 minutes

  // I2V and T2V with premium models need more time
  if (currentPath === 'i2v' || currentPath === 't2v') {
    if (selectedModel.includes('veo') || selectedModel.includes('sora')) {
      timeout = 300000; // 5 minutes for Veo/Sora
    } else {
      timeout = 180000; // 3 minutes for other video models
    }
  }

  // Show loading state with model info
  const loadingId = showLoading(currentGenType, selectedModel, currentPath);

  try {
    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('sessionId', sessionId);
    formData.append('generationType', currentGenType);
    formData.append('selectedModel', selectedModel);

    if (currentGenType === 'image') {
      formData.append('numImages', '4');
    }

    // Add image context if available
    if (imageContext.length > 0) {
      formData.append('imageContext', JSON.stringify(imageContext.map(img => ({
        id: img.id,
        url: img.url,
        source: img.source
      }))));
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      body: formData,
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Remove loading
    hideLoading(loadingId);

    // Display results
    if (data.phase === 'complete') {
      displayResults(data);
      // Clear image context after successful generation
      clearImageContext();
    } else {
      appendMessage('error', 'Unexpected response format from workflow');
    }

  } catch (error) {
    hideLoading(loadingId);
    console.error('Error:', error);

    // Provide better error messages based on error type
    if (error.name === 'AbortError') {
      appendMessage('error', `
        <p class="font-semibold mb-2">⏱️ Generation Timeout</p>
        <p class="text-sm">The generation is taking longer than expected. This can happen with ${selectedModel} on the ${currentPath.toUpperCase()} path.</p>
        <p class="text-sm mt-2"><strong>Good news:</strong> Your video is likely still being generated in the background! Check your n8n workflow executions to see the result.</p>
        <p class="text-sm mt-2 text-blue-600">💡 Tip: Premium video models (Veo, Sora) can take 2-3 minutes to generate.</p>
      `);
    } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
      appendMessage('error', `
        <p class="font-semibold mb-2">🌐 Network Error</p>
        <p class="text-sm">Unable to connect to the workflow. Please check:</p>
        <ul class="text-sm mt-2 list-disc list-inside space-y-1">
          <li>Your internet connection</li>
          <li>The webhook URL is correct</li>
          <li>The n8n workflow is active</li>
        </ul>
      `);
    } else {
      appendMessage('error', `
        <p class="font-semibold mb-2">❌ Error</p>
        <p class="text-sm">${error.message}</p>
        <p class="text-sm mt-2">Please check your webhook URL and n8n workflow.</p>
      `);
    }
  } finally {
    // Re-enable input
    isGenerating = false;
    input.disabled = false;
    sendButton.disabled = false;
    toggleCheckbox.disabled = false;
    modelSelect.disabled = false;
    input.focus();
  }
}

// Append message to chat
function appendMessage(type, content) {
  const container = document.getElementById('messages-container');
  const messageEl = document.createElement('div');

  if (type === 'user') {
    messageEl.className = 'message-user';
    messageEl.textContent = content;
  } else if (type === 'assistant') {
    messageEl.className = 'message-assistant';
    messageEl.innerHTML = content;
  } else if (type === 'error') {
    messageEl.className = 'message-error';
    messageEl.innerHTML = content;
  }

  container.appendChild(messageEl);
  container.scrollTop = container.scrollHeight;

  return messageEl;
}

// Show loading animation with model-specific timing
function showLoading(genType = 'image', model = '', path = 't2i') {
  const id = generateMessageId();
  const isVideo = genType === 'video';

  // Determine time estimate based on path and model
  let timeEstimate = '20-30 seconds';
  let durationSeconds = 25;
  let description = 'Enhancing prompt and creating 4 variations';

  if (path === 't2i') {
    timeEstimate = '20-30 seconds';
    durationSeconds = 25;
    description = 'Enhancing prompt and creating 4 variations';
  } else if (path === 'i2i') {
    timeEstimate = '25-35 seconds';
    durationSeconds = 30;
    description = 'Enhancing prompt and editing image';
  } else if (path === 't2v') {
    if (model.includes('sora')) {
      timeEstimate = '60-120 seconds';
      durationSeconds = 90;
      description = 'Enhancing prompt and creating high-quality video with Sora';
    } else if (model.includes('veo')) {
      timeEstimate = '60-120 seconds';
      durationSeconds = 90;
      description = 'Enhancing prompt and creating high-quality video with Veo';
    } else {
      timeEstimate = '30-60 seconds';
      durationSeconds = 45;
      description = 'Enhancing prompt and creating video';
    }
  } else if (path === 'i2v') {
    if (model.includes('sora')) {
      timeEstimate = '90-180 seconds';
      durationSeconds = 135;
      description = 'Enhancing prompt and animating image with Sora (this can take 2-3 minutes)';
    } else if (model.includes('veo')) {
      timeEstimate = '90-180 seconds';
      durationSeconds = 135;
      description = 'Enhancing prompt and animating image with Veo (this can take 2-3 minutes)';
    } else {
      timeEstimate = '40-90 seconds';
      durationSeconds = 65;
      description = 'Enhancing prompt and animating image';
    }
  }

  const loadingHTML = `
    <div id="${id}" class="loading-container">
      <div class="progress-circle">
        <svg viewBox="0 0 100 100">
          <circle class="progress-bg" cx="50" cy="50" r="45" />
          <circle id="progress-bar-${id}" class="progress-bar" cx="50" cy="50" r="45" />
        </svg>
        <div class="breathing-circle"></div>
      </div>
      <p class="loading-text">Generating ${isVideo ? 'video' : 'images'}... This may take ${timeEstimate}</p>
      <p class="text-xs text-gray-400 mt-2">${description}</p>
      ${path === 'i2v' && (model.includes('sora') || model.includes('veo')) ?
        '<p class="text-xs text-blue-500 mt-2 font-medium">⏱️ Please be patient - premium video models take longer but deliver exceptional quality!</p>' :
        ''}
    </div>
  `;

  appendMessage('assistant', loadingHTML);

  // Animate progress (fake progress for UX)
  animateProgress(id, durationSeconds);

  return id;
}

// Hide loading
function hideLoading(id) {
  const el = document.getElementById(id);
  if (el && el.parentElement) {
    el.parentElement.remove();
  }
}

// Animate progress circle
function animateProgress(id, durationSeconds) {
  const progressBar = document.getElementById(`progress-bar-${id}`);
  if (!progressBar) return;

  const steps = durationSeconds * 10; // 10 updates per second
  let currentStep = 0;

  const interval = setInterval(() => {
    currentStep++;
    const progress = Math.min((currentStep / steps) * 100, 95); // Cap at 95% until real completion
    const offset = 283 - (283 * progress / 100);
    progressBar.style.strokeDashoffset = offset;

    if (currentStep >= steps) {
      clearInterval(interval);
    }
  }, 100);
}

// Display results (images or video)
function displayResults(data) {
  // Update session cost
  if (data.cost && data.cost.current !== undefined) {
    sessionTotalCost += data.cost.current;
    document.getElementById('session-cost').textContent = `$${sessionTotalCost.toFixed(3)}`;
  }

  // Build result HTML
  let resultHTML = '';

  if (data.type === 'image' && data.content && data.content.images && data.content.images.length > 0) {
    const images = data.content.images;
    const currentCost = data.cost && data.cost.current ? data.cost.current.toFixed(3) : '0.000';
    const enhancedPrompt = data.metadata && data.metadata.enhancedPrompt ? data.metadata.enhancedPrompt : '';

    resultHTML = `
      <div class="mb-3">
        <p class="text-gray-700 font-medium mb-1">✨ Generated ${images.length} professional images!</p>
        <p class="text-xs text-blue-600 mt-1">💡 Click any image to select it for your next prompt</p>
        ${enhancedPrompt ? `<p class="text-xs text-gray-500 italic mt-2">Enhanced prompt: ${enhancedPrompt}</p>` : ''}
      </div>
      <div class="image-grid">
        ${images.map((img, i) => `
          <div class="image-item" data-image-id="${img.id || i}" onclick="toggleImageSelection('${img.id || i}', '${img.url}')">
            <img src="${img.url}" alt="Generated image ${i + 1}" loading="lazy" />
            <div class="image-actions">
              <button class="action-btn" onclick="event.stopPropagation(); downloadImage('${img.url}', ${i + 1})">
                ⬇️ Download
              </button>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="mt-3 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="cost-badge">Cost: $${currentCost}</div>
          ${data.metadata && data.metadata.modelName ? `<div class="text-xs text-gray-500" style="padding: 4px 0;">Model: ${data.metadata.modelName}</div>` : ''}
        </div>
        <button
          class="text-sm text-blue-600 hover:text-blue-700 font-medium"
          onclick="downloadAllImages()"
        >
          📦 Download All
        </button>
      </div>
    `;

  } else if (data.type === 'video' && data.content && data.content.video) {
    const video = data.content.video;
    const currentCost = data.cost && data.cost.current ? data.cost.current.toFixed(3) : '0.000';
    const enhancedPrompt = data.metadata && data.metadata.enhancedPrompt ? data.metadata.enhancedPrompt : '';

    resultHTML = `
      <div class="mb-3">
        <p class="text-gray-700 font-medium mb-1">🎬 Generated professional video!</p>
        ${enhancedPrompt ? `<p class="text-xs text-gray-500 italic mt-2">Enhanced prompt: ${enhancedPrompt}</p>` : ''}
      </div>
      <div class="video-container">
        <video controls loop>
          <source src="${video.url}" type="video/mp4">
          Your browser does not support the video tag.
        </video>
      </div>
      <div class="mt-3 flex items-center justify-between">
        <div class="flex items-center gap-3">
          <div class="cost-badge">Cost: $${currentCost}</div>
          ${data.metadata && data.metadata.modelName ? `<div class="text-xs text-gray-500" style="padding: 4px 0;">Model: ${data.metadata.modelName}</div>` : ''}
        </div>
        <button
          class="text-sm text-blue-600 hover:text-blue-700 font-medium"
          onclick="downloadVideo('${video.url}')"
        >
          ⬇️ Download Video
        </button>
      </div>
    `;

  } else {
    resultHTML = '<p class="text-gray-700">Generation completed but no content was returned.</p>';
  }

  appendMessage('assistant', resultHTML);
}

// Download single image
function downloadImage(url, index) {
  const link = document.createElement('a');
  link.href = url;
  link.download = `fcinq-image-${index}-${Date.now()}.jpg`;
  link.target = '_blank';
  link.click();
}

// Download all images
function downloadAllImages() {
  const images = document.querySelectorAll('.image-item img');
  images.forEach((img, i) => {
    setTimeout(() => {
      downloadImage(img.src, i + 1);
    }, i * 500); // Stagger downloads by 500ms
  });
}

// Download video
function downloadVideo(url) {
  const link = document.createElement('a');
  link.href = url;
  link.download = `fcinq-video-${Date.now()}.mp4`;
  link.target = '_blank';
  link.click();
}

// Update hint text based on toggle state
function updateHintText() {
  const toggle = document.getElementById('generation-type-toggle');
  const hintText = document.getElementById('hint-text');

  if (toggle.checked) {
    // Video mode
    hintText.textContent = 'Try: "smooth camera movement around a luxury product" or "dynamic brand presentation with elegant transitions"';
  } else {
    // Image mode
    hintText.textContent = 'Try: "professional product photography with dramatic lighting" or "minimalist brand visual with clean composition"';
  }

  // Update model dropdown when toggle changes
  updateModelDropdown();
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Show welcome message
  appendMessage('assistant', `
    <div>
      <p class="text-gray-700 font-medium">👋 Welcome to FCINQ Platform!</p>
      <p class="text-sm text-gray-600 mt-2">Generate professional images and videos for your creative projects using AI.</p>
      <p class="text-sm text-gray-500 mt-3">Try saying:</p>
      <ul class="text-sm text-gray-500 mt-2 space-y-1 list-disc list-inside">
        <li>"Create a sophisticated product showcase with warm lighting"</li>
        <li>"Modern minimalist brand visual with clean composition"</li>
        <li>"Cinematic product reveal with dramatic shadows"</li>
      </ul>
      <p class="text-xs text-blue-600 mt-3">💡 Toggle between Image and Video mode to choose your output type</p>
      <p class="text-xs text-blue-600 mt-2">📷 Upload images or click generated images to use as context for your next prompt</p>
      ${N8N_WEBHOOK_URL === 'YOUR_N8N_WEBHOOK_URL_HERE' ?
        '<p class="text-sm text-red-600 mt-3 font-medium">⚠️ Please configure your n8n webhook URL in app.js</p>' :
        '<p class="text-xs text-green-600 mt-3">✓ Connected to workflow</p>'
      }
    </div>
  `);

  // Add toggle event listener
  const toggle = document.getElementById('generation-type-toggle');
  toggle.addEventListener('change', updateHintText);

  // Initialize model dropdown
  updateModelDropdown();

  // Focus input
  document.getElementById('prompt-input').focus();
});
