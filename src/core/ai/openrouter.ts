/** Minimal chat client over the OpenAI-compatible endpoints of OpenRouter and Google AI Studio. */
import type { AiConfig, Provider } from './config'

export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

const ENDPOINT: Record<Provider, string> = {
  openrouter: 'https://openrouter.ai/api/v1/chat/completions',
  google: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions'
}

export async function chat(cfg: Pick<AiConfig, 'provider' | 'apiKey' | 'model'>, messages: ChatMessage[], opts: { json?: boolean; maxTokens?: number } = {}): Promise<string> {
  const body: Record<string, unknown> = {
    model: cfg.model,
    messages,
    temperature: 0.4,
    max_tokens: opts.maxTokens ?? 2000,
    ...(opts.json ? { response_format: { type: 'json_object' } } : {})
  }
  // both accept the OpenAI-style knob; OpenRouter also takes its own object form
  if (cfg.provider === 'openrouter') body.reasoning = { effort: 'low' }
  else body.reasoning_effort = 'low'

  const res = await fetch(ENDPOINT[cfg.provider], {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
      ...(cfg.provider === 'openrouter' ? { 'HTTP-Referer': 'https://skribble.local', 'X-Title': 'Skribble' } : {})
    },
    body: JSON.stringify(body)
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try { msg = JSON.parse(text).error?.message ?? text } catch { /* raw */ }
    throw new Error(`${cfg.provider === 'google' ? 'Gemini' : 'OpenRouter'} ${res.status}: ${msg}`)
  }
  const data = JSON.parse(text)
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('Model returned no content')
  return content
}
