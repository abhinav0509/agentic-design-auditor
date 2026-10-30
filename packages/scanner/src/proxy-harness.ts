// Test harness for the egress proxy suite (D-021): a real Smokescreen process, a DNS server whose
// answers the test controls, and loopback servers that record every hit. Not imported by production
// code. "Public" is 127.0.0.1 on one allow-listed port; "private" is everything else on loopback.
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import { existsSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

// Version pinned in tools/smokescreen/src/install.ts; `pnpm smokescreen:install` puts it here.
const SMOKESCREEN_BIN = fileURLToPath(
  new URL('../../../.cache/smokescreen/v0.1.0/smokescreen', import.meta.url),
);

export type Decision = { allow: boolean; requested_host: string; decision_reason: string };

export async function freePort(host: string): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((done) => server.listen(0, host, done));
  const { port } = server.address() as net.AddressInfo;
  await new Promise((done) => server.close(done));
  return port;
}

/** An HTTP server that records `path` for every request and answers with handler. */
export async function startServer(
  host: string,
  port: number,
  handler: (path: string, res: http.ServerResponse) => void = (_p, res) => res.end('ok'),
): Promise<{ hits: string[]; close: () => Promise<void> }> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? '');
    handler(req.url ?? '', res);
  });
  await new Promise<void>((done) => server.listen(port, host, done));
  return {
    hits,
    close: () =>
      new Promise((done) => {
        server.closeAllConnections();
        server.close(() => {
          done();
        });
      }),
  };
}

/** A UDP listener that counts datagrams (a stand-in STUN server on a private address). */
export async function startUdpSink(
  host: string,
): Promise<{ port: number; packets: () => number; close: () => Promise<void> }> {
  const sock = dgram.createSocket(net.isIPv6(host) ? 'udp6' : 'udp4');
  let count = 0;
  sock.on('message', () => (count += 1));
  await new Promise<void>((done) => sock.bind(0, host, done));
  return {
    port: sock.address().port,
    packets: () => count,
    close: () =>
      new Promise((done) =>
        sock.close(() => {
          done();
        }),
      ),
  };
}

function ipv6Bytes(ip: string): Buffer {
  const [head = '', tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  const groups = ip.includes('::')
    ? [...h, ...Array<string>(8 - h.length - t.length).fill('0'), ...t]
    : h;
  const out = Buffer.alloc(16);
  groups.forEach((g, i) => out.writeUInt16BE(parseInt(g, 16), i * 2));
  return out;
}

export type DnsAnswer = { a?: string[]; aaaa?: string[] } | undefined;

/** A minimal UDP DNS server (A and AAAA, TTL 0). Unknown names get NXDOMAIN. */
export async function startDns(answer: (name: string) => DnsAnswer): Promise<{
  address: string;
  queries: string[];
  close: () => Promise<void>;
}> {
  const sock = dgram.createSocket('udp4');
  const queries: string[] = [];
  sock.on('message', (msg, from) => {
    let o = 12;
    const labels: string[] = [];
    for (let len = msg[o] ?? 0; len > 0; len = msg[o] ?? 0) {
      labels.push(msg.toString('ascii', o + 1, o + 1 + len));
      o += len + 1;
    }
    const qtype = msg.readUInt16BE(o + 1);
    const question = msg.subarray(12, o + 5);
    const name = labels.join('.').toLowerCase();
    queries.push(`${name} ${qtype === 1 ? 'A' : qtype === 28 ? 'AAAA' : String(qtype)}`);
    const found = answer(name);
    const ips = (qtype === 1 ? found?.a : qtype === 28 ? found?.aaaa : []) ?? [];
    const records = ips.map((ip) => {
      const rdata = qtype === 1 ? Buffer.from(ip.split('.').map(Number)) : ipv6Bytes(ip);
      const rr = Buffer.alloc(12);
      rr.writeUInt16BE(0xc00c, 0); // name: pointer to the question
      rr.writeUInt16BE(qtype, 2);
      rr.writeUInt16BE(1, 4); // class IN
      rr.writeUInt32BE(0, 6); // TTL 0, so every lookup comes back here
      rr.writeUInt16BE(rdata.length, 10);
      return Buffer.concat([rr, rdata]);
    });
    const header = Buffer.alloc(12);
    header.writeUInt16BE(msg.readUInt16BE(0), 0);
    header.writeUInt16BE(found ? 0x8180 : 0x8183, 2); // response, RD+RA; NXDOMAIN when unknown
    header.writeUInt16BE(1, 4);
    header.writeUInt16BE(records.length, 6);
    sock.send(Buffer.concat([header, question, ...records]), from.port, from.address);
  });
  await new Promise<void>((done) => sock.bind(0, '127.0.0.1', done));
  return {
    address: `127.0.0.1:${String(sock.address().port)}`,
    queries,
    close: () =>
      new Promise((done) =>
        sock.close(() => {
          done();
        }),
      ),
  };
}

/** Runs Smokescreen with the given flags on a free loopback port and collects its decisions. */
export async function startSmokescreen(args: string[]): Promise<{
  url: string;
  decisions: Decision[];
  close: () => Promise<void>;
}> {
  if (!existsSync(SMOKESCREEN_BIN))
    throw new Error(
      `smokescreen not installed at ${SMOKESCREEN_BIN}: run pnpm smokescreen:install`,
    );
  const port = await freePort('127.0.0.1');
  const proc = spawn(
    SMOKESCREEN_BIN,
    [...args, '--listen-ip', '127.0.0.1', '--listen-port', String(port)],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const decisions: Decision[] = [];
  let buffered = '';
  const onData = (chunk: Buffer) => {
    buffered += chunk.toString('utf8');
    const lines = buffered.split('\n');
    buffered = lines.pop() ?? '';
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Decision & { msg?: string };
        if (entry.msg === 'CANONICAL-PROXY-DECISION') decisions.push(entry);
      } catch {
        // not a JSON log line
      }
    }
  };
  proc.stdout.on('data', onData);
  proc.stderr.on('data', onData);
  for (let tries = 0; ; tries += 1) {
    const up = await new Promise<boolean>((done) => {
      const s = net.connect(port, '127.0.0.1', () => {
        s.end();
        done(true);
      });
      s.on('error', () => {
        done(false);
      });
    });
    if (up) break;
    if (tries > 100 || proc.exitCode !== null) throw new Error('smokescreen did not start');
    await new Promise((r) => setTimeout(r, 50));
  }
  return {
    url: `http://127.0.0.1:${String(port)}`,
    decisions,
    close: () =>
      new Promise((done) => {
        proc.once('exit', () => {
          done();
        });
        proc.kill();
      }),
  };
}
