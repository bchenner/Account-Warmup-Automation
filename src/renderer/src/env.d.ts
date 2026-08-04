/// <reference types="vite/client" />
import type { BoilerApi } from '@shared/ipc'

declare global {
  interface Window {
    boiler: BoilerApi
  }
}

export {}
