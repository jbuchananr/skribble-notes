import { promises as fs } from 'fs'
import { join } from 'path'
import { CONFIG_DIR } from '../paths'

export const AI_CONFIG_FILE = join(CONFIG_DIR, 'ai.json')

export type Provider = 'openrouter' | 'google'

/** Default model per provider. OpenRouter wants the vendor prefix, Google's own API does not. */
export const DEFAULT_MODEL: Record<Provider, string> = {
  openrouter: 'google/gemini-3.8-flash',
  google: 'gemini-3.8-flash'
}

export interface AiConfig {
  provider: Provider
  apiKey: string
  model: string
}

/** OpenRouter keys look like sk-or-v1-…, Google AI Studio keys like AIza…. */
export function detectProvider(apiKey: string): Provider {
  return apiKey.trim().startsWith('AIza') ? 'google' : 'openrouter'
}

export async function readAiConfig(): Promise<AiConfig | null> {
  try {
    const raw = JSON.parse(await fs.readFile(AI_CONFIG_FILE, 'utf8'))
    if (!raw.apiKey) return null
    const provider: Provider = raw.provider === 'google' || raw.provider === 'openrouter' ? raw.provider : detectProvider(String(raw.apiKey))
    return { provider, apiKey: String(raw.apiKey), model: String(raw.model || DEFAULT_MODEL[provider]) }
  } catch {
    return null
  }
}

export async function writeAiConfig(cfg: { apiKey: string; model?: string; provider?: Provider }) {
  await fs.mkdir(CONFIG_DIR, { recursive: true })
  const apiKey = cfg.apiKey.trim()
  const provider = cfg.provider ?? detectProvider(apiKey)
  const out: AiConfig = { provider, apiKey, model: (cfg.model || DEFAULT_MODEL[provider]).trim() }
  await fs.writeFile(AI_CONFIG_FILE, JSON.stringify(out, null, 2), { mode: 0o600 })
  await fs.chmod(AI_CONFIG_FILE, 0o600)
}

export async function clearAiConfig() {
  await fs.rm(AI_CONFIG_FILE, { force: true })
}
