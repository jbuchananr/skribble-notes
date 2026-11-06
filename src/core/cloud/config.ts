import { promises as fs } from 'fs'
import { join } from 'path'
import { hostname } from 'os'
import { createHash } from 'crypto'
import { CONFIG_DIR, NOTES_DIR } from '../paths'

/** Connection string for the sync database. Lives next to the AI key, never in the repo or the notes folder. */
export const CLOUD_CONFIG_FILE = join(CONFIG_DIR, 'cloud.json')

export interface CloudConfig {
  databaseUrl: string
}

const short = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 6)

/** One id per (machine, notes folder) so a scratch instance never masquerades as the real one. */
export const DEVICE_ID = `${hostname().replace(/\.local$/, '').toLowerCase()}-${short(NOTES_DIR)}`

export function looksLikeDatabaseUrl(s: string) {
  return /^postgres(ql)?:\/\/\S+@\S+\/\S+/.test(s.trim())
}

/** DATABASE_URL in the environment wins (dev and tests); otherwise the saved config. */
export async function readCloudConfig(): Promise<CloudConfig | null> {
  const env = process.env['DATABASE_URL']
  if (env && looksLikeDatabaseUrl(env)) return { databaseUrl: env.trim() }
  try {
    const raw = JSON.parse(await fs.readFile(CLOUD_CONFIG_FILE, 'utf8'))
    if (raw.databaseUrl && looksLikeDatabaseUrl(String(raw.databaseUrl))) return { databaseUrl: String(raw.databaseUrl).trim() }
  } catch { /* not configured */ }
  return null
}

export async function writeCloudConfig(cfg: CloudConfig) {
  await fs.mkdir(CONFIG_DIR, { recursive: true })
  await fs.writeFile(CLOUD_CONFIG_FILE, JSON.stringify({ databaseUrl: cfg.databaseUrl.trim() }, null, 2), { mode: 0o600 })
  await fs.chmod(CLOUD_CONFIG_FILE, 0o600)
}

export async function clearCloudConfig() {
  await fs.rm(CLOUD_CONFIG_FILE, { force: true })
}
