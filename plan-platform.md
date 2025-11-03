# Multi-Modal AI Chatbot - Definitive Implementation Guide

## 📋 Project Overview

**Goal**: Build a ChatGPT-style interface for generating professional product display images (glasses/eyewear) and 360° videos using AI. Users type simple prompts → AI enhances them → generates 4 high-quality images or videos → users can iterate or convert images to videos.

**Tech Stack**:
- **Frontend**: Vanilla JS + Tailwind CSS (hosted on Vercel)
- **Backend**: n8n workflow automation
- **AI Models**: 
  - Prompt enhancement: Claude 3.5 Sonnet (via OpenRouter)
  - Image generation: fal.ai/imagen4/preview/ultra
  - Video generation: fal.ai/kling-video/v2.5-turbo
  - Image editing: fal.ai/gemini-25-flash-image/edit

**Cost Per Generation**:
- Image (4x): ~$0.40 (imagen4 ultra)
- Video: ~$0.60 (kling v2.5 turbo)
- Prompt enhancement: ~$0.005 (Claude 3.5 Sonnet)

---

## 🏗️ System Architecture

```
┌────────────────────────────────────────────────────────┐
│         Chat UI (Vercel)                               │
│  - Text input                                          │
│  - Message history                                     │
│  - Loading states ("Thinking...", progress circles)   │
│  - Inline image/video display                         │
│  - Cost tracker display                               │
└───────────────────┬────────────────────────────────────┘
                    │ HTTP POST
                    ▼
┌────────────────────────────────────────────────────────┐
│         n8n Workflow (Webhook Entry)                   │
├────────────────────────────────────────────────────────┤
│                                                        │
│  [1] Webhook Trigger                                   │
│       ↓                                                │
│  [2] Session Manager (load history)                    │
│       ↓                                                │
│  [3] AI Router (fast LLM: image/video/edit?)          │
│       ↓                                                │
│  [4] Send "Thinking" Response → UI                     │
│       ↓                                                │
│  [5] Switch: Route by type                            │
│       ├→ IMAGE → [6] Enhance Prompt (4 variations)    │
│       │           ↓                                    │
│       │          [7] Generate 4 Images (fal.ai)       │
│       │           ↓                                    │
│       │          [8] Poll Until Complete              │
│       │                                                │
│       ├→ VIDEO → [9] Enhance Video Prompt             │
│       │           ↓                                    │
│       │          [10] Generate Video (fal.ai)         │
│       │           ↓                                    │
│       │          [11] Poll Until Complete             │
│       │                                                │
│       └→ IMAGE_TO_VIDEO → [12] Load Selected Image    │
│                             ↓                          │
│                            [13] Enhance + Generate    │
│                                                        │
│  [14] Calculate Cost                                   │
│       ↓                                                │
│  [15] Update Session State                            │
│       ↓                                                │
│  [16] Format Response (images/video + cost)           │
│       ↓                                                │
│  [17] Return to UI                                     │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## 🔧 Step-by-Step Node Implementation

### STEP 1: Webhook Entry Point

**Node: "Webhook Trigger"** (`n8n-nodes-base.webhook`)
- **HTTP Method**: POST
- **Path**: `/webhook/chat` (e.g., `https://your-n8n.com/webhook/chat`)
- **Response Mode**: "Using 'Respond to Webhook' Node"
- **Request Body**:
  ```json
  {
    "prompt": "create a glasses product display image",
    "sessionId": "user-123-timestamp",
    "selectedImageId": null  // For image-to-video operations
  }
  ```

---

### STEP 2: Session Manager

**Node: "Load Session State"** (`n8n-nodes-base.code`)

**Purpose**: Manage persistent conversation state across multiple user interactions. This enables the chatbot to reference previous generations and maintain context.

**What This Node Does**:
1. Accesses n8n's static data storage (`$workflow.staticData`) as a simple in-memory database
2. Extracts incoming data: `sessionId`, `userPrompt`, `selectedImageId` from webhook body
3. Loads existing session or creates new one with structure:
   - `messages[]` - conversation history (user + assistant)
   - `generatedAssets[]` - all images/videos created in this session
   - `totalCost` - running cost tracker
   - `createdAt` - session start timestamp
4. Appends current user message to history
5. Returns combined session context + current request data

**Storage Strategy**:
- **MVP**: Use n8n static data (zero setup, persists across executions)
- **Limitations**: Single-instance only, cleared on workflow deactivation
- **Cleanup**: Automatically remove sessions older than 24 hours to prevent memory bloat
- **Future**: Migrate to Redis when scaling beyond 500 sessions

**Recommended Tool**: `get_node_essentials('n8n-nodes-base.code')` to understand Code node capabilities

**Data Structure Design**:
```
Session Object:
{
  sessionId: string (unique per user/browser)
  messages: [{ role, content, timestamp }]
  generatedAssets: [{ id, type, images, video, cost, timestamp }]
  totalCost: number (running sum)
  createdAt: timestamp
}
```

**Output to Next Node**: Complete session context merged with current request

---

### STEP 3: AI Intent Router (Fast LLM)

**Node: "Determine Generation Mode"** (`n8n-nodes-base.httpRequest`)

**Purpose**: Use a fast LLM to analyze the user's request and determine the appropriate generation pipeline (image, video, image-to-video, or edit). This creates the "Thinking..." → "Switching to X mode..." UX flow.

**What This Node Does**:
1. Calls OpenRouter API with Claude 3.5 Sonnet (fast, accurate routing)
2. Sends system prompt that defines routing logic:
   - Keywords "video", "360", "rotate" → video mode
   - User references existing image → image_to_video mode
   - Edit/modify keywords → edit mode
   - Default → image mode
3. Requests structured JSON response with:
   - `mode`: The generation type
   - `reasoning`: Why this mode was chosen
   - `userMessage`: What to tell the user ("Switching to image generation mode...")

**Why This Approach**:
- Fast response (~3-5 seconds) maintains ChatGPT-like UX
- Structured output ensures consistent parsing
- User sees AI "thinking" and explaining what it's doing
- Sets up the generation pipeline correctly

