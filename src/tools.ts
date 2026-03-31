import { Tool } from '@modelcontextprotocol/sdk/types.js';
import { BrowserManager } from './browser-manager.js';
import {
  ToolResult,
  NavigationOptions,
  ClickOptions,
  TypeOptions,
  ScreenshotOptions,
  ScrollOptions,
  KeyboardOptions,
  OmniParserElement,
} from './types.js';
import { AutomationStore, AutomationRunner } from './automation.js';

// ─── Profile constants ───────────────────────────────────────────────────────

/** Tools exposed in the 'agent' profile — minimal set for task automation */
const AGENT_PROFILE_TOOLS = new Set([
  'browser_create_instance',
  'browser_close_instance',
  'browser_execute',
  'browser_navigate',
  'browser_screenshot',
  'browser_get_markdown',
  'browser_evaluate',
  'browser_annotate',
  'browser_click_at',
  'browser_wait_for_element',
  'browser_get_page_info',
  'browser_recipe_save',
  'browser_recipe_run',
  'browser_workflow_save',
  'browser_workflow_run',
  'browser_get_console_logs',
  'browser_clear_console_logs',
]);

/** Tools omitted from 'standard' profile — admin/CRUD tools task agents never need */
const STANDARD_EXCLUDED_TOOLS = new Set([
  'browser_list_instances',
  'browser_close_all_instances',
  'browser_bookmarklet_save',
  'browser_bookmarklet_list',
  'browser_bookmarklet_run',
  'browser_bookmarklet_delete',
  'browser_recipe_list',
  'browser_recipe_delete',
  'browser_workflow_list',
  'browser_workflow_delete',
]);

// ─── Action type → tool name mapping for browser_execute ────────────────────

const ACTION_TYPE_MAP: Record<string, string> = {
  navigate: 'browser_navigate',
  click: 'browser_click',
  fill: 'browser_fill',
  type: 'browser_type',
  screenshot: 'browser_screenshot',
  wait: 'browser_wait_for_element',
  wait_for_element: 'browser_wait_for_element',
  wait_for_navigation: 'browser_wait_for_navigation',
  evaluate: 'browser_evaluate',
  scroll: 'browser_scroll',
  press: 'browser_keyboard_press',
  hover: 'browser_hover',
  check: 'browser_check',
  uncheck: 'browser_uncheck',
  select: 'browser_select_option',
  get_markdown: 'browser_get_markdown',
  get_text: 'browser_get_element_text',
  get_attribute: 'browser_get_element_attribute',
  go_back: 'browser_go_back',
  go_forward: 'browser_go_forward',
  refresh: 'browser_refresh',
  focus: 'browser_focus',
  click_at: 'browser_click_at',
  get_page_info: 'browser_get_page_info',
  drag_and_drop: 'browser_drag_and_drop',
};

export class BrowserTools {
  private automationStore: AutomationStore;
  private automationRunner: AutomationRunner;

  constructor(
    private browserManager: BrowserManager,
    private omniparserUrl?: string,
    private profile: 'agent' | 'standard' | 'full' = 'full'
  ) {
    this.automationStore = new AutomationStore();
    this.automationRunner = new AutomationRunner(
      this.automationStore,
      (name, args) => this.executeTools(name, args)
    );
  }

  /**
   * Get tool definitions filtered by the configured profile.
   * - 'agent'    → 15 core tools
   * - 'standard' → ~39 tools (all minus admin/CRUD management)
   * - 'full'     → all 49 tools (default)
   */
  getTools(): Tool[] {
    const all = this.getAllTools();
    if (this.profile === 'agent') {
      return all.filter(t => AGENT_PROFILE_TOOLS.has(t.name));
    }
    if (this.profile === 'standard') {
      return all.filter(t => !STANDARD_EXCLUDED_TOOLS.has(t.name));
    }
    return all;
  }

