import { chromium, firefox, webkit, Browser } from 'playwright';
import { v4 as uuidv4 } from 'uuid';
import { BrowserInstance, BrowserConfig, ServerConfig, ToolResult, ConsoleMessage } from './types.js';
import { execSync } from 'child_process';

export class BrowserManager {
  private instances: Map<string, BrowserInstance> = new Map();
  private config: ServerConfig;
  private cleanupTimer?: NodeJS.Timeout;
  private detectedProxy?: string;

  constructor(config: ServerConfig) {
    this.config = config;
    this.startCleanupTimer();
    
    // Initialize proxy detection during construction
    this.initializeProxy();
  }

  /**
   * Initialize proxy configuration
   */
  private async initializeProxy(): Promise<void> {
    const globalProxy = this.config.proxy;
    if (globalProxy?.server) {
      this.detectedProxy = globalProxy.server;
      console.log(`Using configured proxy: ${this.detectedProxy}`);
    } else if (globalProxy?.autoDetect !== false) {
      // Enable auto-detection by default
      this.detectedProxy = await this.detectLocalProxy();
      if (this.detectedProxy) {
        console.log(`Auto-detected proxy: ${this.detectedProxy}`);
      }
    }
  }

  /**
   * Auto-detect local proxy
   */
  private async detectLocalProxy(): Promise<string | undefined> {
    // 1. Check environment variables
    const envProxy = this.getProxyFromEnv();
    if (envProxy) {
      console.log(`Proxy detected from environment variables: ${envProxy}`);
      return envProxy;
    }

    // 2. Check common proxy ports
    const commonPorts = [7890, 1087, 8080, 3128, 8888, 10809, 20171];
    for (const port of commonPorts) {
      const proxyUrl = `http://127.0.0.1:${port}`;
      if (await this.testProxyConnection(proxyUrl)) {
        console.log(`Local proxy port detected: ${port}`);
        return proxyUrl;
      }
    }

    // 3. Try to detect system proxy settings (macOS)
    if (process.platform === 'darwin') {
      const systemProxy = this.getMacOSSystemProxy();
      if (systemProxy) {
        console.log(`System proxy detected: ${systemProxy}`);
        return systemProxy;
      }
    }

    return undefined;
  }

  /**
   * Get proxy from environment variables
   */
  private getProxyFromEnv(): string | undefined {
    const httpProxy = process.env['HTTP_PROXY'] || process.env['http_proxy'];
    const httpsProxy = process.env['HTTPS_PROXY'] || process.env['https_proxy'];
    const allProxy = process.env['ALL_PROXY'] || process.env['all_proxy'];
    
    return httpProxy || httpsProxy || allProxy;
  }

  /**
   * Get macOS system proxy settings
   */
  private getMacOSSystemProxy(): string | undefined {
    try {
      const result = execSync('networksetup -getwebproxy "Wi-Fi" 2>/dev/null || networksetup -getwebproxy "Ethernet" 2>/dev/null', {
        encoding: 'utf8',
        timeout: 5000
      });
      
      const lines = result.split('\n');
      const enabled = lines.find(line => line.includes('Enabled: Yes'));
      if (!enabled) return undefined;
      
      const server = lines.find(line => line.includes('Server:'))?.split(': ')[1];
      const port = lines.find(line => line.includes('Port:'))?.split(': ')[1];
      
      if (server && port) {
        return `http://${server}:${port}`;
      }
    } catch (error) {
      // Ignore errors and continue with other methods
    }
    return undefined;
  }

