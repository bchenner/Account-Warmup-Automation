import { contextBridge, ipcRenderer } from 'electron'
import {
  CH,
  type AddAccountInput,
  type AddProxyInput,
  type BoilerApi,
  type CreateProfileInput
} from '@shared/ipc'

// The renderer never touches the filesystem or a browser — it sends intents and
// renders state. This is the entire surface it gets.
const api: BoilerApi = {
  dataDir: () => ipcRenderer.invoke(CH.dataDir),
  chromePath: () => ipcRenderer.invoke(CH.chromePath),
  listPersonas: () => ipcRenderer.invoke(CH.personaList),
  listProfiles: () => ipcRenderer.invoke(CH.profileList),
  createProfile: (input: CreateProfileInput) => ipcRenderer.invoke(CH.profileCreate, input),
  updateProfile: (profile) => ipcRenderer.invoke(CH.profileUpdate, profile),
  deleteProfile: (personaSlug, id) => ipcRenderer.invoke(CH.profileDelete, personaSlug, id),
  launchProfile: (id) => ipcRenderer.invoke(CH.profileLaunch, id),
  addAccount: (input: AddAccountInput) => ipcRenderer.invoke(CH.accountAdd, input),
  updateAccount: (personaSlug, profileId, platform, patch) =>
    ipcRenderer.invoke(CH.accountUpdate, personaSlug, profileId, platform, patch),
  removeAccount: (personaSlug, profileId, platform) =>
    ipcRenderer.invoke(CH.accountRemove, personaSlug, profileId, platform),
  sessionPlan: (personaSlug, profileId, platform) =>
    ipcRenderer.invoke(CH.sessionPlan, personaSlug, profileId, platform),
  runSession: (personaSlug, profileId, platform) =>
    ipcRenderer.invoke(CH.sessionRun, personaSlug, profileId, platform),
  stopProfile: (id) => ipcRenderer.invoke(CH.profileStop, id),
  listProxies: () => ipcRenderer.invoke(CH.proxyList),
  addProxy: (input: AddProxyInput) => ipcRenderer.invoke(CH.proxyAdd, input),
  addProxyBatch: (text, defaults) => ipcRenderer.invoke(CH.proxyAddBatch, text, defaults),
  removeProxy: (id) => ipcRenderer.invoke(CH.proxyRemove, id),
  verifyProxy: (id) => ipcRenderer.invoke(CH.proxyVerify, id),
  assignProxy: (id, profileId) => ipcRenderer.invoke(CH.proxyAssign, id, profileId)
}

contextBridge.exposeInMainWorld('boiler', api)
