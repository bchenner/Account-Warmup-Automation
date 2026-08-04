import { app, shell, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { registerIpc } from './ipc'
import { setDataRoot } from './store'
import { stopAll } from './profiles'

// Only one Boiler at a time. Two instances would each hold their own view of
// proxies.yaml and the running-profile map, and the second to write would
// clobber the first — the single-writer assumption the whole file store rests
// on (no database, no locking) only holds with one process.
//
// The smoke scripts need to run while a dev instance may be open, so they can
// opt out explicitly.
const allowMulti = process.env.BOILER_ALLOW_MULTI === '1'
if (!allowMulti && !app.requestSingleInstanceLock()) {
  app.quit()
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: '#0a0a0a',
    autoHideMenuBar: true,
    title: 'Boiler',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  win.on('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(() => {
  // State lives beside the app's user data, not in the repo — profile
  // directories get large and must survive a reinstall.
  setDataRoot(join(app.getPath('userData'), 'data'))
  registerIpc()
  createWindow()

  // Someone tried to start a second Boiler: surface the one that already
  // exists rather than silently doing nothing.
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (!win) return createWindow()
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Chrome instances are children of this process; leaving them orphaned would
// strand profiles as "open" with no way to close them from the app.
app.on('before-quit', () => stopAll())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
