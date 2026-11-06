import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Dedicated Remote Qwen LLM Gateway Service for Brutally Hired / SkillBridge.
 * Communicates with the remote FastAPI gateway hosted on the cloud server
 * via public HTTPS Cloudflare Tunnel.
 *
 * Exclusively uses server-side requests with Bearer token authentication.
 * Never exposes keys or remote endpoints to the client.
 */
class QwenLlmService {
  /**
   * Resolve remote LLM gateway base URL.
   * Priority:
   * 1. LLM_GATEWAY_URL (standard)
   * 2. BRUTALLYHIRED_LLM_GATEWAY_URL
   * 3. SKILLBRIDGE_LLM_GATEWAY_URL (backward compatibility fallback)
   * 4. Default: https://llm.brutallyhired.com
   */
  getGatewayBaseUrl() {
    const raw = (
      process.env.SKILLBRIDGE_LLM_GATEWAY_URL ||
      process.env.LLM_GATEWAY_URL ||
      process.env.BRUTALLYHIRED_LLM_GATEWAY_URL ||
      'https://rsvragsvr.tail236357.ts.net'
    ).trim();

    return raw.replace(/\/+$/, '');
  }

  /**
   * Resolve recruitment API key from backend environment.
   */
  getApiKey() {
    return (
      process.env.SKILLBRIDGE_LLM_GATEWAY_API_KEY ||
      process.env.LLM_GATEWAY_API_KEY ||
      process.env.BRUTALLYHIRED_LLM_API_KEY ||
      ''
    ).trim();
  }

  /**
   * Determine whether the remote LLM gateway has been configured.
   * True if an explicit gateway URL or API key is set in environment.
   */
  isConfigured() {
    const hasExplicitUrl = Boolean(
      process.env.LLM_GATEWAY_URL ||
      process.env.BRUTALLYHIRED_LLM_GATEWAY_URL ||
      process.env.SKILLBRIDGE_LLM_GATEWAY_URL
    );
    const hasKey = Boolean(this.getApiKey());
    return hasExplicitUrl || hasKey;
  }

  /**
   * Construct safe HTTP headers with Bearer token.
   * @param {Object} extra
   */
  getHeaders(extra = {}) {
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...extra
    };

