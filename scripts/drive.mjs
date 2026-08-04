// Drives the built app for verification and screenshots.
//
//   node scripts/drive.mjs <command> [args...] [-- <command> [args...]]
//
// Commands are run in order against one launch, so a whole flow can be
// exercised without paying the launch cost per step. Run `npm run build`
// first — this launches out/, not the dev server.
//
//   node scripts/drive.mjs ss landing -- text -- quit
import { _electron as electron } from 'playwright-core'
import * as fs from 'node:fs'
import * as path from 'node:path'

const APP_DIR = path.resolve(import.meta.dirname, '..')
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(APP_DIR, '.shots')
fs.mkdirSync(SHOT_DIR, { recursive: true })

const electronBin =
  process.platform === 'win32'
    ? path.join(APP_DIR, 'node_modules/electron/dist/electron.exe')
    : process.platform === 'darwin'
      ? path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
      : path.join(APP_DIR, 'node_modules/electron/dist/electron')

// If the parent process is itself Electron (an editor, a terminal embedded in
// one), ELECTRON_RUN_AS_NODE=1 is inherited — and it makes electron.exe behave
// as plain Node, so require('electron') returns nothing and the app dies with
// "Cannot read properties of undefined (reading 'whenReady')".
const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const app = await electron.launch({
  executablePath: electronBin,
  args: ['--no-sandbox', APP_DIR],
  env,
  timeout: 30_000
})

// Electron gives no clean "ready" signal, so wait for the app's own root to
// have rendered rather than sleeping a blind interval.
const page = await app.firstWindow()

// A React app that throws during render leaves an empty #root and an otherwise
// silent screenshot, so collect the failures rather than inferring them.
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text())
})
page.on('pageerror', (e) => errors.push(String(e)))

await page.waitForSelector('#root > *', { timeout: 20_000 })

const groups = process.argv
  .slice(2)
  .join(' ')
  .split('--')
  .map((s) => s.trim())
  .filter(Boolean)

for (const group of groups) {
  const [cmd, ...rest] = group.split(/\s+/)
  const arg = rest.join(' ')
  switch (cmd) {
    case 'ss': {
      const file = path.join(SHOT_DIR, `${arg || 'shot'}.png`)
      await page.screenshot({ path: file })
      console.log('screenshot:', file)
      break
    }
    case 'text':
      console.log(
        await page.evaluate(
          (s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)',
          arg || null
        )
      )
      break
    // DOM click, not locator.click() — coordinates are unreliable when content
    // is layered, and this app has no coordinate-sensitive UI to test.
    case 'click-text': {
      const r = await page.evaluate((t) => {
        const els = [...document.querySelectorAll('button, a, [role="button"]')]
        const el = els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t))
        if (!el) return 'NOT_FOUND'
        el.click()
        return 'OK'
      }, arg)
      console.log('click-text', JSON.stringify(arg), '→', r)
      break
    }
    case 'type':
      await page.keyboard.type(arg, { delay: 20 })
      break
    case 'fill': {
      const [sel, ...v] = rest
      await page.fill(sel, v.join(' '))
      console.log('filled', sel)
      break
    }
    case 'eval':
      console.log(JSON.stringify(await page.evaluate(arg)))
      break
    case 'wait':
      await page.waitForTimeout(Number(arg) || 1000)
      break
    case 'errors':
      console.log('console errors:', JSON.stringify(errors))
      break
    default:
      console.log('unknown command:', cmd)
  }
}

await app.close()
process.exit(0)