**API Configuration**:
- **Endpoint**: `https://openrouter.ai/api/v1/chat/completions`
- **Model**: `anthropic/claude-3-5-sonnet-20241022`
- **Auth**: Header authentication with OpenRouter API key
- **Required Headers**: `HTTP-Referer` (your domain) and `X-Title` (app name)
- **Response Format**: JSON object
- **Temperature**: 0.2 (low variance, consistent routing)

**Recommended Tool**: `get_node_essentials('n8n-nodes-base.httpRequest', {includeExamples: true})` for HTTP Request configuration patterns

**Output to Next Node**: JSON with `{ mode, reasoning, userMessage }`

---

### STEP 4: Send "Thinking" Response

**Node: "Respond - Thinking"** (`n8n-nodes-base.respondToWebhook`)

**Purpose**: Immediately send the AI's routing decision back to the frontend so users see the "Thinking..." message update to "Switching to image generation mode..." This creates the ChatGPT-like streaming effect.

**What This Node Does**:
1. Extracts the `userMessage` from the AI Router's response
2. Formats as JSON response with phase indicator
3. Sends back to the waiting HTTP client (frontend)
4. Allows workflow to continue processing (doesn't terminate execution)

**Why This Pattern**:
- Users get immediate feedback (3-5 seconds vs 30-60 seconds)
- Creates professional UX expectation ("It's working on it...")
- Frontend knows which mode is active (can show appropriate loading UI)

**Configuration Notes**:
- **Respond With**: JSON
- **Response Code**: 200
- Include `mode` field so frontend knows what to expect (images or video)

**Recommended Tool**: `get_node_essentials('n8n-nodes-base.respondToWebhook')` to understand webhook response patterns

**Output Structure**:
```
{
  phase: "thinking",
  message: "I'll create 4 professional product images...",
  mode: "image"
}
```

---

### STEP 5: Route by Mode

**Node: "Route by Generation Mode"** (`n8n-nodes-base.switch`)

**Purpose**: Branch the workflow into different paths based on the generation mode determined by the AI Router. This is the core logic fork of the entire system.

**What This Node Does**:
1. Reads the `mode` field from AI Router output
2. Routes execution to the appropriate branch:
   - **"image"** → Prompt enhancement for 4-variation images
   - **"video"** → Video-specific prompt enhancement
   - **"image_to_video"** → Load selected image + video enhancement
   - **"edit"** → Image editing flow (future feature)

**Switch Configuration**:
- **Mode**: Rules-based routing
- **Evaluation**: Check the `mode` string value
- **Outputs**: 4 named outputs (image, video, image_to_video, edit)

**Why Switch Over IF Nodes**:
- Cleaner visual workflow (single routing point vs chained IFs)
- Each mode gets dedicated downstream path
- Easier to add new modes (just add output)

**Recommended Tool**: `get_node_essentials('n8n-nodes-base.switch', {includeExamples: true})` to see routing patterns

**Downstream Paths**:
- Image path → Step 6
- Video path → Step 9  
- Image-to-video path → Step 12
- Edit path → (not implemented in MVP)

---

### STEP 6: Image Prompt Enhancement (4 Variations)

**Node: "Generate 4 Image Prompts"** (`n8n-nodes-base.httpRequest`)

**Purpose**: Transform the user's simple request into 4 professional, detailed photography prompts. This replicates your current tool's behavior where one input produces 4 uniquely different but thematically related images.

**What This Node Does**:
1. Calls OpenRouter with Claude 3.5 Sonnet for detailed prompt engineering
2. Sends comprehensive system prompt that:
   - Teaches the LLM product photography vocabulary and best practices
   - Instructs creation of **4 variations** of the same concept
   - Defines variation axes: camera angle, lighting, composition, material focus
   - Provides examples of the exact style and detail level needed
3. Returns structured JSON with array of 4 prompts (150-250 words each)

**The 4-Variation Strategy**:
Each prompt shares the core concept but varies in:
- **Camera Angle**: three-quarter, straight-on, overhead, close-up detail
- **Lighting Style**: soft diffused, directional with shadows, high-key bright, rim lighting
- **Composition**: centered, rule of thirds, negative space, tight crop
- **Focus Area**: overall product, material texture, engineering detail, artistic mood

**Example Transformation**:
```
User Input: "create professional glasses display"

Output (4 prompts):
1. "Three-quarter angle, soft diffused lighting, centered composition..."
2. "Frontal straight-on, high-key lighting, symmetrical composition..."
3. "Overhead angle, directional shadows, rule of thirds..."
4. "Macro close-up, detail focus on hinges, tight crop..."
```

**Why This Approach Works**:
- Single API call (cost-effective: ~$0.005)
- Consistent quality across all 4 variations
- LLM understands photography principles
- Structured output ensures reliable parsing
- Temperature 0.7 provides creative variation while maintaining coherence

**System Prompt Design Principles**:
1. **Vocabulary**: Use professional photography terms ("tack-sharp focus", "graduated shadows", "catalog-quality")
2. **Technical specs**: Always mention lighting setup, camera settings, background
3. **Consistency**: All 4 must relate to the same product/concept
4. **Variation**: Each must be distinctly different (different angles/lighting)
5. **Examples**: Provide 1-2 full examples in the system prompt to teach the pattern

**API Configuration**:
- **Endpoint**: `https://openrouter.ai/api/v1/chat/completions`
- **Model**: `anthropic/claude-3-5-sonnet-20241022`
- **Response Format**: JSON object with `prompts` array
- **Temperature**: 0.7 (creative but controlled)
- **Max Tokens**: 2000 (enough for 4 detailed prompts)

**Recommended Tools**:
- `get_node_documentation('n8n-nodes-base.httpRequest')` for detailed HTTP Request patterns
- Study the example prompts in your current tool to calibrate vocabulary

**Output to Next Node**: JSON with `{ prompts: [string, string, string, string] }`

### STEP 7: Generate 4 Images (fal.ai)

**Node: "Generate Images - fal.ai"** (`n8n-nodes-base.code`)

**Purpose**: Take the 4 enhanced prompts and initiate parallel image generation requests to fal.ai's imagen4 ultra model. This is the core image generation step.

**What This Node Does**:
1. Parses the 4 prompts from Step 6
2. Creates 4 parallel API requests to fal.ai (not sequential - all at once)
3. Each request initiates async generation (returns `request_id` immediately)
4. Collects all 4 request IDs with their associated prompts
5. Passes to polling node for status checking

**Why Parallel Generation**:
- **Speed**: All 4 start simultaneously (vs waiting 30s × 4 = 2 minutes)
- **Cost**: No price difference between parallel and sequential
- **UX**: User waits ~30 seconds total, not 2 minutes

**fal.ai API Details**:
- **Endpoint**: `https://fal.run/fal-ai/imagen4/preview/ultra`
- **Model**: imagen4 ultra (Google's latest, high quality)
- **Auth**: Header `Authorization: Key YOUR_FAL_KEY` (note: "Key" not "Bearer")
- **Mode**: Async (sync_mode: false) - returns request_id for polling
- **Cost**: ~$0.10 per image = $0.40 total

**Request Parameters**:
- `prompt`: The enhanced prompt string (150-250 words)
- `image_size`: `"landscape_4_3"` (standard product photography aspect)
- `num_inference_steps`: 25 (quality vs speed balance)
- `guidance_scale`: 4.5 (prompt adherence)
- `enable_safety_checker`: true (content moderation)

**Code Node Pattern**: Use JavaScript `Promise.all()` to execute 4 fetch requests in parallel

**Recommended Tools**:
- `get_node_essentials('n8n-nodes-base.code')` for Code node capabilities
- Review fal.ai docs for imagen4: https://fal.ai/models/fal-ai/imagen4/preview/ultra

**Output to Next Node**: Array of `{ requestId, prompt, index }` objects

---

### STEP 8: Poll Image Generation Status

**Node: "Poll Image Generation"** (`n8n-nodes-base.code`)

**Purpose**: Continuously check fal.ai's status endpoint until all 4 images complete generating. This handles the async nature of AI image generation.

**What This Node Does**:
1. Takes the 4 request IDs from Step 7
2. Sets up polling loop (check every 2 seconds, max 60 seconds)
3. For each request, calls fal.ai status endpoint: `GET /requests/{requestId}`
4. Checks status: `IN_QUEUE` → `IN_PROGRESS` → `COMPLETED` or `FAILED`
5. Once all 4 complete, extracts image URLs and metadata
6. Returns unified result with all 4 images

**Polling Strategy**:
- **Interval**: 2 seconds (balance between responsiveness and API rate limits)
- **Timeout**: 30 attempts = 60 seconds total (imagen4 typically takes 20-40s)
- **Parallel**: Poll all 4 simultaneously (again, not sequential)
- **Error Handling**: If any fail, the whole operation fails with clear error

**Status Endpoint**: `https://fal.run/fal-ai/imagen4/preview/ultra/requests/{requestId}`

**Why Polling Not Webhooks**:
- Simpler implementation (no webhook infrastructure needed)
- fal.ai supports polling natively
- Acceptable latency for MVP (~30-60 seconds is expected for AI image gen)
- Future: Can add webhook support for instant completion notifications

**Output Structure**:
```
{
  images: [
    { url, width, height, prompt, index, id },
    { url, width, height, prompt, index, id },
    { url, width, height, prompt, index, id },
    { url, width, height, prompt, index, id }
  ],
  mode: "image",
  cost: 0.40
}
```

**Recommended Pattern**: Use `async/await` with `Promise.all()` for parallel polling

**Output to Next Node**: Array of 4 completed images with URLs and metadata

---

### STEP 9: Video Prompt Enhancement

**Node: "Generate Video Prompt"** (`n8n-nodes-base.httpRequest`)

**Purpose**: Transform user's video request into a detailed, motion-focused prompt optimized for AI video generation. Different from image prompts - emphasizes movement, camera paths, and temporal elements.

**What This Node Does**:
1. Calls OpenRouter with Claude 3.5 Sonnet (same as image enhancement)
2. Uses video-specific system prompt that teaches:
   - Motion vocabulary ("360° orbital rotation", "smooth camera movement")
   - Temporal elements ("5-second duration", "seamless loop")
   - Camera movement ("dolly forward", "static with object rotation")
   - Lighting consistency during motion
3. Returns single detailed prompt (150-200 words) optimized for video models

**Key Differences from Image Prompts**:
- **ONE prompt** not four (video generation is slower/more expensive)
- **Motion description**: Rotation direction, speed, camera path
- **Duration**: Specify desired length (typically 5 seconds)
- **Loop consideration**: "Seamless loop capability" for continuous playback
- **Consistency**: Emphasize lighting/background stays constant during motion

**Example Transformation**:
```
User: "make a 360 video of these glasses"
↓
Enhanced: "360-degree clockwise orbital rotation showcasing designer 
eyeglasses against pure white background. Camera moves smoothly around 
stationary product at constant speed, completing full rotation in 5 
seconds. Product centered throughout. Soft studio lighting remains 
consistent, maintaining graduated shadows beneath frame. As camera 
orbits, each angle reveals different aspects: front profile, 
three-quarter views, side profile. Motion is fluid with no jerky 
movements. Suitable for e-commerce and seamless looping."
```

**API Configuration**: Same as Step 3/6 (OpenRouter)
- Temperature: 0.6 (slightly lower for consistent motion descriptions)
- Max Tokens: 500 (single prompt, not 4)

**Output to Next Node**: JSON with `{ prompt: string }`

---

### STEP 10: Generate Video (fal.ai Text-to-Video)

**Node: "Generate Video - fal.ai"** (`n8n-nodes-base.code`)

**Purpose**: Initiate video generation from the enhanced prompt using fal.ai's kling v2.5 turbo pro model.

**What This Node Does**:
1. Takes enhanced video prompt from Step 9
2. Calls fal.ai text-to-video endpoint
3. Configures: 5-second duration, 16:9 aspect ratio, quality settings
4. Receives `request_id` for async generation
5. Passes to polling node

**fal.ai Video API Details**:
- **Endpoint**: `https://fal.run/fal-ai/kling-video/v2.5-turbo/pro/text-to-video`
- **Model**: kling v2.5 turbo pro (fast, high-quality video generation)
- **Duration**: "5" seconds (string, not number)
- **Aspect Ratio**: "16:9" (standard widescreen)
- **Cost**: ~$0.60 per video

**Expected Generation Time**: 60-120 seconds (longer than images)

**Output to Next Node**: `{ requestId, prompt, mode: 'video', startTime }`

---

### STEP 11: Poll Video Generation Status

**Node: "Poll Video Generation"** (`n8n-nodes-base.code`)

**Purpose**: Check video generation status until complete. Similar to Step 8 but with longer timeout.

**What This Node Does**:
1. Polls fal.ai video status endpoint every 2 seconds
2. Max attempts: 60 (120 seconds total timeout)
3. Waits for status: `IN_QUEUE` → `IN_PROGRESS` → `COMPLETED`
4. Returns video URL and metadata when complete

**Polling Differences from Images**:
- **Longer timeout**: 120 seconds vs 60 (videos take longer)
- **Optional progress updates**: Send interim updates to frontend every 10 seconds
- **Same pattern**: Async/await loop checking status

**Status Endpoint**: `https://fal.run/fal-ai/kling-video/v2.5-turbo/pro/text-to-video/requests/{requestId}`

**Output Structure**:
```
{
  video: { url, width, height, duration },
  prompt: string,
  mode: "video",
  cost: 0.60
}
```

---

### STEP 12: Image-to-Video Flow - Load Selected Image

**Node: "Load Selected Image"** (`n8n-nodes-base.code`)

**Purpose**: When user clicks "Make Video" on a generated image, retrieve that image's data from session history.

**What This Node Does**:
1. Extracts `selectedImageId` from webhook request
2. Searches session's `generatedAssets` for matching image
3. Returns image URL and metadata
4. Validates image exists (error if not found)

**Data Flow**:
```
Frontend clicks "Make Video" on image 2
  → Sends { selectedImageId: "img-1234-2" }
  → Session manager loads history
  → This node finds image with ID "img-1234-2"
  → Passes image URL to Step 13
```

**Error Handling**: If image ID not found, return user-friendly error: "Selected image not found. Please try again."

**Output to Next Node**: `{ selectedImage: {url, prompt, ...}, userPrompt }`

---

### STEP 13: Generate Video from Image

**Node: "Image-to-Video - fal.ai"** (`n8n-nodes-base.code`)

**Purpose**: Generate video using selected image as the starting frame. Different API endpoint than text-to-video.

**What This Node Does**:
1. Takes selected image URL from Step 12
2. Takes enhanced video prompt from Step 9
3. Calls fal.ai **image-to-video** endpoint (not text-to-video)
4. Passes image URL + motion instructions
5. Returns request_id for polling

**fal.ai Image-to-Video API**:
- **Endpoint**: `https://fal.run/fal-ai/kling-video/v2.5-turbo/standard/image-to-video`
- **Note**: "standard" not "pro" (image-to-video uses standard tier)
- **Input**: `image_url` + `prompt` (motion instructions)
- **Cost**: ~$0.40 (cheaper than text-to-video)

**Key Difference**: The image provides the visual content; prompt only describes motion/camera movement

**Uses Same Polling**: After this, use Step 11's polling logic (same endpoints, just different generation mode)

**Output to Next Node**: `{ requestId, prompt, sourceImageUrl, mode: 'image_to_video' }`

---

### STEP 14: Calculate Total Cost

**Node: "Calculate Cost"** (`n8n-nodes-base.set`)

**Purpose**: Add cost metadata for transparency and budget tracking. Shows users what they're spending per generation.

**What This Node Does**:
1. Takes generation cost from previous node (Step 8 or 11 or 13)
2. Adds prompt enhancement cost (~$0.005)
3. Calculates total for this generation
4. Creates breakdown object for display

**Cost Components**:
- **Prompt Enhancement**: Fixed $0.005 (Claude 3.5 Sonnet)
- **Image Generation**: $0.40 (imagen4 ultra, 4 images @ $0.10 each)
- **Video Generation**: $0.60 (kling v2.5 turbo pro)
- **Image-to-Video**: $0.40 (kling v2.5 turbo standard)

**Node Type**: Use SET node (simpler than Code for data manipulation)

**Fields to Set**:
- `promptEnhancementCost`: 0.005
- `generationCost`: from previous node
- `totalCost`: sum of both
- `costBreakdown`: object with model names and per-item costs

**Recommended Tool**: `get_node_essentials('n8n-nodes-base.set')` for data transformation patterns

**Output to Next Node**: Enhanced data with cost metadata

---

### STEP 15: Update Session State

**Node: "Save to Session"** (`n8n-nodes-base.code`)

**Purpose**: Persist the generation results to session storage so user can reference/reuse them later. Also maintains conversation history.

**What This Node Does**:
1. Accesses session from global static data (created in Step 2)
2. Creates asset object with:
   - Generated content (images or video)
   - Prompts used
   - Cost
   - Timestamp
   - Unique ID
3. Appends to `generatedAssets[]` array
4. Updates `totalCost` (running sum for session)
5. Adds assistant message to conversation history
6. **Cleanup**: Removes sessions older than 24 hours (prevents memory bloat)

**Session Cleanup Logic**:
```
For each session in global storage:
  If (now - session.createdAt) > 24 hours:
    Delete session
```

**Why This Matters**:
- Enables image-to-video flow (reference past generations)
- Tracks spending per session
- Maintains context for user ("show me the images from earlier")

**Output to Next Node**: Complete asset object + session totals

---

### STEP 16: Format Final Response

**Node: "Format Response"** (`n8n-nodes-base.set`)

**Purpose**: Transform internal workflow data into clean, UI-ready JSON structure that frontend expects.

**What This Node Does**:
1. Strips away internal workflow metadata
2. Creates clean response object with:
   - Phase: "complete"
   - Content: images array OR video object
   - Actions: buttons/options for user ("Make Video", "Download", etc.)
   - Cost: current + session total + breakdown
   - Metadata: generation time, model used
3. Ensures consistent structure regardless of generation type

**Response Structure**:
```
{
  phase: "complete",
  type: "image" | "video" | "image_to_video",
  content: {
    images: [ /* if type=image */ ],
    video: { /* if type=video */ },
    actions: [ /* buttons for UI */ ]
  },
  cost: {
    current: 0.405,
    session: 1.25,
    breakdown: { ... }
  },
  metadata: {
    generationTime: "32s",
    model: "imagen4/ultra"
  }
}
```

**Action Buttons Logic**:
- For images: Include "Generate 360° video" for each image + "Download all"
- For video: Just "Download"

**Use SET Node**: Keep only the fields needed, drop internal workflow data

**Output to Next Node**: Clean, UI-ready JSON

---

### STEP 17: Return to UI

**Node: "Respond to Webhook"** (`n8n-nodes-base.respondToWebhook`)

**Purpose**: Send the final response back to the frontend, completing the HTTP request cycle.

**What This Node Does**:
1. Takes formatted response from Step 16
2. Sends as JSON response
3. Sets proper HTTP headers (Content-Type: application/json)
4. Closes the webhook connection
5. **Ends workflow execution**

**Why Separate from Step 4**:
- Step 4 sends interim "thinking" response
- This sends final "complete" response
- n8n allows multiple webhook responses in one workflow

**Response Code**: 200 (success) or 500 (if errors occurred)

**Recommended Tool**: `get_node_essentials('n8n-nodes-base.respondToWebhook')` for response patterns

**Final Output**: JSON sent to frontend → displayed in chat interface

---

## 🎨 Frontend Implementation (Vercel)

### File Structure
```
vercel-app/
├── index.html       # Main chat interface
├── style.css        # Styling
├── app.js           # WebSocket/HTTP logic
└── vercel.json      # Optional config
```

---

### index.html

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Product Display Generator</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="style.css">
</head>
<body class="bg-gray-50">
  
  <!-- Main Container -->
  <div class="flex flex-col h-screen max-w-5xl mx-auto">
    
    <!-- Header -->
    <header class="bg-white border-b p-4 flex items-center justify-between">
      <div>
        <h1 class="text-xl font-bold">AI Product Display Generator</h1>
        <p class="text-sm text-gray-500">Create professional glasses displays & videos</p>
      </div>
      <div class="text-right">
        <p class="text-xs text-gray-500">Session Cost</p>
        <p id="session-cost" class="text-lg font-semibold text-blue-600">$0.00</p>
      </div>
    </header>
    
    <!-- Messages Area -->
    <div id="messages-container" class="flex-1 overflow-y-auto p-4 space-y-4">
      <!-- Messages will be appended here -->
    </div>
    
    <!-- Input Area -->
    <div class="bg-white border-t p-4">
      <div class="flex gap-2">
        <input 
          id="prompt-input" 
          type="text" 
          placeholder="Describe what you want to create (e.g., 'professional sunglasses display')"
          class="flex-1 px-4 py-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          onkeypress="if(event.key === 'Enter') sendMessage()"
        />
        <button 
          onclick="sendMessage()" 
          class="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 font-medium"
        >
          Generate
        </button>
      </div>
      <p class="text-xs text-gray-400 mt-2">
        Try: "create professional glasses display" or "make a 360 video of these glasses"
      </p>
    </div>
    
  </div>
  
  <script src="app.js"></script>
</body>
</html>
```

---

### style.css

```css
/* Loading animations */
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.thinking-animation {
  display: inline-block;
  animation: pulse 1.5s ease-in-out infinite;
}

.progress-circle {
  width: 100px;
  height: 100px;
  position: relative;
}

.progress-circle svg {
  transform: rotate(-90deg);
}

.progress-circle .progress-bg {
  fill: none;
  stroke: #e5e7eb;
  stroke-width: 8;
}

.progress-circle .progress-bar {
  fill: none;
  stroke: #3b82f6;
  stroke-width: 8;
  stroke-dasharray: 283;
  stroke-dashoffset: 283;
  transition: stroke-dashoffset 0.3s;
}

/* Message styles */
.message-user {
  background: #3b82f6;
  color: white;
  padding: 12px 16px;
  border-radius: 18px;
  max-width: 70%;
  margin-left: auto;
}

.message-assistant {
  background: white;
  border: 1px solid #e5e7eb;
  padding: 16px;
  border-radius: 12px;
  max-width: 90%;
}

/* Image grid */
.image-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-top: 12px;
}

.image-item {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  transition: transform 0.2s;
}

.image-item:hover {
  transform: scale(1.02);
}

.image-item img {
  width: 100%;
  height: auto;
  display: block;
}

.image-actions {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(transparent, rgba(0,0,0,0.7));
  padding: 8px;
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.2s;
}

.image-item:hover .image-actions {
  opacity: 1;
}

.action-btn {
  flex: 1;
  padding: 6px 12px;
  background: white;
  border: none;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  font-weight: 500;
}

.action-btn:hover {
  background: #f3f4f6;
}

/* Video player */
.video-container {
  margin-top: 12px;
  border-radius: 8px;
  overflow: hidden;
}

.video-container video {
  width: 100%;
  height: auto;
}

/* Cost badge */
.cost-badge {
  display: inline-block;
  padding: 4px 8px;
  background: #dcfce7;
  color: #166534;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  margin-top: 8px;
}
```

---

### app.js

```javascript
// Configuration
const N8N_WEBHOOK_URL = 'https://your-n8n-instance.com/webhook/chat';
let sessionId = localStorage.getItem('sessionId') || `session-${Date.now()}`;
localStorage.setItem('sessionId', sessionId);

let sessionTotalCost = 0;

// Generate unique message ID
function generateMessageId() {
  return `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Send message to n8n
async function sendMessage() {
  const input = document.getElementById('prompt-input');
  const prompt = input.value.trim();
  
  if (!prompt) return;
  
  // Clear input
  input.value = '';
  
  // Display user message
  appendMessage('user', prompt);
  
  // Show thinking state
  const thinkingId = showThinking();
  
  try {
    // Send to n8n webhook
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt,
        sessionId: sessionId,
        selectedImageId: null
      })
    });
    
    const data = await response.json();
    
    if (data.phase === 'thinking') {
      // Update thinking message with AI's mode selection
      updateThinking(thinkingId, data.message);
      
      // Show generation loading
      showGenerationLoading(data.mode);
      
      // Poll for completion (alternative: use WebSocket)
      pollForCompletion();
      
    } else if (data.phase === 'complete') {
      // Direct completion (if n8n returns everything in one response)
      hideThinking(thinkingId);
      displayResults(data);
    }
    
  } catch (error) {
    hideThinking(thinkingId);
    appendMessage('error', `Error: ${error.message}`);
  }
}

// Append message to chat
function appendMessage(type, content) {
  const container = document.getElementById('messages-container');
  const messageEl = document.createElement('div');
  messageEl.className = `message-${type}`;
  
  if (type === 'user') {
    messageEl.textContent = content;
  } else if (type === 'assistant') {
    messageEl.innerHTML = content;
  } else if (type === 'error') {
    messageEl.className = 'message-assistant';
    messageEl.innerHTML = `<p class="text-red-600">${content}</p>`;
  }
  
  container.appendChild(messageEl);
  container.scrollTop = container.scrollHeight;
}

// Show thinking animation
function showThinking() {
  const id = generateMessageId();
  appendMessage('assistant', `
    <div id="${id}" class="thinking-animation">
      <p class="text-gray-600">Thinking...</p>
    </div>
  `);
  return id;
}

// Update thinking with AI's message
function updateThinking(id, message) {
  const el = document.getElementById(id);
  if (el) {
    el.innerHTML = `<p class="text-gray-700">${message}</p>`;
    el.classList.remove('thinking-animation');
  }
}

// Hide thinking
function hideThinking(id) {
  const el = document.getElementById(id);
  if (el) el.remove();
}

// Show generation loading with progress
function showGenerationLoading(mode) {
  const container = document.getElementById('messages-container');
  const loadingEl = document.createElement('div');
  loadingEl.id = 'generation-loading';
  loadingEl.className = 'message-assistant';
  loadingEl.innerHTML = `
    <div class="flex flex-col items-center py-8">
      <div class="progress-circle">
        <svg viewBox="0 0 100 100">
          <circle class="progress-bg" cx="50" cy="50" r="45" />
          <circle id="progress-bar" class="progress-bar" cx="50" cy="50" r="45" />
        </svg>
      </div>
      <p class="mt-4 text-gray-600">Generating ${mode}...</p>
      <p class="text-sm text-gray-400 mt-2">This may take 20-60 seconds</p>
    </div>
  `;
  
  container.appendChild(loadingEl);
  container.scrollTop = container.scrollHeight;
  
  // Animate progress (fake progress for UX)
  animateProgress(20); // 20 second estimate
}

// Animate progress circle
function animateProgress(durationSeconds) {
  const progressBar = document.getElementById('progress-bar');
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

// Poll for completion (if n8n doesn't use WebSocket)
async function pollForCompletion() {
  // Note: This is a simplified polling approach
  // In production, you'd either:
  // 1. Use WebSocket for real-time updates
  // 2. Return a job ID and poll a status endpoint
  // 3. Use Server-Sent Events (SSE)
  
  // For this MVP, we assume n8n returns complete response after processing
  // If you need polling, implement a separate status endpoint in n8n
}

// Display results (images or video)
function displayResults(data) {
  // Remove loading
  const loadingEl = document.getElementById('generation-loading');
  if (loadingEl) loadingEl.remove();
  
  // Update session cost
  sessionTotalCost = data.cost.session;
  document.getElementById('session-cost').textContent = `$${sessionTotalCost.toFixed(2)}`;
  
  // Build result HTML
  let resultHTML = '';
  
  if (data.type === 'image' && data.content.images) {
    // Image grid (4 images)
    resultHTML = `
      <p class="text-gray-700 mb-2">✨ Generated 4 professional product displays!</p>
      <div class="image-grid">
        ${data.content.images.map((img, i) => `
          <div class="image-item" data-image-id="${img.id}">
            <img src="${img.url}" alt="Generated image ${i+1}" />
            <div class="image-actions">
              <button class="action-btn" onclick="generateVideoFromImage('${img.id}')">
                🎬 Make Video
              </button>
              <button class="action-btn" onclick="downloadImage('${img.url}', ${i+1})">
                ⬇️ Download
              </button>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="cost-badge">Cost: $${data.cost.current.toFixed(3)}</div>
    `;
    
  } else if (data.type === 'video' && data.content.video) {
    // Video player
    resultHTML = `
      <p class="text-gray-700 mb-2">🎬 Generated 360° product video!</p>
      <div class="video-container">
        <video controls autoplay loop>
          <source src="${data.content.video.url}" type="video/mp4" />
        </video>
      </div>
      <button 
        class="mt-3 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
        onclick="downloadVideo('${data.content.video.url}')"
      >
        ⬇️ Download Video
      </button>
      <div class="cost-badge">Cost: $${data.cost.current.toFixed(3)}</div>
    `;
  }
  
  appendMessage('assistant', resultHTML);
}

// Generate video from selected image
async function generateVideoFromImage(imageId) {
  const prompt = `Generate a 360° rotating video of this product`;
  
  // Display user message
  appendMessage('user', `Generate video from selected image`);
  
  // Show thinking
  const thinkingId = showThinking();
  
  try {
    const response = await fetch(N8N_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt,
        sessionId: sessionId,
        selectedImageId: imageId
      })
    });
    
    const data = await response.json();
    
    if (data.phase === 'thinking') {
      updateThinking(thinkingId, data.message);
      showGenerationLoading('video');
    } else if (data.phase === 'complete') {
      hideThinking(thinkingId);
      displayResults(data);
    }
    
  } catch (error) {
    hideThinking(thinkingId);
    appendMessage('error', `Error: ${error.message}`);
  }
}

