// Configuration - UPDATE THIS WITH YOUR n8n WEBHOOK URL
const N8N_WEBHOOK_URL = 'https://erolp.app.n8n.cloud/webhook/fcinq-chat-form'; 

// Session management
let sessionId = localStorage.getItem('sessionId') || `session-${Date.now()}`;
localStorage.setItem('sessionId', sessionId);

let sessionTotalCost = 0;
let isGenerating = false;
let generationType = 'image'; // Default to image

// Generate unique message ID
function generateMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Send message to n8n webhook
async function sendMessage() {
  const input = document.getElementById('prompt-input');
  const sendButton = document.getElementById('send-button');
  const prompt = input.value.trim();
  const toggleCheckbox = document.getElementById('generation-type-toggle');
  const currentGenType = toggleCheckbox.checked ? 'video' : 'image';

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

  // Clear input
  input.value = '';

  // Display user message
  appendMessage('user', prompt);

  // Show loading state
  const loadingId = showLoading(currentGenType);

  try {
    const formData = new FormData();
    formData.append('prompt', prompt);
    formData.append('sessionId', sessionId);
    formData.append('generationType', currentGenType);

    if (currentGenType === 'image') {
      formData.append('numImages', '4');
    }

    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Remove loading
    hideLoading(loadingId);

    // Display results
    if (data.phase === 'complete') {
      displayResults(data);
    } else {
      appendMessage('error', 'Unexpected response format from workflow');
    }

  } catch (error) {
    hideLoading(loadingId);
    console.error('Error:', error);
    appendMessage('error', `Error: ${error.message}. Please check your webhook URL and n8n workflow.`);
  } finally {
    // Re-enable input
    isGenerating = false;
    input.disabled = false;
    sendButton.disabled = false;
    toggleCheckbox.disabled = false;
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

// Show loading animation
function showLoading(genType = 'image') {
  const id = generateMessageId();
  const isVideo = genType === 'video';
  const loadingHTML = `
    <div id="${id}" class="loading-container">
      <div class="progress-circle">
        <svg viewBox="0 0 100 100">
          <circle class="progress-bg" cx="50" cy="50" r="45" />
          <circle id="progress-bar-${id}" class="progress-bar" cx="50" cy="50" r="45" />
        </svg>
        <div class="breathing-circle"></div>
      </div>
      <p class="loading-text">Generating ${isVideo ? 'video' : 'images'}... This may take ${isVideo ? '30-90' : '20-30'} seconds</p>
      <p class="text-xs text-gray-400 mt-2">${isVideo ? 'Enhancing prompt and creating video' : 'Enhancing prompt and creating 4 variations'}</p>
    </div>
  `;

  appendMessage('assistant', loadingHTML);

  // Animate progress (fake progress for UX)
  animateProgress(id, isVideo ? 60 : 25);

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
  if (data.cost && data.cost.session !== undefined) {
    sessionTotalCost = data.cost.session;
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
        ${enhancedPrompt ? `<p class="text-xs text-gray-500 italic mt-2">Enhanced prompt: ${enhancedPrompt}</p>` : ''}
      </div>
      <div class="image-grid">
        ${images.map((img, i) => `
          <div class="image-item" data-image-id="${img.id || i}">
            <img src="${img.url}" alt="Generated image ${i + 1}" loading="lazy" />
            <div class="image-actions">
              <button class="action-btn" onclick="downloadImage('${img.url}', ${i + 1})">
                ⬇️ Download
              </button>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="mt-3 flex items-center justify-between">
        <div class="cost-badge">Cost: $${currentCost}</div>
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
        <div class="cost-badge">Cost: $${currentCost}</div>
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
      ${N8N_WEBHOOK_URL === 'YOUR_N8N_WEBHOOK_URL_HERE' ?
        '<p class="text-sm text-red-600 mt-3 font-medium">⚠️ Please configure your n8n webhook URL in app.js</p>' :
        '<p class="text-xs text-green-600 mt-3">✓ Connected to workflow</p>'
      }
    </div>
  `);

  // Add toggle event listener
  const toggle = document.getElementById('generation-type-toggle');
  toggle.addEventListener('change', updateHintText);

  // Focus input
  document.getElementById('prompt-input').focus();
});
