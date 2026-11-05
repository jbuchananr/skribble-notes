/** Minimal OpenRouter chat client (OpenAI-compatible). */
export interface ChatMessage { role: 'system' | 'user' | 'assistant'; content: string }

const ENDPOINT = 'https://openrouter.ai/api/v1/chat/completions'

export async function chat(apiKey: string, model: string, messages: ChatMessage[], opts: { json?: boolean; maxTokens?: number } = {}): Promise<string> {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://skribble.local',
      'X-Title': 'Skribble'
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.4,
      max_tokens: opts.maxTokens ?? 2000,
      reasoning: { effort: 'low' },
      ...(opts.json ? { response_format: { type: 'json_object' } } : {})
    })
  })
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try { msg = JSON.parse(text).error?.message ?? text } catch { /* raw */ }
    throw new Error(`OpenRouter ${res.status}: ${msg}`)
  }
  const data = JSON.parse(text)
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error('OpenRouter returned no content')
  return content
}