// Download image
function downloadImage(url, index) {
  const link = document.createElement('a');
  link.href = url;
  link.download = `product-display-${index}.jpg`;
  link.click();
}

// Download video
function downloadVideo(url) {
  const link = document.createElement('a');
  link.href = url;
  link.download = 'product-video.mp4';
  link.click();
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  // Show welcome message
  appendMessage('assistant', `
    <p class="text-gray-700">👋 Hi! I can create professional product displays and videos for you.</p>
    <p class="text-sm text-gray-500 mt-2">Try saying:</p>
    <ul class="text-sm text-gray-500 mt-1 space-y-1">
      <li>• "Create professional glasses display images"</li>
      <li>• "Generate a 360° video of sunglasses"</li>
      <li>• "Make modern eyewear product photos"</li>
    </ul>
  `);
});
```

---

## 🚀 Deployment Instructions

### Step 1: Deploy n8n Workflow

1. **Copy the workflow JSON** (will be provided separately as `workflow.json`)
2. **Import into n8n**:
   - Go to n8n → Workflows → Import from File
   - Upload `workflow.json`
3. **Configure credentials**:
   - OpenRouter API key (Header Auth)
   - OpenRouter API key (Header Auth)
     - Name: `Authorization`
     - Value: `Bearer sk-or-v1-YOUR_KEY_HERE`
   - fal.ai API key (store as `falApiKey` in credentials)
4. **Activate workflow**: Toggle "Active" switch
5. **Copy webhook URL**: Should be like `https://your-n8n.com/webhook/chat`

