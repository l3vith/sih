import 'dotenv/config'
import { spawn, spawnSync } from 'node:child_process'
import { access, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const runtime = path.join(root, '.local', 'ocr')
const pidFile = path.join(runtime, 'runtime.pid')
const logFile = path.join(runtime, 'runtime.log')
const python = path.join(root, '.venv-ocr', 'bin', 'python')
const service = path.join(root, 'ocr', 'service.py')
const action = process.argv[2] || 'status'

async function ownedPid() {
  try {
    const pid = Number((await readFile(pidFile, 'utf8')).trim())
    if (!Number.isSafeInteger(pid) || pid <= 1) return null
    const command = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).stdout || ''
    return command.includes(service) ? pid : null
  } catch { return null }
}

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`)
}

try {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('The local OCR runtime requires an Apple Silicon Mac.')
  if (action === 'setup') {
    try { await access(python) } catch { run('uv', ['venv', '.venv-ocr', '--python', '3.12']) }
    run('uv', ['pip', 'install', '--python', python, '-r', 'ocr/requirements.lock.txt'])
    console.log('OCR environment installed. Run npm run ocr:start to download and load GLM-OCR.')
  } else if (action === 'start') {
    if (await ownedPid()) { console.log('OCR runtime already started. Use npm run ocr:status to check readiness.'); process.exit(0) }
    try { await access(python) } catch { throw new Error('Run npm run ocr:setup first (requires uv).') }
    await mkdir(runtime, { recursive: true })
    const log = await open(logFile, 'a')
    const child = spawn(python, ['-u', service], { cwd: root, detached: true, stdio: ['ignore', log.fd, log.fd], env: { ...process.env, TOKENIZERS_PARALLELISM: 'false' } })
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject) })
    await writeFile(pidFile, String(child.pid))
    child.unref()
    await log.close()
    console.log('Starting GLM-OCR on Metal. First start downloads model weights. Check npm run ocr:status or npm run ocr:logs.')
  } else if (action === 'stop') {
    const pid = await ownedPid()
    if (pid) process.kill(pid, 'SIGTERM')
    if (!pid) await rm(pidFile, { force: true })
    console.log(pid ? 'OCR runtime stopping.' : 'OCR runtime is not running.')
  } else if (action === 'logs') {
    run('tail', ['-n', '60', '-f', logFile])
  } else if (action === 'status') {
    const base = process.env.MLX_OCR_URL || `http://127.0.0.1:${process.env.MLX_OCR_PORT || 8080}`
    try {
      const response = await fetch(`${base.replace(/\/$/, '')}/health`, { signal: AbortSignal.timeout(3000) })
      const data = await response.json()
      if (!response.ok || data.engine !== 'GLM-OCR' || !data.ready) throw new Error('Not ready')
      console.log(JSON.stringify(data, null, 2))
    } catch {
      console.log(await ownedPid() ? 'OCR is starting or loading weights. Check npm run ocr:logs.' : 'OCR is stopped. Run npm run ocr:start; check logs if startup failed.')
      process.exitCode = 1
    }
  } else throw new Error('Use setup, start, stop, status or logs.')
} catch (error) { console.error(error.message); process.exitCode = 1 }
