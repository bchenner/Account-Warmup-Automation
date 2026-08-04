// Verifies the auth relay against a live upstream proxy.
//
//   PROXY_USER=... PROXY_PASS=... node scripts/relay-check.mjs host:port
//
// Credentials come from the environment so they never reach argv, a file, or
// this repo — which is public.
//
// Three things must hold:
//   1. Traffic through the relay egresses from the proxy's IP, not ours.
//   2. The relay adds auth Chrome cannot: no credentials are given to it.
//   3. The TLS fingerprint is IDENTICAL through the relay. If it differs, the
//      relay is terminating TLS, which would replace Chrome's genuine
//      ClientHello and defeat the entire fingerprint design.
import { fetch, ProxyAgent } from 'undici'
import { startRelay } from '../src/main/relay.ts'

const [hostPort] = process.argv.slice(2)
if (!hostPort) throw new Error('usage: relay-check.mjs host:port')
const [host, port] = hostPort.split(':')

const relay = await startRelay({
  host,
  port: Number(port),
  username: process.env.PROXY_USER,
  password: process.env.PROXY_PASS
})
console.log(`relay listening on 127.0.0.1:${relay.port} -> ${host}:${port}`)

const get = async (url, dispatcher) => {
  const res = await fetch(url, { dispatcher, signal: AbortSignal.timeout(25_000) })
  return res.json()
}

// Note there are NO credentials in this URI. That is the point.
const viaRelay = new ProxyAgent({ uri: `http://127.0.0.1:${relay.port}` })

console.log('\n--- egress IP ---')
const direct = await get('https://ipinfo.io/json')
const relayed = await get('https://ipinfo.io/json', viaRelay)
console.log('  direct        :', direct.ip, direct.country, direct.city)
console.log('  through relay :', relayed.ip, relayed.country, relayed.city)
console.log('  routed via proxy:', relayed.ip === host ? 'YES' : `NO  <-- expected ${host}`)

console.log('\n--- TLS fingerprint (must be identical: proves no MITM) ---')
const tlsDirect = await get('https://tls.peet.ws/api/all')
const tlsRelay = await get('https://tls.peet.ws/api/all', viaRelay)
const a = tlsDirect.tls?.ja3_hash
const b = tlsRelay.tls?.ja3_hash
console.log('  direct ja3    :', a)
console.log('  through relay :', b)
console.log('  identical     :', a && a === b ? 'YES — clean tunnel' : 'NO  <-- relay is terminating TLS')

console.log('\n--- a few sequential requests, to check tunnels are not leaking ---')
for (let i = 0; i < 3; i++) {
  const r = await get('https://ipinfo.io/json', viaRelay)
  process.stdout.write(`  ${i + 1}: ${r.ip}\n`)
}
console.log('  stats:', JSON.stringify(relay.stats()))

await relay.close()
console.log('\nrelay closed')
