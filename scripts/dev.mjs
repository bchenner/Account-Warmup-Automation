// Launches electron-vite dev with a clean environment.
//
// When the parent process is itself Electron — the VS Code integrated
// terminal, an Electron-hosted agent, some terminal emulators —
// ELECTRON_RUN_AS_NODE=1 is inherited. That makes electron.exe run as plain
// Node, so require('electron') returns nothing and the app dies with a
// baffling "Cannot read properties of undefined (reading 'whenReady')".
//
// Stripping it here means `npm run dev` works from any terminal.
import { spawn, execFileSync } from 'node:child_process'
import * as path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '..')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

/**
 * Close any Boiler still running from a previous `npm run dev` before starting
 * a new one, so a rebuild replaces the old instance rather than leaving a stale
 * build alongside it. The app also holds a single-instance lock, but that makes
 * the NEW process quit and defer to the old one — the opposite of what you want
 * after changing code.
 *
 * Matched on the app directory in the command line, so this only ever touches
 * Boiler's own Electron processes, never another project's.
 */
function closePrevious() {
  try {
    if (process.platform === 'win32') {
      // -like takes wildcards, not regex, and backslash is not an escape
      // character inside a single-quoted PowerShell string. Doubling them here
      // would produce a pattern that can never match a real path.
      const escaped = APP_DIR.replace(/'/g, "''")
      execFileSync(
        'powershell',
        [
          '-NoProfile',
          '-Command',
          `Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -like '*${escaped}*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`
        ],
        { stdio: 'ignore' }
      )
    } else {
      execFileSync('pkill', ['-f', `electron.*${APP_DIR}`], { stdio: 'ignore' })
    }
  } catch {
    // Nothing was running, or the shell-out is unavailable. Either is fine.
  }
}

closePrevious()

// Invoke the JS entry with node rather than the .bin shim: the shim is a .cmd
// on Windows, which needs shell:true, which breaks on paths containing spaces.
const bin = path.join(APP_DIR, 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')

const child = spawn(process.execPath, [bin, 'dev', ...process.argv.slice(2)], {
  env,
  stdio: 'inherit'
})

child.on('exit', (code) => process.exit(code ?? 0))
