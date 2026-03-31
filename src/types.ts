import { Browser, BrowserContext, Page } from 'playwright';

export interface ConsoleMessage {
  type: string;
  text: string;
  timestamp: string;
  source?: string;  // Source URL where the message originated
  line?: number;    // Line number in the source file
  column?: number;  // Column number in the source file
}

/** A single UI element returned by OmniParser */
export interface OmniParserElement {
  id: number;
  type: 'text' | 'icon';
  content: string;
  /** Normalised bounding box [x1, y1, x2, y2] in 0–1 range */
  bbox: [number, number, number, number];
  /** Pixel-space centre, computed from bbox × viewport at annotation time */
  center: { x: number; y: number };
}

export interface BrowserInstance {
  id: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  createdAt: Date;
  lastUsed: Date;
  isActive: boolean;
  consoleLogs: ConsoleMessage[];
  /** Elements from the most recent browser_annotate call */
  lastAnnotation: OmniParserElement[] | null;
  metadata?: {
    name?: string;
    tags?: string[];
    description?: string;
  };
}

export interface ProxyConfig {
  server?: string; // e.g., 'http://127.0.0.1:7890'
  autoDetect?: boolean; // Whether to auto-detect local proxy, defaults to true
}

export interface BrowserConfig {
  browserType: 'chromium' | 'firefox' | 'webkit';
  headless?: boolean;
  viewport?: {
    width: number;
    height: number;
  };
  userAgent?: string;
  proxy?: ProxyConfig;
  contextOptions?: {
    ignoreHTTPSErrors?: boolean;
    bypassCSP?: boolean;
    storageState?: string;
  };
}

export interface ServerConfig {
  maxInstances: number;
  defaultBrowserConfig: BrowserConfig;
  instanceTimeout: number; // in milliseconds
  cleanupInterval: number; // in milliseconds
  proxy?: ProxyConfig; // Global proxy configuration
  /**
   * Base URL of a running OmniParser server.
   * The tool will POST to {omniparserUrl}/parse.
   * Can also be set via the OMNIPARSER_URL environment variable.
   */
  omniparserUrl?: string;
  /**
   * Tool profile controls which tools are advertised to LLM clients.
   * - 'agent'    → 15 core automation tools (lowest context overhead)
   * - 'standard' → ~39 tools (removes admin/CRUD management tools)
   * - 'full'     → all 49 tools (default, backward compatible)
   */
  toolsProfile?: 'agent' | 'standard' | 'full';
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  instanceId?: string;
}

export interface NavigationOptions {
  timeout?: number;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
}

export interface ClickOptions {
  button?: 'left' | 'right' | 'middle';
  clickCount?: number;
  delay?: number;
  timeout?: number;
}

export interface TypeOptions {
  delay?: number;
  timeout?: number;
}

export interface ScreenshotOptions {
  fullPage?: boolean;
  clip?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  type?: 'png' | 'jpeg';
  quality?: number;
}

export interface ScrollOptions {
  selector?: string;
  x?: number;
  y?: number;
}

export interface KeyboardOptions {
  delay?: number;
}
