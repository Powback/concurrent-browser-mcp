import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';

import { BrowserManager } from './browser-manager.js';
import { BrowserTools } from './tools.js';
import { ServerConfig } from './types.js';

export class ConcurrentBrowserServer {
  private browserManager: BrowserManager;
  private browserTools: BrowserTools;

  constructor(config: ServerConfig) {
    this.browserManager = new BrowserManager(config);
    this.browserTools = new BrowserTools(
      this.browserManager,
      config.omniparserUrl ?? process.env['OMNIPARSER_URL'],
      config.toolsProfile ?? 'full'
    );

    // Handle server shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down server...');
      await this.shutdown();
      process.exit(0);
    });

    process.on('SIGTERM', async () => {
      console.log('\nShutting down server...');
      await this.shutdown();
      process.exit(0);
    });
  }

  /** Wire up tool handlers on an MCP Server instance */
  private setupHandlers(server: Server) {
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: this.browserTools.getTools() };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        const result = await this.browserTools.executeTools(name, args || {});

        if (result.success) {
          // Screenshots return a proper image content block so the client
          // can render them inline, plus a small text block with metadata.
          // Screenshots → inline image content block
          if (result.data?.screenshot && typeof result.data.screenshot === 'string') {
            const mimeType = result.data.type === 'png' ? 'image/png' : 'image/jpeg';
            const meta = {
              instanceId: result.instanceId,
              selector: result.data.selector ?? null,
              format: result.data.type,
            };
            return {
              content: [
                { type: 'image', data: result.data.screenshot, mimeType },
                { type: 'text', text: JSON.stringify(meta, null, 2) },
              ],
            };
          }

          // OmniParser annotation → annotated image + element list
          if (result.data?.annotatedImage && typeof result.data.annotatedImage === 'string') {
            const elementSummary = {
              instanceId: result.instanceId,
              count: result.data.count,
              viewport: result.data.viewport,
              elements: result.data.elements,
            };
            return {
              content: [
                { type: 'image', data: result.data.annotatedImage, mimeType: 'image/png' },
                { type: 'text', text: JSON.stringify(elementSummary, null, 2) },
              ],
            };
          }

          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(result.data, null, 2),
              },
            ],
          };
        } else {
          throw new McpError(ErrorCode.InternalError, result.error || 'Tool execution failed');
        }
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        throw new McpError(
          ErrorCode.InternalError,
          `Tool execution failed: ${error instanceof Error ? error.message : error}`
        );
      }
    });
  }

  private createServer(): Server {
    const server = new Server(
      { name: 'concurrent-browser-mcp', version: '1.0.0' },
      { capabilities: { tools: {} } }
    );
    this.setupHandlers(server);
    return server;
  }

  /** Run in stdio mode (default, single client) */
  async run() {
    const server = this.createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Concurrent Browser MCP Server started (stdio)');
  }

  /** Run in SSE mode (HTTP server, multiple clients) */
  async runSSE(port: number) {
    // Map of sessionId → { transport, res, createdAt, lastActivity }
    const sessions = new Map<string, {
      transport: SSEServerTransport;
      res: ServerResponse;
      createdAt: number;
      lastActivity: number;
    }>();

    // Maximum concurrent SSE sessions — prevents runaway accumulation
    const MAX_SESSIONS = 100;

    // Session timeout: reap sessions idle for longer than this (ms)
    const SESSION_IDLE_TIMEOUT = 10 * 60 * 1000; // 10 minutes

    // Heartbeat interval: SSE comment to detect dead connections (ms)
    const HEARTBEAT_INTERVAL = 30_000; // 30 seconds

    // Stale session reaper — runs periodically to clean up leaked sessions
    const reaperInterval = setInterval(() => {
      const now = Date.now();
      let reaped = 0;
      for (const [sessionId, session] of sessions) {
        const idle = now - session.lastActivity;
        const destroyed = session.res.writableEnded || session.res.destroyed;
        if (destroyed || idle > SESSION_IDLE_TIMEOUT) {
          sessions.delete(sessionId);
          if (!destroyed) {
            try { session.res.end(); } catch {}
          }
          reaped++;
        }
      }
      if (reaped > 0) {
        console.error(`[sse] Reaped ${reaped} stale sessions (${sessions.size} active)`);
      }
    }, 60_000); // Check every 60s

    // Heartbeat — send SSE comment to all sessions to detect broken connections
    const heartbeatInterval = setInterval(() => {
      for (const [sessionId, session] of sessions) {
        try {
          if (session.res.writableEnded || session.res.destroyed) {
            // Connection already dead — clean up
            sessions.delete(sessionId);
            continue;
          }
          // SSE comment (colon-prefixed) — keeps connection alive, ignored by clients
          session.res.write(':heartbeat\n\n');
        } catch {
          // Write failed — connection is dead
          sessions.delete(sessionId);
          console.error(`[sse] Heartbeat failed for ${sessionId}, removed (${sessions.size} active)`);
        }
      }
    }, HEARTBEAT_INTERVAL);

    // Clean up intervals on server shutdown
    const origShutdown = this.shutdown.bind(this);
    this.shutdown = async () => {
      clearInterval(reaperInterval);
      clearInterval(heartbeatInterval);
      // Close all active SSE connections
      for (const [_sessionId, session] of sessions) {
        try { if (!session.res.writableEnded) session.res.end(); } catch {}
      }
      sessions.clear();
      await origShutdown();
    };

    const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);

      // Health check
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'ok',
          sessions: sessions.size,
          maxSessions: MAX_SESSIONS,
        }));
        return;
      }

      // SSE connection — each client gets its own MCP Server + transport
      if (req.method === 'GET' && url.pathname === '/sse') {
        // Reject new connections if at capacity
        if (sessions.size >= MAX_SESSIONS) {
          console.error(`[sse] Rejected new session — at capacity (${sessions.size}/${MAX_SESSIONS})`);
          res.writeHead(503, { 'Content-Type': 'text/plain' });
          res.end('Too many active sessions');
          return;
        }

        const server = this.createServer();
        const transport = new SSEServerTransport('/message', res);
        const now = Date.now();

        sessions.set(transport.sessionId, {
          transport,
          res,
          createdAt: now,
          lastActivity: now,
        });

        // Clean up on transport close (MCP SDK callback)
        transport.onclose = () => {
          sessions.delete(transport.sessionId);
          console.error(`[sse] Session ${transport.sessionId} closed via onclose (${sessions.size} active)`);
        };

        // Also clean up when the underlying HTTP response closes/errors
        // This catches TCP disconnects that the MCP SDK's onclose may miss
        const cleanup = () => {
          if (sessions.has(transport.sessionId)) {
            sessions.delete(transport.sessionId);
            console.error(`[sse] Session ${transport.sessionId} closed via socket event (${sessions.size} active)`);
          }
        };
        res.on('close', cleanup);
        res.on('error', cleanup);
        req.on('close', cleanup);
        req.on('error', cleanup);

        console.error(`[sse] New session ${transport.sessionId} (${sessions.size} active)`);
        await server.connect(transport);
        return;
      }

      // Message endpoint — route to the correct transport by sessionId
      if (req.method === 'POST' && url.pathname === '/message') {
        const sessionId = url.searchParams.get('sessionId');
        const session = sessionId ? sessions.get(sessionId) : undefined;
        if (!session) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Session not found');
          return;
        }
        // Update activity timestamp
        session.lastActivity = Date.now();
        await session.transport.handlePostMessage(req, res);
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    });

    httpServer.listen(port, () => {
      console.error(`Concurrent Browser MCP Server started (SSE on port ${port})`);
      console.error(`  Max sessions: ${MAX_SESSIONS}, idle timeout: ${SESSION_IDLE_TIMEOUT / 1000}s`);
    });
  }

  async shutdown() {
    try {
      await this.browserManager.destroy();
      console.error('Server closed');
    } catch (error) {
      console.error('Error closing server:', error);
    }
  }
}

// Default configuration
export const defaultConfig: ServerConfig = {
  maxInstances: 20,
  defaultBrowserConfig: {
    browserType: 'chromium',
    headless: true,
    viewport: {
      width: 1280,
      height: 720,
    },
    contextOptions: {
      ignoreHTTPSErrors: true,
    },
  },
  instanceTimeout: 30 * 60 * 1000, // 30 minutes
  cleanupInterval: 5 * 60 * 1000, // 5 minutes
  proxy: {
    autoDetect: true, // Enable proxy auto-detection by default
  },
}; 