  /**
   * Test proxy connection
   */
  private async testProxyConnection(proxyUrl: string): Promise<boolean> {
    try {
      // Simple port detection to avoid network request complexity
      const url = new URL(proxyUrl);
      const net = require('net');
      
      return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(3000);
        
        socket.on('connect', () => {
          socket.destroy();
          resolve(true);
        });
        
        socket.on('timeout', () => {
          socket.destroy();
          resolve(false);
        });
        
        socket.on('error', () => {
          resolve(false);
        });
        
        socket.connect(parseInt(url.port), url.hostname);
      });
    } catch (error) {
      return false;
    }
  }

  

  /**
   * Get effective proxy configuration
   */
  private getEffectiveProxy(browserConfig?: Partial<BrowserConfig>): string | undefined {
    // Priority: instance config > global config > auto-detected
    if (browserConfig?.proxy?.server) {
      return browserConfig.proxy.server;
    }
    
    if (browserConfig?.proxy?.autoDetect === false) {
      return undefined; // Explicitly disable proxy
    }
    
    return this.detectedProxy;
  }

  /**
   * Create a new browser instance
   */
  async createInstance(
    browserConfig?: Partial<BrowserConfig>,
    metadata?: BrowserInstance['metadata']
  ): Promise<ToolResult> {
    try {
      if (this.instances.size >= this.config.maxInstances) {
        return {
          success: false,
          error: `Maximum number of instances (${this.config.maxInstances}) reached`
        };
      }

      const config = { ...this.config.defaultBrowserConfig, ...browserConfig };
      const browser = await this.launchBrowser(config);
      
      const contextOptions: any = {
        viewport: config.viewport,
        ...config.contextOptions
      };
      if (config.userAgent) {
        contextOptions.userAgent = config.userAgent;
      }
      
      // Add proxy configuration to context
      const effectiveProxy = this.getEffectiveProxy(browserConfig);
      if (effectiveProxy) {
        contextOptions.proxy = { server: effectiveProxy };
      }
      
      const context = await browser.newContext(contextOptions);

      const page = await context.newPage();

      // Capture console messages from the page
      const consoleLogs: ConsoleMessage[] = [];
      const pushLog = (entry: ConsoleMessage) => {
        consoleLogs.push(entry);
        // Cap at 1000 messages to prevent unbounded memory growth
        if (consoleLogs.length > 1000) {
          consoleLogs.splice(0, consoleLogs.length - 1000);
        }
      };

      page.on('console', (msg: { type(): string; text(): string; location(): { url: string; lineNumber: number; columnNumber: number } }) => {
        const loc = msg.location();
        pushLog({
          type: msg.type(),
          text: msg.text(),
          timestamp: new Date().toISOString(),
          source: loc.url || undefined,
          line: loc.lineNumber,
          column: loc.columnNumber,
        });
      });

      // Capture uncaught exceptions and unhandled promise rejections
      page.on('pageerror', (error: Error) => {
        pushLog({
          type: 'uncaught-exception',
          text: error.message + (error.stack ? '\n' + error.stack : ''),
          timestamp: new Date().toISOString(),
        });
      });

      const instanceId = uuidv4();
      const instance: BrowserInstance = {
        id: instanceId,
        browser,
        context,
        page,
        consoleLogs,
        lastAnnotation: null,
        createdAt: new Date(),
        lastUsed: new Date(),
        isActive: true,
        ...(metadata && { metadata })
      };

      this.instances.set(instanceId, instance);

      return {
        success: true,
        data: {
          instanceId,
          browserType: config.browserType,
          headless: config.headless,
          viewport: config.viewport,
          proxy: effectiveProxy,
          metadata
        },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to create browser instance: ${error instanceof Error ? error.message : error}`
      };
    }
  }

  /**
   * Get browser instance
   */
  getInstance(instanceId: string): BrowserInstance | undefined {
    const instance = this.instances.get(instanceId);
    if (instance) {
      instance.lastUsed = new Date();
    }
    return instance;
  }

  /**
   * List all instances
   */
  listInstances(): ToolResult {
    const instanceList = Array.from(this.instances.values()).map(instance => ({
      id: instance.id,
      isActive: instance.isActive,
      createdAt: instance.createdAt.toISOString(),
      lastUsed: instance.lastUsed.toISOString(),
      metadata: instance.metadata,
      currentUrl: instance.page.url()
    }));

    return {
      success: true,
      data: {
        instances: instanceList,
        totalCount: this.instances.size,
        maxInstances: this.config.maxInstances
      }
    };
  }

  /**
   * Close browser instance
   */
  async closeInstance(instanceId: string): Promise<ToolResult> {
    try {
      const instance = this.instances.get(instanceId);
      if (!instance) {
        return {
          success: false,
          error: `Instance ${instanceId} not found`
        };
      }

      await instance.browser.close();
      this.instances.delete(instanceId);

      return {
        success: true,
        data: { instanceId, closed: true },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to close instance: ${error instanceof Error ? error.message : error}`
      };
    }
  }

  /**
   * Close all instances
   */
  async closeAllInstances(): Promise<ToolResult> {
    try {
      const closePromises = Array.from(this.instances.values()).map(
        instance => instance.browser.close()
      );
      
      await Promise.all(closePromises);
      const closedCount = this.instances.size;
      this.instances.clear();

      return {
        success: true,
        data: { closedCount }
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to close all instances: ${error instanceof Error ? error.message : error}`
      };
    }
  }

  /**
   * Launch browser
   */
  private async launchBrowser(config: BrowserConfig): Promise<Browser> {
    const launchOptions: any = {
      headless: config.headless ?? true
    };
    
    if (config.headless) {
      launchOptions.args = ['--no-sandbox', '--disable-setuid-sandbox'];
    }

    // Add proxy arguments for Chromium
    const effectiveProxy = this.getEffectiveProxy(config);
    if (effectiveProxy && config.browserType === 'chromium') {
      if (!launchOptions.args) {
        launchOptions.args = [];
      }
      launchOptions.args.push(`--proxy-server=${effectiveProxy}`);
    }

    switch (config.browserType) {
      case 'chromium':
        return await chromium.launch(launchOptions);
      case 'firefox':
        return await firefox.launch(launchOptions);
      case 'webkit':
        return await webkit.launch(launchOptions);
      default:
        throw new Error(`Unsupported browser type: ${config.browserType}`);
    }
  }

  /**
   * Start cleanup timer
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(async () => {
      await this.cleanupInactiveInstances();
    }, this.config.cleanupInterval);
  }

  /**
   * Clean up inactive instances
   */
  private async cleanupInactiveInstances(): Promise<void> {
    const now = new Date();
    const instancesToClose: string[] = [];

    for (const [id, instance] of this.instances.entries()) {
      const timeSinceLastUsed = now.getTime() - instance.lastUsed.getTime();
      if (timeSinceLastUsed > this.config.instanceTimeout) {
        instancesToClose.push(id);
      }
    }

    for (const instanceId of instancesToClose) {
      await this.closeInstance(instanceId);
      console.log(`Cleaned up inactive instance: ${instanceId}`);
    }
  }

  /**
   * Destroy manager
   */
  async destroy(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    await this.closeAllInstances();
  }
} 