  /** All 49 tool definitions (including browser_execute). */
  private getAllTools(): Tool[] {
    return [
      // Instance management tools
      {
        name: 'browser_create_instance',
        description: 'Create a new browser instance',
        inputSchema: {
          type: 'object',
          properties: {
            browserType: {
              type: 'string',
              enum: ['chromium', 'firefox', 'webkit'],
              description: 'Browser type',
              default: 'chromium'
            },
            headless: {
              type: 'boolean',
              description: 'Whether to run in headless mode',
              default: true
            },
            viewport: {
              type: 'object',
              properties: {
                width: { type: 'number', default: 1280 },
                height: { type: 'number', default: 720 }
              },
              description: 'Viewport size'
            },
            userAgent: {
              type: 'string',
              description: 'User agent string'
            },
            metadata: {
              type: 'object',
              properties: {
                name: { type: 'string', description: 'Instance name' },
                description: { type: 'string', description: 'Instance description' },
                tags: { type: 'array', items: { type: 'string' }, description: 'Tags' }
              },
              description: 'Instance metadata'
            }
          }
        }
      },
      {
        name: 'browser_list_instances',
        description: 'List all browser instances',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },
      {
        name: 'browser_close_instance',
        description: 'Close the specified browser instance',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID'
            }
          },
          required: ['instanceId']
        }
      },
      {
        name: 'browser_close_all_instances',
        description: 'Close all browser instances',
        inputSchema: {
          type: 'object',
          properties: {}
        }
      },

      // Navigation tools
      {
        name: 'browser_navigate',
        description: 'Navigate to a specified URL',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID'
            },
            url: {
              type: 'string',
              description: 'Target URL',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 30000
            },
            waitUntil: {
              type: 'string',
              enum: ['load', 'domcontentloaded', 'networkidle'],
              description: 'Wait condition',
              default: 'load'
            }
          },
          required: ['instanceId', 'url']
        }
      },
      {
        name: 'browser_go_back',
        description: 'Go back to the previous page',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID'
            }
          },
          required: ['instanceId']
        }
      },
      {
        name: 'browser_go_forward',
        description: 'Go forward to the next page',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID'
            }
          },
          required: ['instanceId']
        }
      },
      {
        name: 'browser_refresh',
        description: 'Refresh the current page',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID'
            }
          },
          required: ['instanceId']
        }
      },

      // Page interaction tools
      {
        name: 'browser_click',
        description: 'Click on a page element',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID'
            },
            selector: {
              type: 'string',
              description: 'Element selector',
            },
            button: {
              type: 'string',
              enum: ['left', 'right', 'middle'],
              description: 'Mouse button',
              default: 'left'
            },
            clickCount: {
              type: 'number',
              description: 'Number of clicks',
              default: 1
            },
            delay: {
              type: 'number',
              description: 'Click delay in milliseconds',
              default: 0
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 30000
            }
          },
          required: ['instanceId', 'selector']
        }
      },
      {
        name: 'browser_type',
        description: 'Type text into an element',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID'
            },
            selector: {
              type: 'string',
              description: 'Element selector',
            },
            text: {
              type: 'string',
              description: 'Text to input',
            },
            delay: {
              type: 'number',
              description: 'Input delay in milliseconds',
              default: 0
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 30000
            }
          },
          required: ['instanceId', 'selector', 'text']
        }
      },
      {
        name: 'browser_fill',
        description: 'Fill a form field',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID'
            },
            selector: {
              type: 'string',
              description: 'Element selector',
            },
            value: {
              type: 'string',
              description: 'Value to fill',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 30000
            }
          },
          required: ['instanceId', 'selector', 'value']
        }
      },
      {
        name: 'browser_select_option',
        description: 'Select an option from a dropdown',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID'
            },
            selector: {
              type: 'string',
              description: 'Element selector',
            },
            value: {
              type: 'string',
              description: 'Value to select',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 30000
            }
          },
          required: ['instanceId', 'selector', 'value']
        }
      },

      // Page information tools
      {
        name: 'browser_get_page_info',
        description: 'Get detailed page information including full HTML content, page statistics, and metadata',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID'
            }
          },
          required: ['instanceId']
        }
      },
      {
        name: 'browser_get_element_text',
        description: 'Get element text content',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID'
            },
            selector: {
              type: 'string',
              description: 'Element selector',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 30000
            }
          },
          required: ['instanceId', 'selector']
        }
      },
      {
        name: 'browser_get_element_attribute',
        description: 'Get element attribute value',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID'
            },
            selector: {
              type: 'string',
              description: 'Element selector',
            },
            attribute: {
              type: 'string',
              description: 'Attribute name',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 30000
            }
          },
          required: ['instanceId', 'selector', 'attribute']
        }
      },

      // Screenshot tool
      {
        name: 'browser_screenshot',
        description: 'Take a screenshot of the page or element. IMPORTANT: Screenshots return base64-encoded image data which can be very large. Always use type="jpeg" with quality between 20-40 to keep token usage low. Only use type="png" when you need lossless quality for pixel-accurate inspection.',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID'
            },
            fullPage: {
              type: 'boolean',
              description: 'Whether to capture the full page',
              default: false
            },
            selector: {
              type: 'string',
              description: 'Element selector (capture specific element)'
            },
            type: {
              type: 'string',
              enum: ['png', 'jpeg'],
              description: 'Image format. Use "jpeg" to dramatically reduce token usage.',
              default: 'jpeg'
            },
            quality: {
              type: 'number',
              description: 'Image quality (1-100, JPEG only). Use 20-40 for general use to keep output small.',
              minimum: 1,
              maximum: 100,
              default: 30
            },
            clip: {
              type: 'object',
              description: 'Coordinate-based crop rectangle (alternative to CSS selector)',
              properties: {
                x: { type: 'number', description: 'X coordinate of the top-left corner' },
                y: { type: 'number', description: 'Y coordinate of the top-left corner' },
                width: { type: 'number', description: 'Width of the clip region in pixels' },
                height: { type: 'number', description: 'Height of the clip region in pixels' }
              },
              required: ['x', 'y', 'width', 'height']
            }
          },
          required: ['instanceId']
        }
      },

      // Wait tools
      {
        name: 'browser_wait_for_element',
        description: 'Wait for an element to appear',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID'
            },
            selector: {
              type: 'string',
              description: 'Element selector',
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 30000
            }
          },
          required: ['instanceId', 'selector']
        }
      },
      {
        name: 'browser_wait_for_navigation',
        description: 'Wait for page navigation to complete',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID'
            },
            timeout: {
              type: 'number',
              description: 'Timeout in milliseconds',
              default: 30000
            }
          },
          required: ['instanceId']
        }
      },

      // JavaScript execution tool
      {
        name: 'browser_evaluate',
        description: 'Execute JavaScript code in the page context. The script must be a valid expression or IIFE — top-level "return" statements are not allowed and will cause a SyntaxError. To return a value, either use an expression (e.g. "document.title") or wrap in an IIFE: "(function() { return value; })()".',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID'
            },
            script: {
              type: 'string',
              description: 'JavaScript expression or IIFE to execute. Must NOT use a bare top-level return statement.',
            }
          },
          required: ['instanceId', 'script']
        }
      },

      // Hover tool
      {
        name: 'browser_hover',
        description: 'Hover the mouse over an element',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'Instance ID' },
            selector: { type: 'string', description: 'Element selector' },
            timeout: { type: 'number', description: 'Timeout in milliseconds', default: 30000 }
          },
          required: ['instanceId', 'selector']
        }
      },

      // Keyboard tools
      {
        name: 'browser_keyboard_press',
        description: 'Press a keyboard key or key combination. Supports modifier combos like "Control+A", "Shift+Enter", "Meta+C".',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'Instance ID' },
            key: { type: 'string', description: 'Key to press (e.g. "Enter", "Tab", "Escape", "ArrowUp", "Control+A", "Meta+Shift+Z")' },
            delay: { type: 'number', description: 'Time in ms between keydown and keyup', default: 0 }
          },
          required: ['instanceId', 'key']
        }
      },
      {
        name: 'browser_keyboard_type',
        description: 'Type text using the keyboard without targeting a specific element. Useful after focusing an element with browser_focus.',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'Instance ID' },
            text: { type: 'string', description: 'Text to type' },
            delay: { type: 'number', description: 'Delay between keystrokes in milliseconds', default: 0 }
          },
          required: ['instanceId', 'text']
        }
      },

      // Scroll tool
      {
        name: 'browser_scroll',
        description: 'Scroll the page or a specific element by a given amount',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'Instance ID' },
            x: { type: 'number', description: 'Horizontal scroll amount in pixels (positive = right)', default: 0 },
            y: { type: 'number', description: 'Vertical scroll amount in pixels (positive = down)', default: 0 },
            selector: { type: 'string', description: 'Scroll within this element (omit to scroll the window)' }
          },
          required: ['instanceId']
        }
      },

      // Drag and drop tool
      {
        name: 'browser_drag_and_drop',
        description: 'Drag an element and drop it onto another element',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'Instance ID' },
            sourceSelector: { type: 'string', description: 'CSS selector for the element to drag' },
            targetSelector: { type: 'string', description: 'CSS selector for the drop target' },
            timeout: { type: 'number', description: 'Timeout in milliseconds', default: 30000 }
          },
          required: ['instanceId', 'sourceSelector', 'targetSelector']
        }
      },

      // Focus tool
      {
        name: 'browser_focus',
        description: 'Focus an element (useful before browser_keyboard_type)',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'Instance ID' },
            selector: { type: 'string', description: 'Element selector' },
            timeout: { type: 'number', description: 'Timeout in milliseconds', default: 30000 }
          },
          required: ['instanceId', 'selector']
        }
      },

      // Checkbox tools
      {
        name: 'browser_check',
        description: 'Check a checkbox or radio button',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'Instance ID' },
            selector: { type: 'string', description: 'Element selector' },
            timeout: { type: 'number', description: 'Timeout in milliseconds', default: 30000 }
          },
          required: ['instanceId', 'selector']
        }
      },
      {
        name: 'browser_uncheck',
        description: 'Uncheck a checkbox',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'Instance ID' },
            selector: { type: 'string', description: 'Element selector' },
            timeout: { type: 'number', description: 'Timeout in milliseconds', default: 30000 }
          },
          required: ['instanceId', 'selector']
        }
      },

      // Cookie tools
      {
        name: 'browser_get_cookies',
        description: 'Get cookies from the browser context',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'Instance ID' },
            urls: { type: 'array', items: { type: 'string' }, description: 'Filter cookies by URL (optional)' }
          },
          required: ['instanceId']
        }
      },
      {
        name: 'browser_set_cookies',
        description: 'Set cookies in the browser context',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'Instance ID' },
            cookies: {
              type: 'array',
              description: 'Cookies to set',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  value: { type: 'string' },
                  domain: { type: 'string' },
                  path: { type: 'string' },
                  expires: { type: 'number', description: 'Unix timestamp in seconds' },
                  httpOnly: { type: 'boolean' },
                  secure: { type: 'boolean' },
                  sameSite: { type: 'string', enum: ['Strict', 'Lax', 'None'] }
                },
                required: ['name', 'value']
              }
            }
          },
          required: ['instanceId', 'cookies']
        }
      },
      {
        name: 'browser_clear_cookies',
        description: 'Clear all cookies from the browser context',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'Instance ID' }
          },
          required: ['instanceId']
        }
      },

      // Console log tools
      {
        name: 'browser_get_console_logs',
        description: 'Get console messages captured from the page (console.log, warn, error, uncaught exceptions, etc.) with filtering, search, and pagination support. Each entry includes: timestamp, type, text, source URL, and line/column numbers.',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'Instance ID' },
            type: {
              type: 'string',
              enum: ['log', 'warn', 'error', 'info', 'debug', 'uncaught-exception'],
              description: 'Filter by log type (omit to return all types). Use "uncaught-exception" to see JS errors and unhandled promise rejections.'
            },
            search: {
              type: 'string',
              description: 'Filter messages whose text contains this substring (case-insensitive)'
            },
            regex: {
              type: 'string',
              description: 'Filter messages whose text matches this regular expression'
            },
            since: {
              type: 'string',
              description: 'ISO 8601 timestamp — only return messages at or after this time'
            },
            until: {
              type: 'string',
              description: 'ISO 8601 timestamp — only return messages at or before this time'
            },
            offset: {
              type: 'number',
              description: 'Number of matching entries to skip before returning results (for pagination)',
              default: 0
            },
            limit: { type: 'number', description: 'Maximum number of entries to return', default: 100 }
          },
          required: ['instanceId']
        }
      },
      {
        name: 'browser_clear_console_logs',
        description: 'Clear all captured console logs for a browser instance',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'Instance ID' }
          },
          required: ['instanceId']
        }
      },

      // OmniParser annotation tool
      {
        name: 'browser_annotate',
        description: [
          'Take a screenshot and send it to an OmniParser server for UI element detection.',
          'Returns an annotated screenshot with numbered bounding boxes drawn over every',
          'interactable element, plus a structured element list with pixel-space centre',
          'coordinates ready for browser_click_at.',
          'Requires OMNIPARSER_URL to be configured (env var or --omniparser-url flag).',
        ].join(' '),
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'Instance ID' },
            bbox_threshold: {
              type: 'number',
              description: 'Minimum detection confidence (0–1). Lower = more elements detected. Default 0.05.',
              default: 0.05,
            },
            iou_threshold: {
              type: 'number',
              description: 'Overlap threshold for suppressing duplicate boxes (0–1). Default 0.7.',
              default: 0.7,
            },
            selector: {
              type: 'string',
              description: 'Optional CSS selector — annotate only this element instead of the full page',
            },
          },
          required: ['instanceId'],
        },
      },

      // Raw coordinate click / move
      {
        name: 'browser_click_at',
        description: 'Click at raw pixel coordinates. Pair with browser_annotate: use the center.x / center.y from an element to click it precisely.',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'Instance ID' },
            x: { type: 'number', description: 'X pixel coordinate' },
            y: { type: 'number', description: 'Y pixel coordinate' },
            button: {
              type: 'string',
              enum: ['left', 'right', 'middle'],
              description: 'Mouse button to use',
              default: 'left',
            },
            clickCount: { type: 'number', description: 'Number of clicks (1 = click, 2 = double-click)', default: 1 },
            delay: { type: 'number', description: 'Delay between mousedown and mouseup in ms', default: 0 },
          },
          required: ['instanceId', 'x', 'y'],
        },
      },

      // Viewport resize tool
      {
        name: 'browser_resize_viewport',
        description: 'Resize the browser viewport',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'Instance ID' },
            width: { type: 'number', description: 'New viewport width in pixels' },
            height: { type: 'number', description: 'New viewport height in pixels' }
          },
          required: ['instanceId', 'width', 'height']
        }
      },

      // Content extraction tool
      {
        name: 'browser_get_markdown',
        description: 'Get page content in Markdown format, optimized for large language models',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Instance ID'
            },
            includeLinks: {
              type: 'boolean',
              description: 'Whether to include links',
              default: true
            },
            maxLength: {
              type: 'number',
              description: 'Maximum content length in characters',
              default: 10000
            },
            selector: {
              type: 'string',
              description: 'Optional CSS selector to extract content from specific element only'
            }
          },
          required: ['instanceId']
        }
      },

      // ─── Recipe tools ───────────────────────────────────────────────
      {
        name: 'browser_recipe_save',
        description: 'Save a reusable browser automation recipe — a named, parameterized sequence of browser tool calls. Recipes support variable interpolation ({{paramName}}, {{$varName}}), conditional steps, retry logic, and extracting data into variables for use in later steps.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Unique recipe name' },
            description: { type: 'string', description: 'What the recipe does' },
            params: {
              type: 'array',
              description: 'Parameterizable inputs for the recipe',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  default: { description: 'Default value' },
                  required: { type: 'boolean' }
                },
                required: ['name']
              }
            },
            steps: {
              type: 'array',
              description: 'Ordered steps to execute. Each step calls an existing browser_* tool.',
              items: {
                type: 'object',
                properties: {
                  tool: { type: 'string', description: 'Browser tool name (e.g. browser_navigate)' },
                  args: { type: 'object', description: 'Arguments. Use {{paramName}} or {{$varName}} for interpolation' },
                  extractAs: { type: 'string', description: 'Store step result in this variable name' },
                  condition: { type: 'string', description: 'JS expression — skip step if falsy' },
                  onError: { type: 'string', enum: ['stop', 'skip', 'retry'], description: 'Error handling strategy' },
                  retryCount: { type: 'number', description: 'Retries when onError=retry' },
                  delay: { type: 'number', description: 'Delay in ms before this step' },
                  label: { type: 'string', description: 'Human-readable step label' }
                },
                required: ['tool', 'args']
              }
            },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags for organization' }
          },
          required: ['name', 'description', 'steps']
        }
      },
      {
        name: 'browser_recipe_list',
        description: 'List all saved browser automation recipes, optionally filtered by tag',
        inputSchema: {
          type: 'object',
          properties: {
            tag: { type: 'string', description: 'Filter recipes by tag' }
          }
        }
      },
      {
        name: 'browser_recipe_run',
        description: 'Execute a saved recipe on a browser instance. Runs each step sequentially, supports variable interpolation, conditional logic, and retry. Returns extracted variables and step-by-step execution logs.',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'Browser instance ID' },
            name: { type: 'string', description: 'Recipe name or ID' },
            params: { type: 'object', description: 'Parameter values to pass to the recipe' }
          },
          required: ['instanceId', 'name']
        }
      },
      {
        name: 'browser_recipe_delete',
        description: 'Delete a saved recipe by name or ID',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Recipe name or ID' }
          },
          required: ['name']
        }
      },

      // ─── Bookmarklet tools ─────────────────────────────────────────
      {
        name: 'browser_bookmarklet_save',
        description: 'Save a reusable JavaScript bookmarklet — a named JS snippet that runs in page context. Useful for data extraction, page manipulation, or quick utility scripts. Supports {{param}} interpolation.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Unique bookmarklet name' },
            description: { type: 'string', description: 'What the bookmarklet does' },
            script: { type: 'string', description: 'JavaScript code to execute in page context (expression or IIFE)' },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags for organization' }
          },
          required: ['name', 'description', 'script']
        }
      },
      {
        name: 'browser_bookmarklet_list',
        description: 'List all saved bookmarklets, optionally filtered by tag',
        inputSchema: {
          type: 'object',
          properties: {
            tag: { type: 'string', description: 'Filter by tag' }
          }
        }
      },
      {
        name: 'browser_bookmarklet_run',
        description: 'Execute a saved bookmarklet on the current page of a browser instance. Returns the script result.',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'Browser instance ID' },
            name: { type: 'string', description: 'Bookmarklet name or ID' },
            params: { type: 'object', description: 'Parameters to interpolate into the script' }
          },
          required: ['instanceId', 'name']
        }
      },
      {
        name: 'browser_bookmarklet_delete',
        description: 'Delete a saved bookmarklet by name or ID',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Bookmarklet name or ID' }
          },
          required: ['name']
        }
      },

      // ─── Workflow tools ────────────────────────────────────────────
      {
        name: 'browser_workflow_save',
        description: 'Save a multi-step workflow that chains recipes, bookmarklets, and raw tool calls with loops and conditions. Workflows are the highest-level automation primitive — use them to build complex pipelines like scraping product data from multiple sites, form filling sequences, or multi-page data gathering.',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Unique workflow name' },
            description: { type: 'string', description: 'What the workflow does' },
            params: {
              type: 'array',
              description: 'Parameterizable inputs',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  description: { type: 'string' },
                  default: { description: 'Default value' },
                  required: { type: 'boolean' }
                },
                required: ['name']
              }
            },
            steps: {
              type: 'array',
              description: 'Workflow steps. Each step has a type: tool, recipe, bookmarklet, loop, or condition.',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['tool', 'recipe', 'bookmarklet', 'loop', 'condition'], description: 'Step type' },
                  ref: { type: 'string', description: 'Recipe/bookmarklet name (for type=recipe/bookmarklet)' },
                  tool: { type: 'string', description: 'Browser tool name (for type=tool)' },
                  args: { type: 'object', description: 'Arguments/params to pass' },
                  forEach: {
                    type: 'object',
                    description: 'Loop config (for type=loop)',
                    properties: {
                      variable: { type: 'string', description: 'Variable containing the array' },
                      as: { type: 'string', description: 'Iterator variable name' },
                      indexAs: { type: 'string', description: 'Index variable name' },
                      steps: { type: 'array', description: 'Steps to run per iteration', items: { type: 'object' } }
                    },
                    required: ['variable', 'as', 'steps']
                  },
                  if: {
                    type: 'object',
                    description: 'Condition config (for type=condition)',
                    properties: {
                      condition: { type: 'string', description: 'JS expression' },
                      then: { type: 'array', description: 'Steps if true', items: { type: 'object' } },
                      else: { type: 'array', description: 'Steps if false', items: { type: 'object' } }
                    },
                    required: ['condition', 'then']
                  },
                  extractAs: { type: 'string', description: 'Store result in variable' },
                  delay: { type: 'number', description: 'Delay in ms before step' },
                  label: { type: 'string', description: 'Step label' },
                  onError: { type: 'string', enum: ['stop', 'skip', 'retry'] },
                  retryCount: { type: 'number' }
                },
                required: ['type']
              }
            },
            tags: { type: 'array', items: { type: 'string' }, description: 'Tags for organization' }
          },
          required: ['name', 'description', 'steps']
        }
      },
      {
        name: 'browser_workflow_list',
        description: 'List all saved workflows, optionally filtered by tag',
        inputSchema: {
          type: 'object',
          properties: {
            tag: { type: 'string', description: 'Filter by tag' }
          }
        }
      },
      {
        name: 'browser_workflow_run',
        description: 'Execute a saved workflow on a browser instance. Runs steps sequentially, supports chaining recipes, bookmarklets, loops over extracted data, and conditional branching. Returns all extracted variables and step logs.',
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: { type: 'string', description: 'Browser instance ID' },
            name: { type: 'string', description: 'Workflow name or ID' },
            params: { type: 'object', description: 'Parameter values to pass to the workflow' }
          },
          required: ['instanceId', 'name']
        }
      },
      {
        name: 'browser_workflow_delete',
        description: 'Delete a saved workflow by name or ID',
        inputSchema: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Workflow name or ID' }
          },
          required: ['name']
        }
      },

      // ─── Bulk action tool ──────────────────────────────────────────
      {
        name: 'browser_execute',
        description: [
          'Execute multiple browser actions in sequence with a single tool call.',
          'More efficient than individual tool calls for automation sequences.',
          'Returns per-step results. Use stopOnError=false to continue past failures.',
          'Supported action types: navigate, click, fill, type, screenshot, wait,',
          'wait_for_element, wait_for_navigation, evaluate, scroll, press, hover,',
          'check, uncheck, select, get_markdown, get_text, get_attribute, go_back,',
          'go_forward, refresh, focus, click_at, get_page_info, drag_and_drop.',
        ].join(' '),
        inputSchema: {
          type: 'object',
          properties: {
            instanceId: {
              type: 'string',
              description: 'Browser instance ID (inherited by all actions)',
            },
            actions: {
              type: 'array',
              description: 'Ordered list of actions to execute sequentially',
              items: {
                type: 'object',
                properties: {
                  type: {
                    type: 'string',
                    description: 'Action type (navigate, click, fill, screenshot, wait, evaluate, etc.)',
                  },
                  // Navigation
                  url: { type: 'string', description: 'URL to navigate to (navigate)' },
                  waitUntil: { type: 'string', description: 'Navigation wait condition: load|domcontentloaded|networkidle (navigate)' },
                  // Element targeting
                  selector: { type: 'string', description: 'CSS selector (click, fill, wait, hover, etc.)' },
                  // Input
                  value: { type: 'string', description: 'Value to fill/select (fill, select)' },
                  text: { type: 'string', description: 'Text to type (type)' },
                  // JS
                  script: { type: 'string', description: 'JavaScript expression or IIFE (evaluate)' },
                  // Keyboard
                  key: { type: 'string', description: 'Key or combo to press, e.g. "Enter", "Control+A" (press)' },
                  // Screenshot
                  quality: { type: 'number', description: 'JPEG quality 1-100, default 30 (screenshot)' },
                  format: { type: 'string', enum: ['png', 'jpeg'], description: 'Image format (screenshot)' },
                  fullPage: { type: 'boolean', description: 'Full page capture (screenshot)' },
                  // Click at coordinates
                  x: { type: 'number', description: 'X pixel coordinate (click_at)' },
                  y: { type: 'number', description: 'Y pixel coordinate (click_at)' },
                  // Scroll
                  scrollX: { type: 'number', description: 'Horizontal scroll pixels (scroll)' },
                  scrollY: { type: 'number', description: 'Vertical scroll pixels (scroll)' },
                  // Drag and drop
                  sourceSelector: { type: 'string', description: 'Drag source selector (drag_and_drop)' },
                  targetSelector: { type: 'string', description: 'Drop target selector (drag_and_drop)' },
                  // Click options
                  button: { type: 'string', enum: ['left', 'right', 'middle'], description: 'Mouse button (click, click_at)' },
                  // Attribute
                  attribute: { type: 'string', description: 'Attribute name to get (get_attribute)' },
                  // Content extraction
                  maxLength: { type: 'number', description: 'Max chars to return (get_markdown)' },
                  // Common
                  timeout: { type: 'number', description: 'Timeout in ms, default 30000' },
                  delay: { type: 'number', description: 'Delay before this action in ms' },
                  onError: {
                    type: 'string',
                    enum: ['stop', 'skip'],
                    description: 'Error handling for this step: stop (default) or skip',
                  },
                },
                required: ['type'],
              },
            },
            stopOnError: {
              type: 'boolean',
              description: 'Stop execution on first failure (default true). Override per-step with action.onError.',
              default: true,
            },
          },
          required: ['instanceId', 'actions'],
        },
      },
    ];
  }

  /**
   * Execute tools
   */
  async executeTools(name: string, args: any): Promise<ToolResult> {
    try {
      switch (name) {
        case 'browser_create_instance':
          return await this.browserManager.createInstance(
            {
              browserType: args.browserType || 'chromium',
              headless: args.headless ?? true,
              viewport: args.viewport || { width: 1280, height: 720 },
              userAgent: args.userAgent
            },
            args.metadata
          );

        case 'browser_list_instances':
          return this.browserManager.listInstances();

        case 'browser_close_instance':
          return await this.browserManager.closeInstance(args.instanceId);

        case 'browser_close_all_instances':
          return await this.browserManager.closeAllInstances();

        case 'browser_navigate':
          return await this.navigate(args.instanceId, args.url, {
            timeout: args.timeout || 30000,
            waitUntil: args.waitUntil || 'load'
          });

        case 'browser_go_back':
          return await this.goBack(args.instanceId);

        case 'browser_go_forward':
          return await this.goForward(args.instanceId);

        case 'browser_refresh':
          return await this.refresh(args.instanceId);

        case 'browser_click':
          return await this.click(args.instanceId, args.selector, {
            button: args.button || 'left',
            clickCount: args.clickCount || 1,
            delay: args.delay || 0,
            timeout: args.timeout || 30000
          });

        case 'browser_type':
          return await this.type(args.instanceId, args.selector, args.text, {
            delay: args.delay || 0,
            timeout: args.timeout || 30000
          });

        case 'browser_fill':
          return await this.fill(args.instanceId, args.selector, args.value, args.timeout || 30000);

        case 'browser_select_option':
          return await this.selectOption(args.instanceId, args.selector, args.value, args.timeout || 30000);

        case 'browser_get_page_info':
          return await this.getPageInfo(args.instanceId);

        case 'browser_get_element_text':
          return await this.getElementText(args.instanceId, args.selector, args.timeout || 30000);

        case 'browser_get_element_attribute':
          return await this.getElementAttribute(args.instanceId, args.selector, args.attribute, args.timeout || 30000);

        case 'browser_screenshot':
          return await this.screenshot(args.instanceId, {
            fullPage: args.fullPage || false,
            type: args.type || 'jpeg',
            quality: args.quality || 30,
            clip: args.clip
          }, args.selector);

        case 'browser_wait_for_element':
          return await this.waitForElement(args.instanceId, args.selector, args.timeout || 30000);

        case 'browser_wait_for_navigation':
          return await this.waitForNavigation(args.instanceId, args.timeout || 30000);

        case 'browser_evaluate':
          return await this.evaluate(args.instanceId, args.script);

        case 'browser_get_markdown':
          return await this.getMarkdown(args.instanceId, {
            includeLinks: args.includeLinks ?? true,
            maxLength: args.maxLength || 10000,
            selector: args.selector
          });

        case 'browser_hover':
          return await this.hover(args.instanceId, args.selector, args.timeout || 30000);

        case 'browser_keyboard_press':
          return await this.keyboardPress(args.instanceId, args.key, { delay: args.delay || 0 });

        case 'browser_keyboard_type':
          return await this.keyboardType(args.instanceId, args.text, { delay: args.delay || 0 });

        case 'browser_scroll':
          return await this.scroll(args.instanceId, {
            selector: args.selector,
            x: args.x || 0,
            y: args.y || 0
          });

        case 'browser_drag_and_drop':
          return await this.dragAndDrop(args.instanceId, args.sourceSelector, args.targetSelector, args.timeout || 30000);

        case 'browser_focus':
          return await this.focus(args.instanceId, args.selector, args.timeout || 30000);

        case 'browser_check':
          return await this.check(args.instanceId, args.selector, args.timeout || 30000);

        case 'browser_uncheck':
          return await this.uncheck(args.instanceId, args.selector, args.timeout || 30000);

        case 'browser_get_cookies':
          return await this.getCookies(args.instanceId, args.urls);

        case 'browser_set_cookies':
          return await this.setCookies(args.instanceId, args.cookies);

        case 'browser_clear_cookies':
          return await this.clearCookies(args.instanceId);

        case 'browser_get_console_logs':
          return this.getConsoleLogs(args.instanceId, {
            type: args.type,
            search: args.search,
            regex: args.regex,
            since: args.since,
            until: args.until,
            offset: args.offset || 0,
            limit: args.limit || 100,
          });

        case 'browser_clear_console_logs':
          return this.clearConsoleLogs(args.instanceId);

        case 'browser_resize_viewport':
          return await this.resizeViewport(args.instanceId, args.width, args.height);

        case 'browser_annotate':
          return await this.annotate(args.instanceId, {
            bboxThreshold: args.bbox_threshold ?? 0.05,
            iouThreshold: args.iou_threshold ?? 0.7,
            selector: args.selector,
          });

        case 'browser_click_at':
          return await this.clickAt(args.instanceId, args.x, args.y, {
            button: args.button || 'left',
            clickCount: args.clickCount || 1,
            delay: args.delay || 0,
          });

        // ─── Recipe tools ──────────────────────────────────────────
        case 'browser_recipe_save': {
          const recipe = this.automationStore.saveRecipe({
            name: args.name,
            description: args.description,
            params: args.params || [],
            steps: args.steps,
            tags: args.tags || [],
          });
          return { success: true, data: { id: recipe.id, name: recipe.name, stepsCount: recipe.steps.length, message: `Recipe "${recipe.name}" saved` } };
        }

        case 'browser_recipe_list': {
          const recipes = this.automationStore.listRecipes(args.tag);
          return {
            success: true,
            data: {
              count: recipes.length,
              recipes: recipes.map(r => ({
                id: r.id,
                name: r.name,
                description: r.description,
                params: r.params.map(p => p.name),
                stepsCount: r.steps.length,
                tags: r.tags,
                updatedAt: r.updatedAt,
              })),
            },
          };
        }

        case 'browser_recipe_run': {
          const result = await this.automationRunner.runRecipe(
            args.name,
            args.instanceId,
            args.params || {}
          );
          return {
            success: result.success,
            data: {
              stepsExecuted: result.stepsExecuted,
              totalDuration: result.totalDuration,
              variables: result.variables,
              logs: result.logs,
            },
            error: result.error,
            instanceId: args.instanceId,
          };
        }

        case 'browser_recipe_delete': {
          const deleted = this.automationStore.deleteRecipe(args.name);
          return deleted
            ? { success: true, data: { deleted: true, name: args.name } }
            : { success: false, error: `Recipe not found: ${args.name}` };
        }

        // ─── Bookmarklet tools ─────────────────────────────────────
        case 'browser_bookmarklet_save': {
          const bm = this.automationStore.saveBookmarklet({
            name: args.name,
            description: args.description,
            script: args.script,
            tags: args.tags || [],
          });
          return { success: true, data: { id: bm.id, name: bm.name, message: `Bookmarklet "${bm.name}" saved` } };
        }

        case 'browser_bookmarklet_list': {
          const bms = this.automationStore.listBookmarklets(args.tag);
          return {
            success: true,
            data: {
              count: bms.length,
              bookmarklets: bms.map(b => ({
                id: b.id,
                name: b.name,
                description: b.description,
                scriptLength: b.script.length,
                tags: b.tags,
                updatedAt: b.updatedAt,
              })),
            },
          };
        }

        case 'browser_bookmarklet_run': {
          return await this.automationRunner.runBookmarklet(
            args.name,
            args.instanceId,
            args.params || {}
          );
        }

        case 'browser_bookmarklet_delete': {
          const deleted = this.automationStore.deleteBookmarklet(args.name);
          return deleted
            ? { success: true, data: { deleted: true, name: args.name } }
            : { success: false, error: `Bookmarklet not found: ${args.name}` };
        }

        // ─── Workflow tools ────────────────────────────────────────
        case 'browser_workflow_save': {
          const wf = this.automationStore.saveWorkflow({
            name: args.name,
            description: args.description,
            params: args.params || [],
            steps: args.steps,
            tags: args.tags || [],
          });
          return { success: true, data: { id: wf.id, name: wf.name, stepsCount: wf.steps.length, message: `Workflow "${wf.name}" saved` } };
        }

        case 'browser_workflow_list': {
          const wfs = this.automationStore.listWorkflows(args.tag);
          return {
            success: true,
            data: {
              count: wfs.length,
              workflows: wfs.map(w => ({
                id: w.id,
                name: w.name,
                description: w.description,
                params: w.params.map(p => p.name),
                stepsCount: w.steps.length,
                tags: w.tags,
                updatedAt: w.updatedAt,
              })),
            },
          };
        }

        case 'browser_workflow_run': {
          const result = await this.automationRunner.runWorkflow(
            args.name,
            args.instanceId,
            args.params || {}
          );
          return {
            success: result.success,
            data: {
              stepsExecuted: result.stepsExecuted,
              totalDuration: result.totalDuration,
              variables: result.variables,
              logs: result.logs,
            },
            error: result.error,
            instanceId: args.instanceId,
          };
        }

        case 'browser_workflow_delete': {
          const deleted = this.automationStore.deleteWorkflow(args.name);
          return deleted
            ? { success: true, data: { deleted: true, name: args.name } }
            : { success: false, error: `Workflow not found: ${args.name}` };
        }

        // ─── Bulk action tool ──────────────────────────────────────
        case 'browser_execute': {
          const { instanceId, actions, stopOnError = true } = args as {
            instanceId: string;
            actions: Array<{ type: string; onError?: 'stop' | 'skip'; delay?: number; [key: string]: any }>;
            stopOnError?: boolean;
          };

          const steps: Array<{
            index: number;
            type: string;
            success: boolean;
            duration: number;
            data?: any;
            error?: string;
          }> = [];
          const startTime = Date.now();
          let stepsExecuted = 0;

          for (let i = 0; i < actions.length; i++) {
            const action = actions[i]!;
            const { type, onError: stepOnError, delay: stepDelay, ...actionArgs } = action;
            const stepStart = Date.now();

            if (stepDelay) {
              await new Promise(r => setTimeout(r, stepDelay));
            }

            const toolName = ACTION_TYPE_MAP[type];
            if (!toolName) {
              const step = { index: i, type, success: false, duration: 0, error: `Unknown action type: ${type}` };
              steps.push(step);
              const errBehavior = stepOnError ?? (stopOnError ? 'stop' : 'skip');
              if (errBehavior === 'stop') {
                return { success: false, instanceId, data: { steps, stepsExecuted, totalDuration: Date.now() - startTime, failedAt: i }, error: step.error };
              }
              continue;
            }

            // Build tool args — map bulk action params to individual tool param names
            const toolArgs: Record<string, any> = { instanceId, ...actionArgs };
            // Remap bulk-specific aliases
            if (toolArgs['scrollX'] !== undefined) { toolArgs['x'] = toolArgs['scrollX']; delete toolArgs['scrollX']; }
            if (toolArgs['scrollY'] !== undefined) { toolArgs['y'] = toolArgs['scrollY']; delete toolArgs['scrollY']; }
            if (toolArgs['format'] !== undefined) { toolArgs['type'] = toolArgs['format']; delete toolArgs['format']; }

            let result: ToolResult;
            try {
              result = await this.executeTools(toolName, toolArgs);
            } catch (err) {
              result = { success: false, error: err instanceof Error ? err.message : String(err) };
            }

            stepsExecuted++;
            const stepData = result.success ? result.data : undefined;
            // Strip screenshot binary from bulk results to avoid bloating the response
            const safeData = stepData?.screenshot ? { ...stepData, screenshot: `[base64 ${stepData.type ?? 'jpeg'}, ${(stepData.screenshot as string).length} chars]` } : stepData;

            const stepLog = { index: i, type, success: result.success, duration: Date.now() - stepStart, data: safeData, error: result.success ? undefined : result.error };
            steps.push(stepLog);

            if (!result.success) {
              const errBehavior = stepOnError ?? (stopOnError ? 'stop' : 'skip');
              if (errBehavior === 'stop') {
                return { success: false, instanceId, data: { steps, stepsExecuted, totalDuration: Date.now() - startTime, failedAt: i }, error: `Step ${i} (${type}) failed: ${result.error}` };
              }
            }
          }

          return { success: true, instanceId, data: { steps, stepsExecuted, totalDuration: Date.now() - startTime } };
        }

        default:
          return {
            success: false,
            error: `Unknown tool: ${name}`
          };
      }
    } catch (error) {
      return {
        success: false,
        error: `Tool execution failed: ${error instanceof Error ? error.message : error}`
      };
    }
  }

  // Implementation of specific tool methods
  private async navigate(instanceId: string, url: string, options: NavigationOptions): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) {
      return { success: false, error: `Instance ${instanceId} not found` };
    }

    try {
      const gotoOptions: any = {
        waitUntil: options.waitUntil
      };
      if (options.timeout) {
        gotoOptions.timeout = options.timeout;
      }
      await instance.page.goto(url, gotoOptions);
      return {
        success: true,
        data: { url: instance.page.url(), title: await instance.page.title() },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Navigation failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async goBack(instanceId: string): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) {
      return { success: false, error: `Instance ${instanceId} not found` };
    }

    try {
      await instance.page.goBack();
      return {
        success: true,
        data: { url: instance.page.url() },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Go back failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async goForward(instanceId: string): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) {
      return { success: false, error: `Instance ${instanceId} not found` };
    }

    try {
      await instance.page.goForward();
      return {
        success: true,
        data: { url: instance.page.url() },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Go forward failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async refresh(instanceId: string): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) {
      return { success: false, error: `Instance ${instanceId} not found` };
    }

    try {
      await instance.page.reload();
      return {
        success: true,
        data: { url: instance.page.url() },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Refresh failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async click(instanceId: string, selector: string, options: ClickOptions): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) {
      return { success: false, error: `Instance ${instanceId} not found` };
    }

    try {
      const clickOptions: any = {
        button: options.button
      };
      if (options.clickCount) clickOptions.clickCount = options.clickCount;
      if (options.delay) clickOptions.delay = options.delay;
      if (options.timeout) clickOptions.timeout = options.timeout;
      await instance.page.click(selector, clickOptions);
      return {
        success: true,
        data: { selector, clicked: true },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Click failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async type(instanceId: string, selector: string, text: string, options: TypeOptions): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) {
      return { success: false, error: `Instance ${instanceId} not found` };
    }

    try {
      const typeOptions: any = {};
      if (options.delay) typeOptions.delay = options.delay;
      if (options.timeout) typeOptions.timeout = options.timeout;
      await instance.page.type(selector, text, typeOptions);
      return {
        success: true,
        data: { selector, text, typed: true },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Type failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async fill(instanceId: string, selector: string, value: string, timeout: number): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) {
      return { success: false, error: `Instance ${instanceId} not found` };
    }

    try {
      await instance.page.fill(selector, value, { timeout });
      return {
        success: true,
        data: { selector, value, filled: true },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Fill failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async selectOption(instanceId: string, selector: string, value: string, timeout: number): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) {
      return { success: false, error: `Instance ${instanceId} not found` };
    }

    try {
      await instance.page.selectOption(selector, value, { timeout });
      return {
        success: true,
        data: { selector, value, selected: true },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Select option failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async getPageInfo(instanceId: string): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) {
      return { success: false, error: `Instance ${instanceId} not found` };
    }

    try {
      const url = instance.page.url();
      const title = await instance.page.title();
      const content = await instance.page.content();
      
      // Get additional page information
      const viewport = instance.page.viewportSize();
      const loadState = await instance.page.evaluate(() => document.readyState);
      
      // Get basic page statistics
      const pageStats = await instance.page.evaluate(() => {
        const links = document.querySelectorAll('a[href]').length;
        const images = document.querySelectorAll('img').length;
        const forms = document.querySelectorAll('form').length;
        const scripts = document.querySelectorAll('script').length;
        const stylesheets = document.querySelectorAll('link[rel="stylesheet"]').length;
        
        return {
          linksCount: links,
          imagesCount: images,
          formsCount: forms,
          scriptsCount: scripts,
          stylesheetsCount: stylesheets
        };
      });
      
      return {
        success: true,
        data: { 
          url, 
          title, 
          content,  // Return complete HTML content
          contentLength: content.length,
          viewport,
          loadState,
          stats: pageStats,
          timestamp: new Date().toISOString()
        },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Get page info failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async getElementText(instanceId: string, selector: string, timeout: number): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) {
      return { success: false, error: `Instance ${instanceId} not found` };
    }

    try {
      const text = await instance.page.textContent(selector, { timeout });
      return {
        success: true,
        data: { selector, text },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Get element text failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async getElementAttribute(instanceId: string, selector: string, attribute: string, timeout: number): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) {
      return { success: false, error: `Instance ${instanceId} not found` };
    }

    try {
      const value = await instance.page.getAttribute(selector, attribute, { timeout });
      return {
        success: true,
        data: { selector, attribute, value },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Get element attribute failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async screenshot(instanceId: string, options: ScreenshotOptions, selector?: string): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) {
      return { success: false, error: `Instance ${instanceId} not found` };
    }

    try {
      let screenshotData: Buffer;
      
      if (selector) {
        const element = await instance.page.$(selector);
        if (!element) {
          return { success: false, error: `Element not found: ${selector}`, instanceId };
        }
        screenshotData = await element.screenshot({
          type: options.type,
          quality: options.type === 'jpeg' ? options.quality : undefined
        });
      } else {
        screenshotData = await instance.page.screenshot({
          fullPage: options.fullPage,
          type: options.type,
          quality: options.type === 'jpeg' ? options.quality : undefined,
          clip: options.clip
        });
      }

      return {
        success: true,
        data: { 
          screenshot: screenshotData.toString('base64'),
          type: options.type,
          selector
        },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Screenshot failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async waitForElement(instanceId: string, selector: string, timeout: number): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) {
      return { success: false, error: `Instance ${instanceId} not found` };
    }

    try {
      await instance.page.waitForSelector(selector, { timeout });
      return {
        success: true,
        data: { selector, found: true },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Wait for element failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async waitForNavigation(instanceId: string, timeout: number): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) {
      return { success: false, error: `Instance ${instanceId} not found` };
    }

    try {
      await instance.page.waitForNavigation({ timeout });
      return {
        success: true,
        data: { url: instance.page.url() },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Wait for navigation failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async evaluate(instanceId: string, script: string): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) {
      return { success: false, error: `Instance ${instanceId} not found` };
    }

    // Auto-wrap scripts that start with a bare top-level `return` into an IIFE,
    // since page.evaluate() requires an expression or IIFE, not a bare return.
    // Only match a leading `return` — do NOT match `return` inside function
    // bodies (e.g. IIFEs), which would cause destructive double-wrapping.
    const trimmed = script.trim();
    const hasBareReturn = /^return\s/.test(trimmed);
    const wrappedScript = hasBareReturn ? `(function() {\n${script}\n})()` : script;

    try {
      const result = await instance.page.evaluate(wrappedScript);
      return {
        success: true,
        data: { script, result },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Evaluate failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }

  private async hover(instanceId: string, selector: string, timeout: number): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) return { success: false, error: `Instance ${instanceId} not found` };
    try {
      await instance.page.hover(selector, { timeout });
      return { success: true, data: { selector, hovered: true }, instanceId };
    } catch (error) {
      return { success: false, error: `Hover failed: ${error instanceof Error ? error.message : error}`, instanceId };
    }
  }

  private async keyboardPress(instanceId: string, key: string, options: KeyboardOptions): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) return { success: false, error: `Instance ${instanceId} not found` };
    try {
      await instance.page.keyboard.press(key, { delay: options.delay });
      return { success: true, data: { key, pressed: true }, instanceId };
    } catch (error) {
      return { success: false, error: `Keyboard press failed: ${error instanceof Error ? error.message : error}`, instanceId };
    }
  }

  private async keyboardType(instanceId: string, text: string, options: KeyboardOptions): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) return { success: false, error: `Instance ${instanceId} not found` };
    try {
      await instance.page.keyboard.type(text, { delay: options.delay });
      return { success: true, data: { text, typed: true }, instanceId };
    } catch (error) {
      return { success: false, error: `Keyboard type failed: ${error instanceof Error ? error.message : error}`, instanceId };
    }
  }

  private async scroll(instanceId: string, options: ScrollOptions): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) return { success: false, error: `Instance ${instanceId} not found` };
    try {
      const { selector, x = 0, y = 0 } = options;
      if (selector) {
        await instance.page.evaluate(
          ({ sel, dx, dy }: { sel: string; dx: number; dy: number }) => {
            const el = document.querySelector(sel);
            if (el) (el as Element & { scrollBy(x: number, y: number): void }).scrollBy(dx, dy);
          },
          { sel: selector, dx: x, dy: y }
        );
      } else {
        await instance.page.evaluate(
          ({ dx, dy }: { dx: number; dy: number }) => window.scrollBy(dx, dy),
          { dx: x, dy: y }
        );
      }
      return { success: true, data: { x, y, selector }, instanceId };
    } catch (error) {
      return { success: false, error: `Scroll failed: ${error instanceof Error ? error.message : error}`, instanceId };
    }
  }

  private async dragAndDrop(instanceId: string, sourceSelector: string, targetSelector: string, timeout: number): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) return { success: false, error: `Instance ${instanceId} not found` };
    try {
      await instance.page.dragAndDrop(sourceSelector, targetSelector, { timeout });
      return { success: true, data: { sourceSelector, targetSelector, dropped: true }, instanceId };
    } catch (error) {
      return { success: false, error: `Drag and drop failed: ${error instanceof Error ? error.message : error}`, instanceId };
    }
  }

  private async focus(instanceId: string, selector: string, timeout: number): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) return { success: false, error: `Instance ${instanceId} not found` };
    try {
      await instance.page.focus(selector, { timeout });
      return { success: true, data: { selector, focused: true }, instanceId };
    } catch (error) {
      return { success: false, error: `Focus failed: ${error instanceof Error ? error.message : error}`, instanceId };
    }
  }

  private async check(instanceId: string, selector: string, timeout: number): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) return { success: false, error: `Instance ${instanceId} not found` };
    try {
      await instance.page.check(selector, { timeout });
      return { success: true, data: { selector, checked: true }, instanceId };
    } catch (error) {
      return { success: false, error: `Check failed: ${error instanceof Error ? error.message : error}`, instanceId };
    }
  }

  private async uncheck(instanceId: string, selector: string, timeout: number): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) return { success: false, error: `Instance ${instanceId} not found` };
    try {
      await instance.page.uncheck(selector, { timeout });
      return { success: true, data: { selector, unchecked: true }, instanceId };
    } catch (error) {
      return { success: false, error: `Uncheck failed: ${error instanceof Error ? error.message : error}`, instanceId };
    }
  }

  private async getCookies(instanceId: string, urls?: string[]): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) return { success: false, error: `Instance ${instanceId} not found` };
    try {
      const cookies = await instance.context.cookies(urls);
      return { success: true, data: { cookies, count: cookies.length }, instanceId };
    } catch (error) {
      return { success: false, error: `Get cookies failed: ${error instanceof Error ? error.message : error}`, instanceId };
    }
  }

  private async setCookies(instanceId: string, cookies: any[]): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) return { success: false, error: `Instance ${instanceId} not found` };
    try {
      await instance.context.addCookies(cookies);
      return { success: true, data: { added: cookies.length }, instanceId };
    } catch (error) {
      return { success: false, error: `Set cookies failed: ${error instanceof Error ? error.message : error}`, instanceId };
    }
  }

  private async clearCookies(instanceId: string): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) return { success: false, error: `Instance ${instanceId} not found` };
    try {
      await instance.context.clearCookies();
      return { success: true, data: { cleared: true }, instanceId };
    } catch (error) {
      return { success: false, error: `Clear cookies failed: ${error instanceof Error ? error.message : error}`, instanceId };
    }
  }

  private getConsoleLogs(instanceId: string, opts: {
    type?: string;
    search?: string;
    regex?: string;
    since?: string;
    until?: string;
    offset?: number;
    limit?: number;
  }): ToolResult {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) return { success: false, error: `Instance ${instanceId} not found` };

    const { type, search, regex, since, until, offset = 0, limit = 100 } = opts;

    let re: RegExp | null = null;
    if (regex) {
      try {
        re = new RegExp(regex, 'i');
      } catch {
        return { success: false, error: `Invalid regex: ${regex}`, instanceId };
      }
    }

    const sinceMs = since ? new Date(since).getTime() : null;
    const untilMs = until ? new Date(until).getTime() : null;

    let logs = instance.consoleLogs.filter(l => {
      if (type && l.type !== type) return false;
      if (search && !l.text.toLowerCase().includes(search.toLowerCase())) return false;
      if (re && !re.test(l.text)) return false;
      if (sinceMs !== null && new Date(l.timestamp).getTime() < sinceMs) return false;
      if (untilMs !== null && new Date(l.timestamp).getTime() > untilMs) return false;
      return true;
    });

    const totalMatched = logs.length;
    const page = logs.slice(offset, offset + limit);

    return {
      success: true,
      data: {
        logs: page,
        totalMatched,
        totalCaptured: instance.consoleLogs.length,
        returned: page.length,
        offset,
        limit,
      },
      instanceId,
    };
  }

  private clearConsoleLogs(instanceId: string): ToolResult {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) return { success: false, error: `Instance ${instanceId} not found` };
    instance.consoleLogs.splice(0);
    return { success: true, data: { cleared: true }, instanceId };
  }

  private async resizeViewport(instanceId: string, width: number, height: number): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) return { success: false, error: `Instance ${instanceId} not found` };
    try {
      await instance.page.setViewportSize({ width, height });
      return { success: true, data: { width, height }, instanceId };
    } catch (error) {
      return { success: false, error: `Resize viewport failed: ${error instanceof Error ? error.message : error}`, instanceId };
    }
  }

  private async clickAt(
    instanceId: string,
    x: number,
    y: number,
    opts: { button: 'left' | 'right' | 'middle'; clickCount: number; delay: number }
  ): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) return { success: false, error: `Instance ${instanceId} not found` };
    try {
      await instance.page.mouse.click(x, y, { button: opts.button, clickCount: opts.clickCount, delay: opts.delay });
      return { success: true, data: { x, y, button: opts.button, clickCount: opts.clickCount }, instanceId };
    } catch (error) {
      return { success: false, error: `Click at failed: ${error instanceof Error ? error.message : error}`, instanceId };
    }
  }

  private async annotate(
    instanceId: string,
    opts: { bboxThreshold: number; iouThreshold: number; selector?: string }
  ): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) return { success: false, error: `Instance ${instanceId} not found` };

    const url = this.omniparserUrl ?? process.env['OMNIPARSER_URL'];
    if (!url) {
      return {
        success: false,
        error: 'OmniParser URL not configured. Set OMNIPARSER_URL env var or --omniparser-url flag.',
        instanceId,
      };
    }

    // Take a high-quality PNG screenshot for better OCR accuracy
    let screenshotB64: string;
    try {
      const screenshotOpts = opts.selector
        ? { type: 'png' as const }
        : { type: 'png' as const };
      const buf = opts.selector
        ? await instance.page.locator(opts.selector).screenshot(screenshotOpts)
        : await instance.page.screenshot(screenshotOpts);
      screenshotB64 = buf.toString('base64');
    } catch (error) {
      return { success: false, error: `Screenshot failed: ${error instanceof Error ? error.message : error}`, instanceId };
    }

    // Resolve viewport size for converting normalised bbox → pixel coords
    const viewport = instance.page.viewportSize() ?? { width: 1280, height: 720 };

    // Call OmniParser
    let annotatedImage: string;
    let elements: OmniParserElement[];
    try {
      const endpoint = url.replace(/\/$/, '') + '/parse';
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base64_image: screenshotB64,
          bbox_threshold: opts.bboxThreshold,
          iou_threshold: opts.iouThreshold,
        }),
      });

      if (!resp.ok) {
        const body = await resp.text();
        return { success: false, error: `OmniParser returned ${resp.status}: ${body}`, instanceId };
      }

      const json = await resp.json() as {
        annotated_image: string;
        parsed_elements: Array<{
          id: number;
          type: string;
          content: string;
          bbox: [number, number, number, number];
        }>;
      };

      // Strip data-URI prefix if present
      annotatedImage = json.annotated_image.replace(/^data:image\/\w+;base64,/, '');

      elements = json.parsed_elements.map((el) => {
        const [x1, y1, x2, y2] = el.bbox;
        return {
          id: el.id,
          type: el.type === 'icon' ? 'icon' : 'text',
          content: el.content,
          bbox: [x1, y1, x2, y2] as [number, number, number, number],
          center: {
            x: Math.round(((x1 + x2) / 2) * viewport.width),
            y: Math.round(((y1 + y2) / 2) * viewport.height),
          },
        };
      });
    } catch (error) {
      return { success: false, error: `OmniParser request failed: ${error instanceof Error ? error.message : error}`, instanceId };
    }

    // Cache in instance for reference
    instance.lastAnnotation = elements;

    return {
      success: true,
      data: {
        annotatedImage,
        elements,
        viewport,
        count: elements.length,
      },
      instanceId,
    };
  }

  private async getMarkdown(instanceId: string, options: {
    includeLinks: boolean;
    maxLength: number;
    selector?: string;
  }): Promise<ToolResult> {
    const instance = this.browserManager.getInstance(instanceId);
    if (!instance) {
      return { success: false, error: `Instance ${instanceId} not found` };
    }

    try {
      // JavaScript function to extract page content and convert to Markdown
      const markdownContent = await instance.page.evaluate((opts: { includeLinks: boolean; maxLength: number; selector?: string }) => {
        const { includeLinks, maxLength, selector } = opts;
        
        // Select the root element to process
        const rootElement = selector ? document.querySelector(selector) : document.body;
        if (!rootElement) {
          return 'Specified element or page content not found';
        }

        // HTML to Markdown conversion function
        function htmlToMarkdown(element: any, depth = 0) {
          let markdown = '';
          const indent = '  '.repeat(depth);
          
          for (const node of element.childNodes) {
            if (node.nodeType === Node.TEXT_NODE) {
              const text = node.textContent?.trim();
              if (text) {
                markdown += text + ' ';
              }
            } else if (node.nodeType === Node.ELEMENT_NODE) {
              const el = node as Element;
              const tagName = el.tagName.toLowerCase();
              
              switch (tagName) {
                case 'h1':
                  markdown += `\n\n# ${el.textContent?.trim()}\n\n`;
                  break;
                case 'h2':
                  markdown += `\n\n## ${el.textContent?.trim()}\n\n`;
                  break;
                case 'h3':
                  markdown += `\n\n### ${el.textContent?.trim()}\n\n`;
                  break;
                case 'h4':
                  markdown += `\n\n#### ${el.textContent?.trim()}\n\n`;
                  break;
                case 'h5':
                  markdown += `\n\n##### ${el.textContent?.trim()}\n\n`;
                  break;
                case 'h6':
                  markdown += `\n\n###### ${el.textContent?.trim()}\n\n`;
                  break;
                case 'p':
                  const pText = htmlToMarkdown(el, depth);
                  if (pText.trim()) {
                    markdown += `\n\n${pText.trim()}\n`;
                  }
                  break;
                case 'br':
                  markdown += '\n';
                  break;
                case 'strong':
                case 'b':
                  markdown += `**${el.textContent?.trim()}**`;
                  break;
                case 'em':
                case 'i':
                  markdown += `*${el.textContent?.trim()}*`;
                  break;
                case 'code':
                  markdown += `\`${el.textContent?.trim()}\``;
                  break;
                case 'pre':
                  markdown += `\n\`\`\`\n${el.textContent?.trim()}\n\`\`\`\n`;
                  break;
                case 'a':
                  const href = el.getAttribute('href');
                  const linkText = el.textContent?.trim();
                  if (includeLinks && href && linkText) {
                    if (href.startsWith('http')) {
                      markdown += `[${linkText}](${href})`;
                    } else {
                      markdown += linkText;
                    }
                  } else {
                    markdown += linkText || '';
                  }
                  break;
                case 'ul':
                case 'ol':
                  markdown += '\n';
                  const listItems = el.querySelectorAll('li');
                  listItems.forEach((li, index) => {
                    const bullet = tagName === 'ul' ? '-' : `${index + 1}.`;
                    markdown += `${indent}${bullet} ${li.textContent?.trim()}\n`;
                  });
                  markdown += '\n';
                  break;
                case 'blockquote':
                  const quoteText = el.textContent?.trim();
                  if (quoteText) {
                    markdown += `\n> ${quoteText}\n\n`;
                  }
                  break;
                case 'div':
                case 'section':
                case 'article':
                case 'main':
                  // Recursively process container elements
                  markdown += htmlToMarkdown(el, depth);
                  break;
                case 'table':
                  // Simplified table processing
                  const rows = el.querySelectorAll('tr');
                  if (rows.length > 0) {
                    markdown += '\n\n';
                    rows.forEach((row, rowIndex) => {
                      const cells = row.querySelectorAll('td, th');
                      const cellTexts = Array.from(cells).map(cell => cell.textContent?.trim() || '');
                      markdown += '| ' + cellTexts.join(' | ') + ' |\n';
                      if (rowIndex === 0) {
                        markdown += '|' + ' --- |'.repeat(cells.length) + '\n';
                      }
                    });
                    markdown += '\n';
                  }
                  break;
                case 'script':
                case 'style':
                case 'nav':
                case 'footer':
                case 'aside':
                  // Ignore these elements
                  break;
                default:
                  // For other elements, continue recursive processing of child elements
                  markdown += htmlToMarkdown(el, depth);
                  break;
              }
            }
          }
          
          return markdown;
        }

        // Extract page title
        const title = document.title;
        const url = window.location.href;
        
        // Generate Markdown content
        let content = `# ${title}\n\n**URL:** ${url}\n\n`;
        content += htmlToMarkdown(rootElement);
        
        // Clean up extra line breaks and spaces
        content = content
          .replace(/\n{3,}/g, '\n\n')
          .replace(/[ \t]+/g, ' ')
          .trim();
        
        // Truncate content if exceeds maximum length
        if (content.length > maxLength) {
          content = content.substring(0, maxLength) + '\n\n[Content truncated...]';
        }
        
        return content;
      }, options);

      return {
        success: true,
        data: { 
          markdown: markdownContent,
          length: markdownContent.length,
          truncated: markdownContent.length >= options.maxLength,
          url: instance.page.url(),
          title: await instance.page.title()
        },
        instanceId
      };
    } catch (error) {
      return {
        success: false,
        error: `Get markdown failed: ${error instanceof Error ? error.message : error}`,
        instanceId
      };
    }
  }
} 