#!/usr/bin/env node

/**
 * Integration test for the browser automation system (recipes, bookmarklets, workflows).
 * Tests against the running SSE server.
 */

const SSE_URL = process.env.SSE_URL || 'http://localhost:3000';

// ─── SSE MCP Client ─────────────────────────────────────────────────────────

class McpClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
    this.sessionId = null;
    this._sseController = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const controller = new AbortController();
      this._sseController = controller;

      fetch(`${this.baseUrl}/sse`, { signal: controller.signal })
        .then(async (resp) => {
          const reader = resp.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          const readChunk = async () => {
            const { value, done } = await reader.read();
            if (done) return;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.startsWith('data: ')) {
                const endpoint = line.slice(6).trim();
                // Extract sessionId from the endpoint URL
                const match = endpoint.match(/sessionId=([^&]+)/);
                if (match) {
                  this.sessionId = match[1];
                  this._messageUrl = `${this.baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint.split('?')[0]}?sessionId=${this.sessionId}`;
                  resolve();
                  // Keep reading in background for responses
                  this._readLoop(reader, decoder, buffer);
                  return;
                }
              }
            }
            readChunk();
          };
          readChunk();
        })
        .catch(reject);
    });
  }

  async _readLoop(reader, decoder, initialBuffer) {
    let buffer = initialBuffer;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const msg = JSON.parse(line.slice(6));
              if (msg.id && this._pending?.has(msg.id)) {
                this._pending.get(msg.id)(msg);
                this._pending.delete(msg.id);
              }
            } catch {}
          }
        }
      }
    } catch {}
  }

  async callTool(name, args = {}) {
    const id = `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    if (!this._pending) this._pending = new Map();

    const promise = new Promise((resolve) => {
      this._pending.set(id, resolve);
      setTimeout(() => {
        if (this._pending.has(id)) {
          this._pending.delete(id);
          resolve({ error: { message: 'Timeout' } });
        }
      }, 30000);
    });

    const body = {
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: { name, arguments: args },
    };

    await fetch(this._messageUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const resp = await promise;
    if (resp.error) throw new Error(resp.error.message);
    return resp.result;
  }

  disconnect() {
    this._sseController?.abort();
  }
}

// ─── Test Runner ─────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.log(`  ✗ ${message}`);
    failed++;
  }
}

function parseResult(result) {
  // MCP result.content is array of content blocks
  const text = result.content?.find(c => c.type === 'text')?.text;
  return text ? JSON.parse(text) : null;
}

async function main() {
  console.log('╔══════════════════════════════════════════╗');
  console.log('║  Browser Automation Integration Tests    ║');
  console.log('╚══════════════════════════════════════════╝\n');

  const client = new McpClient(SSE_URL);
  console.log(`Connecting to ${SSE_URL}...`);
  await client.connect();
  console.log(`Connected (session: ${client.sessionId})\n`);

  let instanceId;

  // ── Test 1: Create browser instance ──
  console.log('1. Create browser instance');
  try {
    const r = parseResult(await client.callTool('browser_create_instance', {
      metadata: { name: 'test-automation', description: 'Integration test instance' }
    }));
    instanceId = r.instanceId;
    assert(!!instanceId, `Instance created: ${instanceId.slice(0, 8)}...`);
  } catch (e) {
    console.log(`  ✗ Failed: ${e.message}`);
    failed++;
    process.exit(1);
  }

  // ── Test 2: Save bookmarklets ──
  console.log('\n2. Save bookmarklets');
  try {
    const r = parseResult(await client.callTool('browser_bookmarklet_save', {
      name: 'extract-links',
      description: 'Extract all links from page',
      script: `(function() {
        return Array.from(document.querySelectorAll('a[href]')).map(a => ({
          text: a.textContent?.trim().substring(0, 80),
          href: a.href
        })).filter(l => l.text && l.href).slice(0, 20);
      })()`,
      tags: ['extraction']
    }));
    assert(r.name === 'extract-links', `Bookmarklet saved: ${r.name}`);
  } catch (e) {
    console.log(`  ✗ Save bookmarklet failed: ${e.message}`);
    failed++;
  }

  try {
    const r = parseResult(await client.callTool('browser_bookmarklet_save', {
      name: 'extract-meta',
      description: 'Extract page metadata (title, description, og tags)',
      script: `(function() {
        const getMeta = (name) => document.querySelector('meta[name="'+name+'"], meta[property="'+name+'"]')?.content;
        return {
          title: document.title,
          description: getMeta('description'),
          ogTitle: getMeta('og:title'),
          ogDescription: getMeta('og:description'),
          ogImage: getMeta('og:image'),
          canonical: document.querySelector('link[rel="canonical"]')?.href,
          url: window.location.href
        };
      })()`,
      tags: ['extraction', 'seo']
    }));
    assert(r.name === 'extract-meta', `Bookmarklet saved: ${r.name}`);
  } catch (e) {
    console.log(`  ✗ Save bookmarklet failed: ${e.message}`);
    failed++;
  }

  // ── Test 3: List bookmarklets ──
  console.log('\n3. List bookmarklets');
  try {
    const r = parseResult(await client.callTool('browser_bookmarklet_list', {}));
    assert(r.count >= 2, `Listed ${r.count} bookmarklets`);
    assert(r.bookmarklets.some(b => b.name === 'extract-links'), 'Found extract-links');
  } catch (e) {
    console.log(`  ✗ List failed: ${e.message}`);
    failed++;
  }

  // ── Test 4: Run bookmarklet ──
  console.log('\n4. Run bookmarklet on a page');
  try {
    await client.callTool('browser_navigate', { instanceId, url: 'https://example.com' });
    const r = parseResult(await client.callTool('browser_bookmarklet_run', {
      instanceId,
      name: 'extract-meta'
    }));
    assert(r.result?.title === 'Example Domain', `Got title: "${r.result?.title}"`);
    assert(!!r.result?.url, `Got URL: ${r.result?.url}`);
  } catch (e) {
    console.log(`  ✗ Run bookmarklet failed: ${e.message}`);
    failed++;
  }

  // ── Test 5: Save recipe ──
  console.log('\n5. Save recipe');
  try {
    const r = parseResult(await client.callTool('browser_recipe_save', {
      name: 'navigate-and-extract',
      description: 'Navigate to a URL and extract page metadata',
      params: [
        { name: 'url', description: 'URL to navigate to', required: true },
        { name: 'waitUntil', description: 'Wait condition', default: 'load' }
      ],
      steps: [
        {
          tool: 'browser_navigate',
          args: { url: '{{url}}', waitUntil: '{{waitUntil}}' },
          label: 'Navigate to URL',
          extractAs: 'navigation'
        },
        {
          tool: 'browser_evaluate',
          args: {
            script: `(function() {
              return {
                title: document.title,
                url: window.location.href,
                linkCount: document.querySelectorAll('a').length,
                h1: document.querySelector('h1')?.textContent?.trim()
              };
            })()`
          },
          label: 'Extract page data',
          extractAs: 'pageData'
        }
      ],
      tags: ['navigation', 'extraction']
    }));
    assert(r.name === 'navigate-and-extract', `Recipe saved: ${r.name}`);
    assert(r.stepsCount === 2, `Steps: ${r.stepsCount}`);
  } catch (e) {
    console.log(`  ✗ Save recipe failed: ${e.message}`);
    failed++;
  }

  // ── Test 6: List recipes ──
  console.log('\n6. List recipes');
  try {
    const r = parseResult(await client.callTool('browser_recipe_list', {}));
    assert(r.count >= 1, `Listed ${r.count} recipes`);
    assert(r.recipes.some(r => r.name === 'navigate-and-extract'), 'Found navigate-and-extract');
  } catch (e) {
    console.log(`  ✗ List recipes failed: ${e.message}`);
    failed++;
  }

  // ── Test 7: Run recipe ──
  console.log('\n7. Run recipe');
  try {
    const r = parseResult(await client.callTool('browser_recipe_run', {
      instanceId,
      name: 'navigate-and-extract',
      params: { url: 'https://example.com' }
    }));
    assert(r.stepsExecuted === 2, `Steps executed: ${r.stepsExecuted}`);
    assert(r.variables?.pageData?.result?.title === 'Example Domain', `Title: ${r.variables?.pageData?.result?.title}`);
    assert(r.totalDuration > 0, `Duration: ${r.totalDuration}ms`);
    console.log(`  Logs: ${r.logs.map(l => `${l.label}:${l.success?'ok':'FAIL'}`).join(', ')}`);
  } catch (e) {
    console.log(`  ✗ Run recipe failed: ${e.message}`);
    failed++;
  }

  // ── Test 8: Save workflow ──
  console.log('\n8. Save workflow');
  try {
    const r = parseResult(await client.callTool('browser_workflow_save', {
      name: 'multi-site-scrape',
      description: 'Visit multiple URLs and extract data from each',
      params: [
        { name: 'urls', description: 'Array of URLs to visit', required: true }
      ],
      steps: [
        {
          type: 'loop',
          forEach: {
            variable: 'urls',
            as: 'currentUrl',
            indexAs: 'urlIndex',
            steps: [
              {
                type: 'recipe',
                ref: 'navigate-and-extract',
                args: { url: '{{$currentUrl}}' },
                label: 'Extract from {{$currentUrl}}',
                onError: 'skip'
              }
            ]
          },
          label: 'Loop through URLs'
        }
      ],
      tags: ['scraping', 'multi-site']
    }));
    assert(r.name === 'multi-site-scrape', `Workflow saved: ${r.name}`);
  } catch (e) {
    console.log(`  ✗ Save workflow failed: ${e.message}`);
    failed++;
  }

  // ── Test 9: List workflows ──
  console.log('\n9. List workflows');
  try {
    const r = parseResult(await client.callTool('browser_workflow_list', {}));
    assert(r.count >= 1, `Listed ${r.count} workflows`);
  } catch (e) {
    console.log(`  ✗ List workflows failed: ${e.message}`);
    failed++;
  }

  // ── Test 10: Run workflow ──
  console.log('\n10. Run workflow');
  try {
    const r = parseResult(await client.callTool('browser_workflow_run', {
      instanceId,
      name: 'multi-site-scrape',
      params: { urls: ['https://example.com', 'https://httpbin.org/html'] }
    }));
    assert(r.stepsExecuted >= 2, `Steps executed: ${r.stepsExecuted}`);
    assert(r.totalDuration > 0, `Duration: ${r.totalDuration}ms`);
    console.log(`  Logs: ${r.logs.length} entries`);
    // Show extracted titles
    if (r.variables?.pageData?.result?.title) {
      console.log(`  Last page title: ${r.variables.pageData.result.title}`);
    }
  } catch (e) {
    console.log(`  ✗ Run workflow failed: ${e.message}`);
    failed++;
  }

  // ── Test 11: Save a more complex recipe with conditionals ──
  console.log('\n11. Save recipe with conditional steps');
  try {
    const r = parseResult(await client.callTool('browser_recipe_save', {
      name: 'smart-extract',
      description: 'Navigate and conditionally extract based on page content',
      params: [
        { name: 'url', required: true },
        { name: 'extractLinks', default: true }
      ],
      steps: [
        {
          tool: 'browser_navigate',
          args: { url: '{{url}}' },
          label: 'Navigate',
          extractAs: 'nav'
        },
        {
          tool: 'browser_evaluate',
          args: { script: 'document.title' },
          label: 'Get title',
          extractAs: 'title'
        },
        {
          tool: 'browser_evaluate',
          args: {
            script: `(function() {
              return Array.from(document.querySelectorAll('a[href]')).map(a => ({
                text: a.textContent?.trim().substring(0, 50),
                href: a.href
              })).filter(l => l.text).slice(0, 10);
            })()`
          },
          label: 'Extract links',
          extractAs: 'links',
          condition: 'extractLinks === true'
        }
      ],
      tags: ['extraction', 'conditional']
    }));
    assert(r.name === 'smart-extract', `Recipe saved: ${r.name}`);
    assert(r.stepsCount === 3, `Steps: ${r.stepsCount}`);
  } catch (e) {
    console.log(`  ✗ Save recipe failed: ${e.message}`);
    failed++;
  }

  // ── Test 12: Run recipe with conditional (condition true) ──
  console.log('\n12. Run recipe with condition=true');
  try {
    const r = parseResult(await client.callTool('browser_recipe_run', {
      instanceId,
      name: 'smart-extract',
      params: { url: 'https://example.com', extractLinks: true }
    }));
    assert(r.stepsExecuted === 3, `Steps executed: ${r.stepsExecuted} (all 3)`);
    assert(!!r.variables?.links, 'Links were extracted');
  } catch (e) {
    console.log(`  ✗ Run failed: ${e.message}`);
    failed++;
  }

  // ── Test 13: Run recipe with conditional (condition false) ──
  console.log('\n13. Run recipe with condition=false');
  try {
    const r = parseResult(await client.callTool('browser_recipe_run', {
      instanceId,
      name: 'smart-extract',
      params: { url: 'https://example.com', extractLinks: false }
    }));
    // The 3rd step should be skipped (condition false), so only 2 steps actually execute a tool
    assert(r.stepsExecuted === 2, `Steps executed: ${r.stepsExecuted} (skipped conditional)`);
  } catch (e) {
    console.log(`  ✗ Run failed: ${e.message}`);
    failed++;
  }

  // ── Cleanup ──
  console.log('\n14. Cleanup');
  try {
    await client.callTool('browser_close_instance', { instanceId });
    assert(true, 'Instance closed');
  } catch (e) {
    console.log(`  ✗ Cleanup failed: ${e.message}`);
    failed++;
  }

  // ── Results ──
  console.log(`\n${'═'.repeat(44)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('═'.repeat(44));

  client.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error('Fatal:', e);
  process.exit(1);
});
