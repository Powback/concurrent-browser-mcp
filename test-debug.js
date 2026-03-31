const SSE_URL = process.env.SSE_URL || 'http://host.docker.internal:3000';

class McpClient {
  constructor(baseUrl) { this.baseUrl = baseUrl; }
  async connect() {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      this._sseController = controller;
      fetch(this.baseUrl + '/sse', { signal: controller.signal }).then(async (resp) => {
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        const read = async () => {
          const { value, done } = await reader.read();
          if (done) return;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const match = line.slice(6).trim().match(/sessionId=([^&]+)/);
              if (match) {
                this.sessionId = match[1];
                this._msgUrl = this.baseUrl + '/message?sessionId=' + this.sessionId;
                resolve();
                this._loop(reader, decoder, buffer);
                return;
              }
            }
          }
          read();
        };
        read();
      }).catch(reject);
    });
  }
  async _loop(reader, decoder, buf) {
    let buffer = buf;
    try { while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const msg = JSON.parse(line.slice(6));
            if (msg.id && this._p?.has(msg.id)) { this._p.get(msg.id)(msg); this._p.delete(msg.id); }
          } catch {}
        }
      }
    }} catch {}
  }
  async call(name, args = {}) {
    const id = 'r' + Date.now() + Math.random().toString(36).slice(2);
    if (!this._p) this._p = new Map();
    const p = new Promise(r => {
      this._p.set(id, r);
      setTimeout(() => { if (this._p.has(id)) { this._p.delete(id); r({ error: { message: 'Timeout' } }); } }, 30000);
    });
    await fetch(this._msgUrl, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ jsonrpc:'2.0', id, method:'tools/call', params:{name,arguments:args} }) });
    const resp = await p;
    if (resp.error) throw new Error(JSON.stringify(resp.error));
    const text = resp.result?.content?.find(c => c.type === 'text')?.text;
    return text ? JSON.parse(text) : resp.result;
  }
  close() { this._sseController?.abort(); }
}

async function main() {
  const c = new McpClient(SSE_URL);
  await c.connect();

  const inst = await c.call('browser_create_instance', {});
  const id = inst.instanceId;

  await c.call('browser_navigate', { instanceId: id, url: 'https://example.com' });

  const bmResult = await c.call('browser_bookmarklet_run', { instanceId: id, name: 'extract-meta' });
  console.log('Bookmarklet result:', JSON.stringify(bmResult, null, 2));

  await c.call('browser_close_instance', { instanceId: id });
  c.close();
}

main().catch(e => { console.error(e); process.exit(1); });
