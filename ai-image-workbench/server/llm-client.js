const configError = (message) => {
  const error = new Error(message);
  error.code = 'LLM_CONFIG_INVALID';
  return error;
};

export class OpenAiCompatibleLlmClient {
  constructor({ apiKey, baseUrl, responsesUrl, model, fetchImpl = fetch }) {
    if (!apiKey) throw configError('OPENAI_LLM_API_KEY is required.');
    if (!baseUrl) throw configError('OPENAI_LLM_BASE_URL is required.');
    if (!model) throw configError('OPENAI_LLM_MODEL is required.');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.responsesUrl = responsesUrl || baseUrl.replace(/\/chat\/completions\/?$/, '/responses');
    this.model = model;
    this.fetch = fetchImpl;
  }

  static fromEnvironment(environment = process.env, options = {}) {
    return new OpenAiCompatibleLlmClient({
      apiKey: environment.OPENAI_LLM_API_KEY,
      baseUrl: environment.OPENAI_LLM_BASE_URL,
      responsesUrl: environment.OPENAI_LLM_RESPONSES_URL,
      model: environment.OPENAI_LLM_MODEL,
      ...options,
    });
  }

  async request(endpoint, body, options = {}) {
    const { signal, ...requestOptions } = options;
    const response = await this.fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model: this.model, ...body, ...requestOptions }),
      signal,
    });
    const raw = await response.text();
    let data;
    try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
    if (!response.ok) {
      const error = new Error(data?.error?.message || `LLM API ${response.status}`);
      error.status = response.status;
      error.code = data?.error?.code || 'LLM_REQUEST_FAILED';
      throw error;
    }
    return data;
  }

  async createCompletion(messages, options = {}) { return this.request(this.baseUrl, { messages }, options); }
  async createResponse(input, options = {}) { return this.request(this.responsesUrl, { input }, options); }
  async createCompletionStream(messages, options = {}) {
    const { signal, ...requestOptions } = options;
    const response = await this.fetch(this.baseUrl, { method: 'POST', headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ model: this.model, messages, stream: true, ...requestOptions }), signal });
    const raw = await response.text();
    if (!response.ok) {
      let data;
      try { data = raw ? JSON.parse(raw) : {}; } catch { data = {}; }
      const error = new Error(data?.error?.message || `LLM API ${response.status}`);
      error.status = response.status;
      error.code = data?.error?.code || 'LLM_REQUEST_FAILED';
      throw error;
    }
    const content = raw.split(/\r?\n/).filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trim()).filter((line) => line && line !== '[DONE]').map((line) => { try { return JSON.parse(line)?.choices?.[0]?.delta?.content || JSON.parse(line)?.choices?.[0]?.message?.content || ''; } catch { return ''; } }).join('');
    if (!content) {
      try { return { output_text: JSON.parse(raw)?.choices?.[0]?.message?.content || '' }; } catch { return { output_text: '' }; }
    }
    return { output_text: content };
  }
}
