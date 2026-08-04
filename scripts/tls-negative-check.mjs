// Negative control for the TLS check.
//
// A check that cannot fail is worse than one that fails at random, so force the
// proxied leg to present a deliberately different ClientHello (a restricted
// cipher list) and confirm the comparison reports a mismatch. This is the same
// comparison verifyProxy makes, with one leg sabotaged on purpose.
import { fetch, Agent, ProxyAgent } from 'undici'

//   BOILER_TEST_PROXY=http://user:pass@host:port node scripts/tls-negative-check.mjs
//
// The proxy comes from the environment. A working proxy URL contains a
// password, and this repository is public.
const URL_ = 'https://tls.peet.ws/api/all'
const PROXY = process.env.BOILER_TEST_PROXY
if (!PROXY) {
  console.error('set BOILER_TEST_PROXY=http://user:pass@host:port')
  process.exit(1)
}
const NO_RESUME = { connect: { maxCachedSessions: 0 } }

async function ja3(dispatcher) {
  try {
    const r = await fetch(URL_, { dispatcher, signal: AbortSignal.timeout(20_000) })
    return (await r.json()).tls.ja3_hash
  } finally {
    await dispatcher.close().catch(() => {})
  }
}

const honest = await ja3(new Agent(NO_RESUME))
const throughProxy = await ja3(new ProxyAgent({ uri: PROXY, ...NO_RESUME }))
const sabotaged = await ja3(
  new ProxyAgent({
    uri: PROXY,
    // requestTls governs the TUNNELLED TLS to the origin. `connect` only
    // configures the hop to the proxy itself, which is plain HTTP here.
    requestTls: {
      maxCachedSessions: 0,
      // Stands in for a MITM: a different TLS library would not reproduce this
      // client's cipher list and extension set, both of which JA3 hashes.
      // Capping at 1.2 drops the 1.3 suites and the supported_versions
      // extension, so the ClientHello is genuinely different.
      minVersion: 'TLSv1.2',
      maxVersion: 'TLSv1.2'
    }
  })
)

console.log('direct                ', honest)
console.log('through proxy         ', throughProxy)
console.log('through proxy, altered', sabotaged)
console.log()
console.log(`honest proxy   -> matches=${honest === throughProxy}  (want true)`)
console.log(`sabotaged leg  -> matches=${honest === sabotaged}  (want false)`)
console.log(
  honest === throughProxy && honest !== sabotaged
    ? '\nPASS — the check accepts a clean tunnel and still rejects a changed ClientHello'
    : '\nFAIL — the check does not discriminate'
)