    const apiKey = this.getApiKey();
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }

    return headers;
  }

  /**
   * Health check for remote LLM Gateway.
   * Probes GET ${gatewayUrl}/health
   */
  async checkHealth() {
    const gatewayUrl = this.getGatewayBaseUrl();
    const startTime = Date.now();
    try {
      const response = await axios.get(`${gatewayUrl}/health`, {
        timeout: 8000,
        headers: this.getHeaders()
      });

      const latencyMs = Date.now() - startTime;
      return {
        online: response.status >= 200 && response.status < 300,
        status: response.data?.status || 'ok',
        url: gatewayUrl,
        latencyMs,
        details: response.data
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const status = error.response?.status;
      return {
        online: false,
        url: gatewayUrl,
        latencyMs,
        error: error.message,
        code: error.code || (status ? `HTTP_${status}` : 'NETWORK_ERROR'),
        statusCode: status
      };
    }
  }

  /**
   * Format message payload for the /recruitment/chat endpoint.
   * Ensures system instructions, interview context, and recent conversation
   * are compiled into a structured conversational prompt.
   */
  _buildMessage({ message, conversationHistory = [], systemPrompt = '', role = '', context = '' }) {
    const MAX_TOTAL_CHARS = 12000;
    const MAX_HISTORY_ITEMS = 6;
    const MAX_ITEM_CHARS = 400;

    const sections = [];

    // System / Persona instructions
    const system = String(systemPrompt || '').trim();
    if (system) {
      sections.push(system);
    } else {
      sections.push(
        'You are the Brutally Hired AI Career & Technical Interview Assistant powered by Qwen 2.5.\n' +
        'Provide sharp, authentic, and highly constructive feedback, interview preparation, and technical insights.\n' +
        'Keep responses direct, professional, clear, and audio-friendly.'
      );
    }

    if (role) {
      sections.push(`Target Role / Specialization: ${role}`);
    }

    if (context) {
      sections.push(`Context:\n${String(context).trim()}`);
    }

    // Recent conversation history
    if (Array.isArray(conversationHistory) && conversationHistory.length > 0) {
      const historyLines = [];
      const recent = conversationHistory.slice(-MAX_HISTORY_ITEMS);
      for (const item of recent) {
        const isUser = item.role === 'user' || item.sender === 'user';
        const rawContent = item.content || item.text || item.message || '';
        if (typeof rawContent !== 'string' || !rawContent.trim()) continue;

        const clipped = rawContent.trim().length > MAX_ITEM_CHARS
          ? `${rawContent.trim().slice(0, MAX_ITEM_CHARS)}...`
          : rawContent.trim();
        historyLines.push(`${isUser ? 'Candidate' : 'Interviewer'}: ${clipped}`);
      }
      if (historyLines.length > 0) {
        sections.push(`Recent Conversation:\n${historyLines.join('\n')}`);
      }
    }

    // Active candidate question
    sections.push(`Candidate Question / Input:\n${message.trim()}`);

    let compiled = sections.join('\n\n');
    if (compiled.length > MAX_TOTAL_CHARS) {
      compiled = compiled.slice(0, MAX_TOTAL_CHARS);
    }

    return compiled;
  }

  /**
   * Dedicated Chat completion via POST /recruitment/chat
   *
   * @param {Object} params
   * @param {string} params.message - Candidate message or question
   * @param {Array} [params.conversationHistory] - Previous chat turns
   * @param {string} [params.systemPrompt] - Custom persona prompt
   * @param {string} [params.role] - Target interview role
   * @param {string} [params.context] - Relevant job/lesson context
   * @param {number} [params.timeoutMs=35000] - Request timeout
   * @returns {Promise<{response: string, model: string, durationMs: number}>}
   */
  async chat({ message, conversationHistory = [], systemPrompt = '', role = '', context = '', timeoutMs = 35000 }) {
    const rawMessage = String(message || '').trim();
    if (!rawMessage) {
      const err = new Error('Message is required and cannot be empty.');
      err.statusCode = 400;
      throw err;
    }

    // Limit individual user message size to prevent abuse
    const MAX_INPUT_CHARS = 4000;
    if (rawMessage.length > MAX_INPUT_CHARS) {
      const err = new Error(`Message exceeds maximum allowed length of ${MAX_INPUT_CHARS} characters.`);
      err.statusCode = 400;
      throw err;
    }

    const gatewayUrl = this.getGatewayBaseUrl();
    const endpoint = `${gatewayUrl}/recruitment/chat`;
    const compiledMessage = this._buildMessage({
      message: rawMessage,
      conversationHistory,
      systemPrompt,
      role,
      context
    });

    const startTime = Date.now();
    // Safe logging: log timing and length only — NEVER log secret keys or PII
    console.log(`[QwenLLM] Sending recruitment chat request to ${endpoint} (${rawMessage.length} chars, history: ${conversationHistory.length})`);

    try {
      const response = await axios.post(
        endpoint,
        { message: compiledMessage },
        {
          headers: this.getHeaders(),
          timeout: timeoutMs
        }
      );

      const durationMs = Date.now() - startTime;
      const data = response.data || {};
      const replyText = typeof data.response === 'string' ? data.response.trim() : (data.reply || data.text || '');
      const model = data.model || 'qwen2.5:14b';

      console.log(`[QwenLLM] Received response from model ${model} in ${durationMs}ms (${replyText.length} chars)`);

      return {
        response: replyText,
        reply: replyText,
        text: replyText,
        model,
        durationMs
      };
    } catch (error) {
      const durationMs = Date.now() - startTime;
      const status = error.response?.status;
      const responseDetail = error.response?.data?.detail || error.response?.data?.error || error.response?.data?.message;

      // Safe error logging without credentials
      console.error(`[QwenLLM] Error from ${endpoint} (HTTP ${status || error.code || 'UNKNOWN'}) in ${durationMs}ms:`, responseDetail || error.message);

      // Handle specific HTTP error status codes gracefully
      if (status === 401) {
        const err = new Error('Recruitment LLM Gateway authentication failed. Please verify BRUTALLYHIRED_LLM_API_KEY on the backend.');
        err.statusCode = 502; // Map upstream auth failure to Bad Gateway so frontend is not confused with user auth
        throw err;
      }

      if (status === 403) {
        const err = new Error('Access to the recruitment LLM endpoint is forbidden. Please verify gateway permissions.');
        err.statusCode = 403;
        throw err;
      }

      if (status === 429) {
        const err = new Error('The Qwen AI service is currently receiving high traffic. Please wait a moment and try again.');
        err.statusCode = 429;
        throw err;
      }

      if (status === 502 || status === 503 || status === 504 || error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
        const err = new Error('The remote Qwen AI Gateway is temporarily unreachable. Please ensure the Cloudflare Tunnel and FastAPI service are running.');
        err.statusCode = 503;
        throw err;
      }

      const err = new Error(responseDetail || 'Failed to generate answer from recruitment AI.');
      err.statusCode = status || 500;
      throw err;
    }
  }
}

export default new QwenLlmService();