---

### Step 2: Deploy Frontend to Vercel

1. **Create project folder**:
   ```bash
   mkdir glasses-generator
   cd glasses-generator
   ```

2. **Add files**: `index.html`, `style.css`, `app.js` (from above)

3. **Update `app.js`**: Replace `N8N_WEBHOOK_URL` with your actual webhook URL

4. **Deploy**:
   ```bash
   npm i -g vercel
   vercel --prod
   ```

5. **Done!** You'll get a URL like `https://glasses-generator.vercel.app`

---

### Step 3: Test the System

1. **Open your Vercel URL** in browser
2. **Test image generation**: Type "create professional glasses display"
3. **Verify**:
   - "Thinking..." appears
   - Mode selection message shows ("Switching to image generation...")
   - Progress circle animates
   - 4 images appear in 2x2 grid
   - Cost updates in header
4. **Test video generation**: Type "make a 360 video of glasses"
5. **Test image-to-video**: Click "Make Video" button on any generated image

---

## 💰 Cost Tracking & Display

### Real-time Cost Calculation

The cost is calculated in **Step 14** and displayed in:
1. **Header**: Session total cost (persistent)
2. **Per-generation badge**: Cost for each generation

### Cost Breakdown

| Operation | Model | Cost per Unit |
|-----------|-------|---------------|
| Prompt Enhancement | Claude 3.5 Sonnet | $0.005 |
| Image Generation (4x) | imagen4 ultra | $0.40 total |
| Video Generation | kling v2.5 turbo pro | $0.60 |
| Image-to-Video | kling v2.5 turbo standard | $0.40 |

