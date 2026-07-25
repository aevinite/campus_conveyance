// ---------------------------------------------------------------------------
// free-port.mjs — kill any process still listening on a TCP port before we
// (re)start the local server.
//
// Why: running `next start`/`next dev` a second time while a previous server
// from an earlier round is still holding port 3000 causes EADDRINUSE — the old
// process keeps serving a STALE build, so freshly-built pages throw
// ChunkLoadError (the HTML asks for chunk hashes the old build never emitted).
// This is a local dev/ops artifact only; Vercel is unaffected (atomic deploys,
// no port contention). Running this preflight guarantees exactly one clean
// server owns the port.
//
// Usage:  node scripts/free-port.mjs [port]   (default 3000)
// Cross-platform (Windows netstat/taskkill, macOS/Linux lsof/kill).
// ---------------------------------------------------------------------------
import { execSync } from 'node:child_process';

const port = Number(process.argv[2] || process.env.PORT || 3000);
const isWin = process.platform === 'win32';

/** Return the set of PIDs listening on `port` (excluding PID 0 / self). */
function pidsOnPort(p) {
  const pids = new Set();
  try {
    if (isWin) {
      // netstat lines end with the owning PID; match LISTENING sockets on :port
      const out = execSync(`netstat -ano -p tcp`, { encoding: 'utf8' });
      for (const line of out.split(/\r?\n/)) {
        if (!line.includes('LISTENING')) continue;
        // columns: Proto  Local  Foreign  State  PID
        const cols = line.trim().split(/\s+/);
        const local = cols[1] || '';
        const pid = cols[cols.length - 1];
        if (local.endsWith(`:${p}`) && pid && pid !== '0') pids.add(pid);
      }
    } else {
      const out = execSync(`lsof -ti tcp:${p} -s TCP:LISTEN`, { encoding: 'utf8' });
      for (const pid of out.split(/\r?\n/)) {
        if (pid.trim()) pids.add(pid.trim());
      }
    }
  } catch {
    // netstat/lsof exit non-zero when nothing matches — treat as "port free".
  }
  return [...pids].filter((pid) => String(pid) !== String(process.pid));
}

const pids = pidsOnPort(port);
if (pids.length === 0) {
  console.log(`[free-port] port ${port} is free.`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    if (isWin) execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' });
    else execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
    console.log(`[free-port] killed stale process ${pid} on port ${port}.`);
  } catch (err) {
    console.warn(`[free-port] could not kill PID ${pid}: ${err.message}`);
  }
}
