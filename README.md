# FCINQ Platform - AI Product Display Generator

A ChatGPT-style web interface for generating professional product display images for eyewear using AI. This platform connects a simple HTML frontend to an n8n workflow that enhances prompts and generates 4 high-quality images using fal.ai.

## 🎯 Features

- **Chat-style interface** for easy interaction
- **Automatic prompt enhancement** using Claude 3.5 Sonnet via OpenRouter
- **Generates 4 image variations** per request using fal.ai nano-banana model
- **Session-based cost tracking** to monitor spending
- **Real-time progress indicators** during generation
- **Download individual or all images** at once
- **Mobile-responsive design** with Tailwind CSS

## 🏗️ Architecture

```
┌─────────────────┐        HTTP POST         ┌──────────────────┐
│  HTML Frontend  │ ─────────────────────────▶│  n8n Workflow    │
│  (index.html)   │                           │  (Webhook Entry) │
└─────────────────┘                           └──────────────────┘
                                                       │
                                                       ▼
                                              ┌─────────────────────┐
                                              │ 1. Parse Prompt     │
                                              │ 2. Enhance Prompt   │
                                              │ 3. Generate Images  │
                                              │ 4. Poll Status      │
                                              │ 5. Return Results   │
                                              └─────────────────────┘
```

## 📋 Prerequisites

- **n8n instance** (self-hosted or cloud)
- **OpenRouter API key** (for Claude 3.5 Sonnet)
- **fal.ai API key** (for image generation)
- **Web server** (local or hosting like Vercel, Netlify, etc.)

## 🚀 Setup Instructions

### Step 1: Activate the n8n Workflow

1. **Go to your n8n instance**
2. **Find the workflow** named "FCINQ Platform" (ID: `uz1SYYyiiiYJqJK2`)
3. **Activate the workflow** by toggling the "Active" switch
4. **Copy the webhook URL**:
   - Click on the "Webhook Trigger" node
   - Copy the **Production URL** (should look like: `https://your-n8n-instance.com/webhook/chat`)

### Step 2: Configure the Frontend

1. **Open `app.js`** in a text editor
2. **Find line 2** where it says:
   ```javascript
   const N8N_WEBHOOK_URL = 'YOUR_N8N_WEBHOOK_URL_HERE';
   ```
3. **Replace with your actual webhook URL**:
   ```javascript
   const N8N_WEBHOOK_URL = 'https://your-n8n-instance.com/webhook/chat';
   ```
4. **Save the file**

### Step 3: Deploy the Frontend

#### Option A: Local Testing

1. **Install a simple web server** (if you don't have one):
   ```bash
   # Using Python
   python3 -m http.server 8000

   # Or using Node.js
   npx http-server -p 8000
   ```

2. **Open your browser** and go to:
   ```
   http://localhost:8000
   ```

#### Option B: Deploy to Vercel (Recommended)

1. **Install Vercel CLI** (if not installed):
   ```bash
   npm i -g vercel
   ```

2. **Deploy**:
   ```bash
   cd /home/erolinux/code/fcinq-platform
   vercel --prod
   ```

3. **Follow the prompts** and you'll get a public URL like:
   ```
   https://fcinq-platform.vercel.app
   ```

#### Option C: Deploy to Netlify

1. **Install Netlify CLI** (if not installed):
   ```bash
   npm i -g netlify-cli
   ```

2. **Deploy**:
   ```bash
   cd /home/erolinux/code/fcinq-platform
   netlify deploy --prod --dir .
   ```

### Step 4: Test the System

1. **Open the deployed URL** in your browser
2. **Type a prompt** like: "create professional glasses display"
3. **Click "Generate"** or press Enter
4. **Wait 20-30 seconds** for the images to generate
5. **View the results** and download images

## 💰 Cost Information

### Per Generation (4 images):
- **Image generation**: $0.20 (4 images × $0.05 each using nano-banana)
- **Prompt enhancement**: $0.005 (Claude 3.5 Sonnet via OpenRouter)
- **Total per generation**: ~$0.205

### Monthly estimates (for 100 users, 5 generations each):
- **Total generations**: 500
- **Monthly cost**: ~$102.50

## 🔧 Troubleshooting

### Webhook not responding
- ✅ Check that the n8n workflow is **Active**
- ✅ Verify the webhook URL in `app.js` is correct
- ✅ Check CORS settings on your n8n instance
- ✅ Open browser console (F12) to see error messages

### Images not generating
- ✅ Verify **fal.ai API key** is configured in n8n
- ✅ Check **fal.ai account** has credits
- ✅ Review n8n execution logs for errors
- ✅ Test the workflow manually in n8n first

### Cost not updating
- ✅ Check browser console for JavaScript errors
- ✅ Verify the response format from n8n matches expected structure
- ✅ Clear browser cache and refresh

### "Please configure your n8n webhook URL" error
- ✅ Make sure you updated `N8N_WEBHOOK_URL` in `app.js`
- ✅ The URL should NOT be 'YOUR_N8N_WEBHOOK_URL_HERE'
- ✅ Hard refresh the page (Ctrl+F5 or Cmd+Shift+R)

## 📂 Project Structure

```
fcinq-platform/
├── index.html          # Main HTML interface
├── style.css           # Styling and animations
├── app.js              # Frontend logic and API calls
├── plan-platform.md    # Detailed implementation plan
└── README.md           # This file
```

## 🎨 Customization

### Change number of images generated
In `app.js`, line where `sendMessage()` sends the request, modify:
```javascript
body: JSON.stringify({
  prompt: prompt,
  sessionId: sessionId,
  numImages: 4  // Change this number (max 8)
})
```

### Change the AI model for prompt enhancement
In n8n workflow:
1. Go to "OpenRouter Chat Model" node
2. Change the model to a different one (e.g., `anthropic/claude-3-haiku` for faster/cheaper)

### Change the image generation model
In n8n workflow:
1. Go to "API Fal.ai" node
2. Change the URL to a different fal.ai model endpoint
3. Example: Use `fal-ai/flux-pro` for higher quality (more expensive)

## 🔐 Security Notes

- **Current setup**: No authentication (anyone with the URL can use it)
- **Recommended for production**:
  - Add authentication (e.g., Cloudflare Access with email)
  - Implement rate limiting (e.g., 10 requests per user per day)
  - Set up usage caps per user
  - Monitor costs regularly

## 📈 Next Steps (Phase 2)

Based on `plan-platform.md`, future enhancements include:
- [ ] Video generation (360° product videos)
- [ ] Image-to-video conversion
- [ ] Image editing capabilities
- [ ] User authentication
- [ ] Team workspaces
- [ ] Cost management dashboard
- [ ] Batch generation queue

## 🐛 Known Issues

- Wait node polls every 3 seconds - may need adjustment for faster/slower models
- No retry logic if fal.ai API is down
- Session data stored in n8n static data (cleared on workflow deactivation)

## 📞 Support

For issues or questions:
1. Check the troubleshooting section above
2. Review n8n execution logs in your n8n instance
3. Check browser console for frontend errors
4. Verify all API keys are correctly configured

## 📄 License

This project is part of the FCINQ Platform initiative for eyewear product visualization.

---

**Version**: 1.0.0
**Last Updated**: 2025-11-03
**Status**: ✅ Ready for deployment
# fcinq-platform
