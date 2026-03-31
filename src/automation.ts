import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { ToolResult } from './types.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RecipeParam {
  name: string;
  description?: string;
  default?: any;
  required?: boolean;
}

export interface RecipeStep {
  /** Name of an existing browser_* tool to call */
  tool: string;
  /** Arguments to pass. Use {{paramName}} or {{$varName}} for interpolation */
  args: Record<string, any>;
  /** Store the step result (or a sub-field) into a variable for later steps */
  extractAs?: string;
  /** JS expression evaluated against variables — skip step if falsy */
  condition?: string;
  /** What to do on error */
  onError?: 'stop' | 'skip' | 'retry';
  /** How many retries (default 1) when onError=retry */
  retryCount?: number;
  /** Delay in ms before executing this step */
  delay?: number;
  /** Optional human-readable label for logging */
  label?: string;
}

export interface Recipe {
  id: string;
  name: string;
  description: string;
  params: RecipeParam[];
  steps: RecipeStep[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Bookmarklet {
  id: string;
  name: string;
  description: string;
  /** JavaScript to evaluate in page context */
  script: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStep {
  type: 'recipe' | 'bookmarklet' | 'tool' | 'loop' | 'condition';
  /** Reference a recipe or bookmarklet by name (for type=recipe/bookmarklet) */
  ref?: string;
  /** Direct tool name (for type=tool) */
  tool?: string;
  /** Arguments / params to pass */
  args?: Record<string, any>;
  /** Loop over a variable's array (for type=loop) */
  forEach?: {
    /** Variable name containing the array */
    variable: string;
    /** Iterator variable name */
    as: string;
    /** Optional index variable name */
    indexAs?: string;
    /** Steps to run for each iteration */
    steps: WorkflowStep[];
  };
  /** Conditional execution (for type=condition) */
  if?: {
    /** JS expression evaluated against variables */
    condition: string;
    then: WorkflowStep[];
    else?: WorkflowStep[];
  };
  /** Store result into a variable */
  extractAs?: string;
  /** Delay before this step */
  delay?: number;
  /** Label for logging */
  label?: string;
  onError?: 'stop' | 'skip' | 'retry';
  retryCount?: number;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  params: RecipeParam[];
  steps: WorkflowStep[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface StepLog {
  step: number;
  label?: string;
  tool?: string;
  success: boolean;
  duration: number;
  error?: string;
  extracted?: any;
}

export interface RunResult {
  success: boolean;
  variables: Record<string, any>;
  logs: StepLog[];
  totalDuration: number;
  stepsExecuted: number;
  error?: string;
}

// ─── Storage ────────────────────────────────────────────────────────────────

interface StorageData {
  recipes: Record<string, Recipe>;
  bookmarklets: Record<string, Bookmarklet>;
  workflows: Record<string, Workflow>;
}

export class AutomationStore {
  private data: StorageData;
  private filePath: string;

  constructor(dataDir?: string) {
    const dir = dataDir || join(process.cwd(), 'data');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    this.filePath = join(dir, 'automation.json');
    this.data = this.load();
  }

  private load(): StorageData {
    if (existsSync(this.filePath)) {
      try {
        return JSON.parse(readFileSync(this.filePath, 'utf-8'));
      } catch {
        console.error('[automation] Failed to parse storage file, starting fresh');
      }
    }
    return { recipes: {}, bookmarklets: {}, workflows: {} };
  }

  private save(): void {
    writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  // ── Recipes ──

  saveRecipe(recipe: Omit<Recipe, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Recipe {
    // Check if updating by name
    const existing = recipe.id
      ? this.data.recipes[recipe.id]
      : Object.values(this.data.recipes).find(r => r.name === recipe.name);

    const now = new Date().toISOString();
    const saved: Recipe = {
      ...recipe,
      id: existing?.id || recipe.id || uuidv4(),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      tags: recipe.tags || [],
      params: recipe.params || [],
    };
    this.data.recipes[saved.id] = saved;
    this.save();
    return saved;
  }

  getRecipe(nameOrId: string): Recipe | undefined {
    return this.data.recipes[nameOrId]
      || Object.values(this.data.recipes).find(r => r.name === nameOrId);
  }

  listRecipes(tag?: string): Recipe[] {
    let recipes = Object.values(this.data.recipes);
    if (tag) {
      recipes = recipes.filter(r => r.tags.includes(tag));
    }
    return recipes.sort((a, b) => a.name.localeCompare(b.name));
  }

  deleteRecipe(nameOrId: string): boolean {
    const recipe = this.getRecipe(nameOrId);
    if (!recipe) return false;
    delete this.data.recipes[recipe.id];
    this.save();
    return true;
  }

  // ── Bookmarklets ──

  saveBookmarklet(bm: Omit<Bookmarklet, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Bookmarklet {
    const existing = bm.id
      ? this.data.bookmarklets[bm.id]
      : Object.values(this.data.bookmarklets).find(b => b.name === bm.name);

    const now = new Date().toISOString();
    const saved: Bookmarklet = {
      ...bm,
      id: existing?.id || bm.id || uuidv4(),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      tags: bm.tags || [],
    };
    this.data.bookmarklets[saved.id] = saved;
    this.save();
    return saved;
  }

  getBookmarklet(nameOrId: string): Bookmarklet | undefined {
    return this.data.bookmarklets[nameOrId]
      || Object.values(this.data.bookmarklets).find(b => b.name === nameOrId);
  }

  listBookmarklets(tag?: string): Bookmarklet[] {
    let bms = Object.values(this.data.bookmarklets);
    if (tag) {
      bms = bms.filter(b => b.tags.includes(tag));
    }
    return bms.sort((a, b) => a.name.localeCompare(b.name));
  }

  deleteBookmarklet(nameOrId: string): boolean {
    const bm = this.getBookmarklet(nameOrId);
    if (!bm) return false;
    delete this.data.bookmarklets[bm.id];
    this.save();
    return true;
  }

  // ── Workflows ──

  saveWorkflow(wf: Omit<Workflow, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }): Workflow {
    const existing = wf.id
      ? this.data.workflows[wf.id]
      : Object.values(this.data.workflows).find(w => w.name === wf.name);

    const now = new Date().toISOString();
    const saved: Workflow = {
      ...wf,
      id: existing?.id || wf.id || uuidv4(),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      tags: wf.tags || [],
      params: wf.params || [],
    };
    this.data.workflows[saved.id] = saved;
    this.save();
    return saved;
  }

  getWorkflow(nameOrId: string): Workflow | undefined {
    return this.data.workflows[nameOrId]
      || Object.values(this.data.workflows).find(w => w.name === nameOrId);
  }

  listWorkflows(tag?: string): Workflow[] {
    let wfs = Object.values(this.data.workflows);
    if (tag) {
      wfs = wfs.filter(w => w.tags.includes(tag));
    }
    return wfs.sort((a, b) => a.name.localeCompare(b.name));
  }

  deleteWorkflow(nameOrId: string): boolean {
    const wf = this.getWorkflow(nameOrId);
    if (!wf) return false;
    delete this.data.workflows[wf.id];
    this.save();
    return true;
  }
}

// ─── Interpolation ──────────────────────────────────────────────────────────

/**
 * Interpolate {{paramName}} and {{$varName}} in a value.
 * Handles strings, arrays, and nested objects recursively.
 */
function interpolate(value: any, params: Record<string, any>, vars: Record<string, any>): any {
  if (typeof value === 'string') {
    // Check if the entire string is a single interpolation (preserve type)
    const singleMatch = value.match(/^\{\{(\$?[\w.]+)\}\}$/);
    if (singleMatch && singleMatch[1]) {
      const key = singleMatch[1]!;
      if (key.startsWith('$')) {
        return resolveNestedKey(vars, key.slice(1));
      }
      return resolveNestedKey(params, key) ?? resolveNestedKey(vars, key);
    }
    // Otherwise do string replacement
    return value.replace(/\{\{(\$?[\w.]+)\}\}/g, (_match: string, key: string) => {
      if (key.startsWith('$')) {
        const val = resolveNestedKey(vars, key.slice(1));
        return val !== undefined ? String(val) : `{{${key}}}`;
      }
      const val = resolveNestedKey(params, key) ?? resolveNestedKey(vars, key);
      return val !== undefined ? String(val) : `{{${key}}}`;
    });
  }
  if (Array.isArray(value)) {
    return value.map(v => interpolate(v, params, vars));
  }
  if (value && typeof value === 'object') {
    const result: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = interpolate(v, params, vars);
    }
    return result;
  }
  return value;
}

function resolveNestedKey(obj: Record<string, any>, key: string): any {
  const parts = key.split('.');
  let current: any = obj;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    current = current[part];
  }
  return current;
}

/**
 * Evaluate a condition expression against the variables context.
 * The expression has access to all variables as local names.
 */
function evalCondition(expr: string, vars: Record<string, any>): boolean {
  try {
    const keys = Object.keys(vars);
    const values = Object.values(vars);
    const fn = new Function(...keys, `return Boolean(${expr})`);
    return fn(...values);
  } catch {
    return false;
  }
}

// ─── Recipe Runner ──────────────────────────────────────────────────────────

type ToolExecutor = (name: string, args: Record<string, any>) => Promise<ToolResult>;

export class AutomationRunner {
  constructor(
    private store: AutomationStore,
    private executeTool: ToolExecutor
  ) {}

  /**
   * Run a recipe by name or ID, with parameter overrides.
   */
  async runRecipe(
    nameOrId: string,
    instanceId: string,
    params: Record<string, any> = {}
  ): Promise<RunResult> {
    const recipe = this.store.getRecipe(nameOrId);
    if (!recipe) {
      return {
        success: false,
        variables: {},
        logs: [],
        totalDuration: 0,
        stepsExecuted: 0,
        error: `Recipe not found: ${nameOrId}`,
      };
    }

    // Merge defaults with provided params
    const resolvedParams: Record<string, any> = {};
    for (const p of recipe.params) {
      if (params[p.name] !== undefined) {
        resolvedParams[p.name] = params[p.name];
      } else if (p.default !== undefined) {
        resolvedParams[p.name] = p.default;
      } else if (p.required) {
        return {
          success: false,
          variables: {},
          logs: [],
          totalDuration: 0,
          stepsExecuted: 0,
          error: `Missing required parameter: ${p.name}`,
        };
      }
    }

    const vars: Record<string, any> = { instanceId };
    const logs: StepLog[] = [];
    const startTime = Date.now();
    let stepsExecuted = 0;

    for (let i = 0; i < recipe.steps.length; i++) {
      const step = recipe.steps[i]!;
      const stepStart = Date.now();

      // Check condition
      if (step.condition && !evalCondition(step.condition, { ...resolvedParams, ...vars })) {
        logs.push({
          step: i,
          label: step.label,
          tool: step.tool,
          success: true,
          duration: 0,
          extracted: undefined,
        });
        continue;
      }

      // Delay
      if (step.delay) {
        await new Promise(r => setTimeout(r, step.delay));
      }

      // Interpolate args
      const interpolatedArgs = interpolate(step.args, resolvedParams, vars);
      // Always inject instanceId if not explicitly set
      if (!interpolatedArgs.instanceId) {
        interpolatedArgs.instanceId = instanceId;
      }

      let result: ToolResult | null = null;
      let lastError: string | undefined;
      const maxRetries = step.onError === 'retry' ? (step.retryCount || 1) : 0;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          result = await this.executeTool(step.tool, interpolatedArgs);
          if (result.success) break;
          lastError = result.error;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          result = { success: false, error: lastError };
        }
        if (attempt < maxRetries) {
          await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        }
      }

      stepsExecuted++;

      // Extract variable
      let extracted: any;
      if (result?.success && step.extractAs && result.data !== undefined) {
        extracted = result.data;
        vars[step.extractAs] = extracted;
      }

      const log: StepLog = {
        step: i,
        label: step.label,
        tool: step.tool,
        success: result?.success ?? false,
        duration: Date.now() - stepStart,
        error: result?.success ? undefined : lastError,
        extracted: step.extractAs ? extracted : undefined,
      };
      logs.push(log);

      // Handle error
      if (!result?.success) {
        if (step.onError === 'skip') continue;
        // 'stop' or default
        return {
          success: false,
          variables: vars,
          logs,
          totalDuration: Date.now() - startTime,
          stepsExecuted,
          error: `Step ${i} (${step.label || step.tool}) failed: ${lastError}`,
        };
      }
    }

    return {
      success: true,
      variables: vars,
      logs,
      totalDuration: Date.now() - startTime,
      stepsExecuted,
    };
  }

  /**
   * Run a bookmarklet on the current page of the given instance.
   */
  async runBookmarklet(
    nameOrId: string,
    instanceId: string,
    params: Record<string, any> = {}
  ): Promise<ToolResult> {
    const bm = this.store.getBookmarklet(nameOrId);
    if (!bm) {
      return { success: false, error: `Bookmarklet not found: ${nameOrId}` };
    }

    // Interpolate params in the script
    let script = bm.script;
    for (const [key, value] of Object.entries(params)) {
      script = script.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), JSON.stringify(value));
    }

    return await this.executeTool('browser_evaluate', { instanceId, script });
  }

  /**
   * Run a workflow with parameter overrides.
   */
  async runWorkflow(
    nameOrId: string,
    instanceId: string,
    params: Record<string, any> = {}
  ): Promise<RunResult> {
    const workflow = this.store.getWorkflow(nameOrId);
    if (!workflow) {
      return {
        success: false,
        variables: {},
        logs: [],
        totalDuration: 0,
        stepsExecuted: 0,
        error: `Workflow not found: ${nameOrId}`,
      };
    }

    // Merge defaults
    const resolvedParams: Record<string, any> = {};
    for (const p of workflow.params) {
      if (params[p.name] !== undefined) {
        resolvedParams[p.name] = params[p.name];
      } else if (p.default !== undefined) {
        resolvedParams[p.name] = p.default;
      } else if (p.required) {
        return {
          success: false,
          variables: {},
          logs: [],
          totalDuration: 0,
          stepsExecuted: 0,
          error: `Missing required parameter: ${p.name}`,
        };
      }
    }

    const vars: Record<string, any> = { ...resolvedParams, instanceId };
    const logs: StepLog[] = [];
    const startTime = Date.now();
    let stepsExecuted = 0;

    const executeSteps = async (steps: WorkflowStep[]): Promise<string | null> => {
      for (let i = 0; i < steps.length; i++) {
        const step = steps[i]!;
        const stepStart = Date.now();

        if (step.delay) {
          await new Promise(r => setTimeout(r, step.delay));
        }

        switch (step.type) {
          case 'tool': {
            if (!step.tool) {
              return `Workflow step ${i}: type=tool but no tool specified`;
            }
            const args = interpolate(step.args || {}, resolvedParams, vars);
            if (!args.instanceId) args.instanceId = instanceId;

            let result: ToolResult | null = null;
            let lastError: string | undefined;
            const maxRetries = step.onError === 'retry' ? (step.retryCount || 1) : 0;

            for (let attempt = 0; attempt <= maxRetries; attempt++) {
              result = await this.executeTool(step.tool, args);
              if (result.success) break;
              lastError = result.error;
              if (attempt < maxRetries) await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
            }

            stepsExecuted++;
            if (result?.success && step.extractAs && result.data !== undefined) {
              vars[step.extractAs] = result.data;
            }

            logs.push({
              step: logs.length,
              label: step.label || step.tool,
              tool: step.tool,
              success: result?.success ?? false,
              duration: Date.now() - stepStart,
              error: result?.success ? undefined : lastError,
              extracted: step.extractAs ? vars[step.extractAs] : undefined,
            });

            if (!result?.success) {
              if (step.onError === 'skip') continue;
              return `Step failed: ${step.label || step.tool}: ${lastError}`;
            }
            break;
          }

          case 'recipe': {
            if (!step.ref) return `Workflow step ${i}: type=recipe but no ref specified`;
            const args = interpolate(step.args || {}, resolvedParams, vars);
            const recipeResult = await this.runRecipe(step.ref, instanceId, args);
            stepsExecuted += recipeResult.stepsExecuted;
            logs.push(...recipeResult.logs.map(l => ({ ...l, step: logs.length + l.step })));

            if (recipeResult.success && step.extractAs) {
              vars[step.extractAs] = recipeResult.variables;
            }
            // Merge recipe variables into workflow variables
            Object.assign(vars, recipeResult.variables);

            if (!recipeResult.success) {
              if (step.onError === 'skip') continue;
              return `Recipe ${step.ref} failed: ${recipeResult.error}`;
            }
            break;
          }

          case 'bookmarklet': {
            if (!step.ref) return `Workflow step ${i}: type=bookmarklet but no ref specified`;
            const args = interpolate(step.args || {}, resolvedParams, vars);
            const bmResult = await this.runBookmarklet(step.ref, instanceId, args);
            stepsExecuted++;

            if (bmResult.success && step.extractAs && bmResult.data !== undefined) {
              vars[step.extractAs] = bmResult.data?.result;
            }

            logs.push({
              step: logs.length,
              label: step.label || `bookmarklet:${step.ref}`,
              tool: 'browser_evaluate',
              success: bmResult.success,
              duration: Date.now() - stepStart,
              error: bmResult.success ? undefined : bmResult.error,
              extracted: step.extractAs ? vars[step.extractAs] : undefined,
            });

            if (!bmResult.success) {
              if (step.onError === 'skip') continue;
              return `Bookmarklet ${step.ref} failed: ${bmResult.error}`;
            }
            break;
          }

          case 'loop': {
            if (!step.forEach) return `Workflow step ${i}: type=loop but no forEach specified`;
            const arr = resolveNestedKey(vars, step.forEach.variable);
            if (!Array.isArray(arr)) {
              return `Loop variable '${step.forEach.variable}' is not an array`;
            }

            for (let idx = 0; idx < arr.length; idx++) {
              vars[step.forEach.as] = arr[idx];
              if (step.forEach.indexAs) vars[step.forEach.indexAs] = idx;
              const err = await executeSteps(step.forEach.steps);
              if (err) {
                if (step.onError === 'skip') continue;
                return err;
              }
            }
            break;
          }

          case 'condition': {
            if (!step.if) return `Workflow step ${i}: type=condition but no if specified`;
            const condResult = evalCondition(step.if.condition, vars);
            const branch = condResult ? step.if.then : (step.if.else || []);
            const err = await executeSteps(branch);
            if (err) {
              if (step.onError === 'skip') continue;
              return err;
            }
            break;
          }
        }
      }
      return null;
    };

    const error = await executeSteps(workflow.steps);

    return {
      success: !error,
      variables: vars,
      logs,
      totalDuration: Date.now() - startTime,
      stepsExecuted,
      error: error || undefined,
    };
  }
}
