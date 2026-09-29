// node cdpclose.mjs port... : Browser.close over CDP (no taskkill: process listing hangs on this box)
export async function cdpClose(port) {
  try {
    const v = await (await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(2000) })).json();
    const ws = new WebSocket(v.webSocketDebuggerUrl);
    await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; setTimeout(bad, 3000); });
    ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
    await new Promise(r => setTimeout(r, 300));
    try { ws.close(); } catch { }
    return true;
  } catch { return false; }
}
if (process.argv[1]?.endsWith('cdpclose.mjs')) for (const p of process.argv.slice(2)) console.log(p, await cdpClose(+p));