### Monthly Budget Estimates

**Scenario: 100 users, 5 generations each/month**

| Mix | Image Gens | Video Gens | Monthly Cost |
|-----|------------|------------|--------------|
| Images only | 500 | 0 | $202.50 |
| Mixed (80/20) | 400 | 100 | $262 |
| Video-heavy (50/50) | 250 | 250 | $251.25 |

**Cost Optimization Tips**:
- Switch imagen4 to flux-pro ($0.05/image) → 8x cheaper images
- Cache similar prompts (deduplicate)
- Rate limit users (5 gens/day)

---

## 🧪 Testing Checklist

### Functional Tests

- [ ] **Basic image generation**
  - Input: "create glasses display"
  - Expected: 4 images in ~30 seconds
  
- [ ] **Video generation**
  - Input: "make a 360 video"
  - Expected: 1 video in ~60 seconds
  
- [ ] **Image-to-video**
  - Generate 4 images → Click "Make Video" on image 2
  - Expected: Video using that specific image
  
- [ ] **Cost tracking**
  - Session cost updates after each generation
  - Cost badge shows per-generation cost
  
- [ ] **Error handling**
  - Invalid prompt → User-friendly error message
  - API timeout → "Please try again" message
  
- [ ] **Session persistence**
  - Refresh page → Session ID preserved
  - Can reference previous images

