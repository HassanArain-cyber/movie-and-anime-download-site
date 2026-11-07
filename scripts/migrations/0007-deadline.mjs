/** Bounded single-client transport. A timed-out connection is never reused. */
export function boundedClient(client, { overallTimeoutMs, networkTimeoutMs, cleanupTimeoutMs }, clock = () => performance.now()) {
  const deadline = clock() + overallTimeoutMs;
  let destroyed = false;
  let committed = false;
  let cleanupDeadline;
  function cleanupRemaining() {
    cleanupDeadline ??= clock() + cleanupTimeoutMs;
    return Math.max(0, Math.floor(cleanupDeadline - clock()));
  }
  function close() {
    destroyed = true;
    // pg Client.end() destroys its socket when a query is active. Do not await an
    // unbounded network close here. Observe rejection; never print provider data.
    try { Promise.resolve(client.end()).catch(() => {}); } catch { /* transport gone */ }
  }
  async function bounded(operation, ms) {
    let timer;
    try {
      return await Promise.race([
        Promise.resolve().then(operation),
        new Promise((_, reject) => { timer = setTimeout(() => { close(); reject(new Error('CLIENT_DEADLINE')); }, ms); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  return {
    remaining() { return Math.max(0, Math.floor(deadline - clock())); },
    async query(text, values) {
      if (destroyed || committed) throw new Error('CLIENT_CLOSED');
      const remaining = Math.floor(deadline - clock());
      if (remaining <= 0) { close(); throw new Error('INSTALLATION_DEADLINE'); }
      return bounded(() => client.query(text, values), Math.min(networkTimeoutMs, remaining));
    },
    async rollback() {
      if (destroyed || committed) return;
      try { const ms=cleanupRemaining(); if(ms<=0) { close(); return; } await bounded(() => client.query('ROLLBACK'), ms); }
      finally { close(); }
    },
    markCommitted() { committed = true; },
    async finish() {
      try { const ms=cleanupRemaining(); if(ms<=0) { close(); return; } await bounded(() => client.end(), ms); }
      catch { /* Commit outcome is already handled by the installer. */ }
      finally { destroyed = true; }
    },
    close,
  };
}
