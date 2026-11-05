import { homedir } from 'os'
import { join } from 'path'

/** Where the markdown notes live. Plain files, yours to sync/grep/back up. */
export const NOTES_DIR = process.env['NOTES_DIR'] || join(homedir(), 'Notes')
/** App config and API keys (never inside the notes folder). */
export const CONFIG_DIR = join(homedir(), '.config', 'skribble')