### Performance Tests

- [ ] **Load time**: Frontend loads in <2 seconds
- [ ] **Image generation**: Completes in <35 seconds
- [ ] **Video generation**: Completes in <90 seconds
- [ ] **Concurrent users**: 10 simultaneous users work correctly

---

## 🔐 Security & Rate Limiting

### Current Security

- **API keys**: Stored securely in n8n credentials
- **Session management**: Client-side sessionId (not authenticated)
- **CORS**: Enabled on webhook

### Future Security (Cloudflare Phase)

- **Email authentication**: Cloudflare Access
- **Rate limiting**: 10 requests/minute per email
- **Usage caps**: $10/month per user
- **Team access control**: Admin can manage credits

---

## 🎯 MVP Success Criteria

**Phase 1 Complete When**:
- [ ] User can type prompt and get 4 images
- [ ] Images display in 2x2 grid with hover actions
- [ ] Cost tracking works and displays correctly
- [ ] Session persists across page refreshes
- [ ] Average generation time <40 seconds
- [ ] Error messages are user-friendly
- [ ] Deployed to Vercel (public URL works)

---

## 📈 Future Roadmap

### Phase 2: Video & Iteration (1-2 weeks)
- [ ] Image-to-video fully tested and optimized
- [ ] "Edit/regenerate" button for images
- [ ] Prompt history dropdown (reuse past prompts)
- [ ] Download all 4 images as ZIP

