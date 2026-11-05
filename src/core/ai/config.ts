import { promises as fs } from 'fs'
import { join } from 'path'
import { CONFIG_DIR } from '../paths'

export const AI_CONFIG_FILE = join(CONFIG_DIR, 'ai.json')
export const DEFAULT_MODEL = 'google/gemini-3.8-flash'

export interface AiConfig {
  provider: 'openrouter'
  apiKey: string
  model: string
}

export async function readAiConfig(): Promise<AiConfig | null> {
  try {
    const raw = JSON.parse(await fs.readFile(AI_CONFIG_FILE, 'utf8'))
    if (!raw.apiKey) return null
    return { provider: 'openrouter', apiKey: String(raw.apiKey), model: String(raw.model || DEFAULT_MODEL) }
  } catch {
    return null
  }
}

export async function writeAiConfig(cfg: { apiKey: string; model?: string }) {
  await fs.mkdir(CONFIG_DIR, { recursive: true })
  const out: AiConfig = { provider: 'openrouter', apiKey: cfg.apiKey.trim(), model: (cfg.model || DEFAULT_MODEL).trim() }
  await fs.writeFile(AI_CONFIG_FILE, JSON.stringify(out, null, 2), { mode: 0o600 })
  await fs.chmod(AI_CONFIG_FILE, 0o600)
}

export async function clearAiConfig() {
  await fs.rm(AI_CONFIG_FILE, { force: true })
}
