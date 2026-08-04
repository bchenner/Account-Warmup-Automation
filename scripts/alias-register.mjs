// Registers the '@shared/*' resolver. See alias-hooks.mjs.
import { register } from 'node:module'
register('./alias-hooks.mjs', import.meta.url)