### Phase 3: Enhanced UX (2-3 weeks)
- [ ] Split-screen canvas/moodboard (drag-drop images)
- [ ] Model selector UI (choose imagen4 vs flux-pro)
- [ ] Batch generation (queue multiple prompts)
- [ ] Prompt templates library

### Phase 4: Team Features (3-4 weeks)
- [ ] Cloudflare email authentication
- [ ] Team workspace (shared sessions)
- [ ] Admin dashboard (usage stats, cost controls)
- [ ] Credit system ($10/month per user cap)
- [ ] Export projects (all assets + prompts)

### Phase 5: Advanced AI (1-2 months)
- [ ] Image editing (change background, lighting, color)
- [ ] Style transfer (apply brand colors/aesthetics)
- [ ] Upscaling (4K image output)
- [ ] Longer videos (10-15 seconds)
- [ ] Custom fine-tuned models (brand-specific)

---

## 🐛 Troubleshooting

### Common Issues

**1. Webhook not responding**
- Check n8n workflow is Active
- Verify webhook URL in `app.js`
- Check CORS settings on n8n webhook

**2. Images not generating**
- Verify fal.ai API key is correct
- Check fal.ai account has credits
- Review n8n execution logs for errors

**3. Cost not updating**
- Check Step 14 (Calculate Cost) is executing
- Verify `sessionTotalCost` in session state
- Inspect browser console for JS errors

