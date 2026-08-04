import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { connect, type Socket } from 'node:net'
import { once } from 'node:events'

/**
 * A local proxy that adds credentials on the way upstream.
 *
 * Chrome cannot authenticate to a proxy: it supports no SOCKS5 auth and
 * explicitly ignores credentials embedded in `--proxy-server`. Proxy-Seller's
 * ISP product uses username/password, and IP-whitelisting is not always
 * available (and breaks whenever the operator's home IP changes). So Chrome
 * points at `127.0.0.1:<port>` with no auth, and this adds the
 * `Proxy-Authorization` header on the hop upstream.
 *
 * **It never terminates TLS.** On CONNECT it opens a socket to the upstream
 * proxy, forwards the CONNECT verbatim, and then pipes raw bytes in both
 * directions. Chrome's genuine ClientHello reaches the destination untouched,
 * which is the whole reason a MITM proxy is disqualified in the first place.
 *
 * Bound to 127.0.0.1 only — an open proxy on a LAN interface would be a
 * genuine hazard.
 */

export type Upstream = {
  host: string
  port: number
  username?: string | null
  password?: string | null
}

export type RelayHandle = {
  /** Loopback port Chrome should be pointed at. */
  port: number
  close: () => Promise<void>
  stats: () => { tunnels: number; failures: number }
}

function authHeader(u: Upstream): string {
  if (!u.username || !u.password) return ''
  const token = Buffer.from(`${u.username}:${u.password}`).toString('base64')
  return `Proxy-Authorization: Basic ${token}\r\n`
}

/** Read the upstream's CONNECT reply, returning its status and any early body bytes. */
async function readConnectReply(socket: Socket): Promise<{ status: number; rest: Buffer }> {
  let buf = Buffer.alloc(0)
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const [chunk] = (await once(socket, 'data')) as [Buffer]
    buf = Buffer.concat([buf, chunk])
    const end = buf.indexOf('\r\n\r\n')
    if (end === -1) {
      // A well-behaved proxy sends headers promptly; this guards a hostile one.
      if (buf.length > 64 * 1024) throw new Error('upstream sent oversized CONNECT reply')
      continue
    }
    const head = buf.subarray(0, end).toString('latin1')
    const status = Number(/^HTTP\/1\.[01] (\d{3})/.exec(head)?.[1] ?? 0)
    return { status, rest: buf.subarray(end + 4) }
  }
}

export async function startRelay(upstream: Upstream): Promise<RelayHandle> {
  let tunnels = 0
  let failures = 0
  const sockets = new Set<Socket>()
  const auth = authHeader(upstream)

  const server: Server = createServer()

  // Plain HTTP. Chrome sends these as absolute-form requests to the proxy.
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    const up = connect(upstream.port, upstream.host)
    sockets.add(up)
    up.on('error', () => {
      failures++
      if (!res.headersSent) res.writeHead(502)
      res.end()
    })
    up.on('close', () => sockets.delete(up))

    up.on('connect', () => {
      const headers = Object.entries(req.headers)
        .filter(([k]) => k.toLowerCase() !== 'proxy-authorization')
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}\r\n`)
        .join('')
      up.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}${auth}\r\n`)
      req.pipe(up)
      up.pipe(res.socket!)
    })
  })

  // HTTPS. Everything that matters goes through here.
  server.on('connect', (req, clientSocket: Socket, head: Buffer) => {
    tunnels++
    const up = connect(upstream.port, upstream.host)
    sockets.add(up)
    sockets.add(clientSocket)

    const fail = (): void => {
      failures++
      clientSocket.destroy()
      up.destroy()
    }
    up.on('error', fail)
    clientSocket.on('error', () => up.destroy())
    up.on('close', () => sockets.delete(up))
    clientSocket.on('close', () => sockets.delete(clientSocket))

    up.on('connect', () => {
      up.write(`CONNECT ${req.url} HTTP/1.1\r\nHost: ${req.url}\r\n${auth}\r\n`)

      readConnectReply(up)
        .then(({ status, rest }) => {
          if (status !== 200) {
            failures++
            clientSocket.write(`HTTP/1.1 ${status || 502} Proxy Error\r\n\r\n`)
            clientSocket.end()
            up.destroy()
            return
          }
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
          // From here on this is a dumb pipe. No parsing, no TLS termination —
          // the ClientHello Chrome produces is what the destination sees.
          if (rest.length) clientSocket.write(rest)
          if (head.length) up.write(head)
          up.pipe(clientSocket)
          clientSocket.pipe(up)
        })
        .catch(fail)
    })
  })

  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('relay failed to bind')

  return {
    port: address.port,
    stats: () => ({ tunnels, failures }),
    close: async () => {
      for (const s of sockets) s.destroy()
      sockets.clear()
      server.close()
      if (server.listening) await once(server, 'close')
    }
  }
}
