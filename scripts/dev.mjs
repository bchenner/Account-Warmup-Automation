// Launches electron-vite dev with a clean environment.
//
// When the parent process is itself Electron — the VS Code integrated
// terminal, an Electron-hosted agent, some terminal emulators —
// ELECTRON_RUN_AS_NODE=1 is inherited. That makes electron.exe run as plain
// Node, so require('electron') returns nothing and the app dies with a
// baffling "Cannot read properties of undefined (reading 'whenReady')".
//
// Stripping it here means `npm run dev` works from any terminal.
import { spawn } from 'node:child_process'
import * as path from 'node:path'

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

// Invoke the JS entry with node rather than the .bin shim: the shim is a .cmd
// on Windows, which needs shell:true, which breaks on paths containing spaces.
const bin = path.resolve(
  import.meta.dirname,
  '..',
  'node_modules',
  'electron-vite',
  'bin',
  'electron-vite.js'
)

const child = spawn(process.execPath, [bin, 'dev', ...process.argv.slice(2)], {
  env,
  stdio: 'inherit'
})

child.on('exit', (code) => process.exit(code ?? 0))