**4. Session lost on refresh**
- Verify `localStorage.getItem('sessionId')` works
- Check browser allows localStorage
- Clear cache and try again

**5. Video generation timeout**
- Increase `MAX_ATTEMPTS` in Step 11 (currently 60 = 120 sec)
- Check fal.ai video generation status manually
- Try simpler video prompts

---

## 📚 Technical Reference

### API Endpoints Used

| Service | Endpoint | Purpose |
|---------|----------|---------|
| OpenRouter | `https://openrouter.ai/api/v1/chat/completions` | Prompt enhancement |
| fal.ai (imagen) | `https://fal.run/fal-ai/imagen4/preview/ultra` | Image generation |
| fal.ai (kling video) | `https://fal.run/fal-ai/kling-video/v2.5-turbo/pro/text-to-video` | Video generation |
| fal.ai (image-to-video) | `https://fal.run/fal-ai/kling-video/v2.5-turbo/standard/image-to-video` | Image to video |

### n8n Node Types Used

| Node Type | Count | Purpose |
|-----------|-------|---------|
| `webhook` | 1 | Entry point |
| `code` | 6 | Custom logic, polling, session management |
| `httpRequest` | 3 | API calls (OpenRouter × 2, optional) |
| `switch` | 1 | Route by mode |
| `set` | 2 | Data formatting |
| `respondToWebhook` | 2 | Send responses to frontend |

### Key Variables

```javascript
// Session State Structure
{
  sessionId: string,
  messages: [
    { role: 'user' | 'assistant', content: any, timestamp: number }
  ],
  generatedAssets: [
    {
      id: string,
      type: 'image' | 'video' | 'image_to_video',
      images: [{ url, width, height, prompt, id }],
      video: { url, width, height, duration },
      cost: number,
      timestamp: number
    }
  ],
  totalCost: number,
  createdAt: number
}
```

---

## ✅ Final Checklist Before Production

### n8n Workflow
- [ ] All credentials configured
- [ ] Webhook URL is HTTPS (not HTTP)
- [ ] Workflow is Active
- [ ] Test execution completes successfully
- [ ] Error handling nodes in place

### Frontend
- [ ] `N8N_WEBHOOK_URL` updated in `app.js`
- [ ] Vercel deployment successful
- [ ] Custom domain configured (optional)
- [ ] HTTPS certificate working
- [ ] Mobile responsive design tested

### Documentation
- [ ] README with setup instructions
- [ ] API key procurement guide
- [ ] Cost calculator spreadsheet
- [ ] Team training video/guide

### Monitoring
- [ ] n8n execution logs reviewed daily
- [ ] Cost tracking spreadsheet
- [ ] User feedback channel (Slack/email)
- [ ] Error rate monitoring

---

## 📞 Support & Maintenance

### Daily Tasks
- Check n8n execution errors
- Review cost trends
- Monitor user feedback

### Weekly Tasks
- Update prompt templates if needed
- Optimize slow generations
- Review and approve model updates

### Monthly Tasks
- Cost analysis and optimization
- Feature prioritization based on usage
- Security audit and updates

---

## 🎉 You're Ready to Build!

This document contains **everything needed** to implement the complete system:

1. **Exact n8n node configurations** (Steps 1-17)
2. **Complete frontend code** (HTML, CSS, JS)
3. **Deployment instructions** (Vercel + n8n)
4. **Testing procedures** and success criteria
5. **Cost tracking** implementation
6. **Future roadmap** for iterative improvements

### Next Actions:

1. **Review this plan** one more time
2. **Gather API keys**:
   - OpenRouter: https://openrouter.ai/keys
   - fal.ai: https://fal.ai/dashboard
3. **Build n8n workflow** (follow Steps 1-17 exactly)
4. **Deploy frontend** to Vercel
5. **Test thoroughly** using checklist
6. **Launch MVP** and gather feedback

**Estimated Build Time**: 2-3 days for solo developer

---

**Document Version**: 2.0 - Ready for Implementation  
**Last Updated**: {{ new Date().toISOString().split('T')[0] }}  
**Status**: ✅ DEFINITIVE - Ready to hand to coding AI


---

**All decisions finalized**:
- ✅ Storage: n8n static data (MVP) → Redis (Phase 3)
- ✅ Hosting: Vercel (demo) → Cloudflare (team auth)
- ✅ Models: imagen4 ultra (images), kling v2.5 turbo (video), Claude 3.5 Sonnet (prompts)
- ✅ Authentication: Anonymous (MVP) → Email + OTP (Phase 4)
- ✅ Model selection: Hardcoded (MVP) → UI selector (Phase 3)

**Implementation Order**: Follow Steps 1-17 sequentially → Deploy frontend → Test → Launch
