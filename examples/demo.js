#!/usr/bin/env node

/**
 * Demo script: Demonstrates multi-concurrent functionality of Concurrent Browser MCP Server
 * 
 * This script demonstrates how to:
 * 1. Create multiple browser instances
 * 2. Execute different tasks concurrently
 * 3. Manage instance lifecycle
 * 4. Handle concurrent operation results
 */

import { spawn } from 'child_process';
import { setTimeout } from 'timers/promises';

// Mock MCP tool calls
class MockMCPClient {
  constructor() {
    this.serverProcess = null;
    this.requestId = 0;
  }

  async startServer() {
    console.log('🚀 Starting Concurrent Browser MCP Server...');
    
    // In real application, this would start the MCP server
    // For demo purposes, we just simulate
    await setTimeout(1000);
    console.log('✅ Server started');
  }

  async callTool(name, args) {
    const requestId = ++this.requestId;
    console.log(`📞 Calling tool: ${name}`, args ? `(${JSON.stringify(args)})` : '');
    
    // Simulate tool call delay
    await setTimeout(Math.random() * 1000 + 500);
    
    // Simulate different tool responses
    switch (name) {
      case 'browser_create_instance':
        return {
          success: true,
          data: {
            instanceId: `instance-${requestId}`,
            browserType: args?.browserType || 'chromium',
            headless: args?.headless ?? true,
            metadata: args?.metadata
          }
        };
      
      case 'browser_list_instances':
        return {
          success: true,
          data: {
            instances: [
              { id: 'instance-1', isActive: true, metadata: { name: 'worker-1' } },
              { id: 'instance-2', isActive: true, metadata: { name: 'worker-2' } },
              { id: 'instance-3', isActive: true, metadata: { name: 'worker-3' } }
            ],
            totalCount: 3,
            maxInstances: 5
          }
        };
      
      case 'browser_navigate':
        return {
          success: true,
          data: {
            url: args.url,
            title: `Example Page - ${args.url}`,
            instanceId: args.instanceId
          }
        };
      
      case 'browser_screenshot':
        return {
          success: true,
          data: {
            screenshot: 'base64-encoded-screenshot-data',
            type: 'png',
            instanceId: args.instanceId
          }
        };
      
      case 'browser_close_instance':
        return {
          success: true,
          data: {
            instanceId: args.instanceId,
            closed: true
          }
        };
      
      default:
        return {
          success: true,
          data: { message: `Tool ${name} executed successfully`, instanceId: args?.instanceId }
        };
    }
  }

  async stopServer() {
    console.log('🛑 Stopping server...');
    await setTimeout(500);
    console.log('✅ Server stopped');
  }
}

  // Demo scenarios
class ConcurrentBrowserDemo {
  constructor() {
    this.client = new MockMCPClient();
    this.instances = [];
  }

  async run() {
    console.log('🎬 Starting Concurrent Browser MCP Server Demo\n');
    
    try {
      // Start server
      await this.client.startServer();
      console.log('');

      // Scenario 1: Create multiple browser instances
      await this.demo1_CreateMultipleInstances();
      console.log('');

      // Scenario 2: Execute different tasks concurrently
      await this.demo2_ConcurrentTasks();
      console.log('');

      // Scenario 3: Instance management
      await this.demo3_InstanceManagement();
      console.log('');

      // Scenario 4: Batch operations
      await this.demo4_BatchOperations();
      console.log('');

    } catch (error) {
      console.error('❌ Error during demo:', error);
    } finally {
      // Cleanup
      await this.cleanup();
    }
  }

  async demo1_CreateMultipleInstances() {
    console.log('📋 Scenario 1: Create multiple browser instances');
    console.log('─'.repeat(50));

    const configs = [
      { browserType: 'chromium', metadata: { name: 'worker-1', description: 'Chrome browser instance' } },
      { browserType: 'firefox', metadata: { name: 'worker-2', description: 'Firefox browser instance' } },
      { browserType: 'webkit', metadata: { name: 'worker-3', description: 'Safari browser instance' } }
    ];

    console.log('🔧 Creating 3 different types of browser instances concurrently...');
    
    const createPromises = configs.map(config => 
      this.client.callTool('browser_create_instance', config)
    );

    const results = await Promise.all(createPromises);
    
    results.forEach((result, index) => {
      if (result.success) {
        this.instances.push(result.data);
        console.log(`✅ Instance ${index + 1}: ${result.data.instanceId} (${result.data.browserType})`);
      } else {
        console.log(`❌ Instance ${index + 1}: Creation failed`);
      }
    });

    console.log(`📊 Created ${this.instances.length} instances in total`);
  }

  async demo2_ConcurrentTasks() {
    console.log('📋 Scenario 2: Execute different tasks concurrently');
    console.log('─'.repeat(50));

    const tasks = [
      { instanceId: this.instances[0]?.instanceId, url: 'https://example.com' },
      { instanceId: this.instances[1]?.instanceId, url: 'https://github.com' },
      { instanceId: this.instances[2]?.instanceId, url: 'https://stackoverflow.com' }
    ];

    console.log('🌐 Navigating to different websites concurrently...');
    
    const navPromises = tasks.map(task => 
      this.client.callTool('browser_navigate', task)
    );

    const navResults = await Promise.all(navPromises);
    
    navResults.forEach((result, index) => {
      if (result.success) {
        console.log(`✅ Navigation ${index + 1}: ${result.data.url} - ${result.data.title}`);
      } else {
        console.log(`❌ Navigation ${index + 1}: Failed`);
      }
    });

    console.log('📸 Taking screenshots concurrently...');
    
    const screenshotPromises = this.instances.map(instance => 
      this.client.callTool('browser_screenshot', { instanceId: instance.instanceId })
    );

    const screenshotResults = await Promise.all(screenshotPromises);
    
    screenshotResults.forEach((result, index) => {
      if (result.success) {
        console.log(`✅ Screenshot ${index + 1}: Saved (${result.data.type})`);
      } else {
        console.log(`❌ Screenshot ${index + 1}: Failed`);
      }
    });
  }

  async demo3_InstanceManagement() {
    console.log('📋 Scenario 3: Instance management');
    console.log('─'.repeat(50));

    // List all instances
    console.log('📋 Listing all instances...');
    const listResult = await this.client.callTool('browser_list_instances');
    
    if (listResult.success) {
      console.log(`📊 Instance statistics: ${listResult.data.totalCount}/${listResult.data.maxInstances}`);
      listResult.data.instances.forEach(instance => {
        console.log(`  - ${instance.id} (${instance.metadata?.name || 'Unnamed'})`);
      });
    }

    // Simulate instance timeout cleanup
    console.log('🧹 Simulating automatic cleanup of timed-out instances...');
    await setTimeout(1000);
    console.log('✅ Cleanup completed, all instances are running normally');
  }

  async demo4_BatchOperations() {
    console.log('📋 Scenario 4: Batch operations');
    console.log('─'.repeat(50));

    // Batch execute JavaScript
    console.log('🔧 Batch executing JavaScript...');
    const jsPromises = this.instances.map(instance => 
      this.client.callTool('browser_evaluate', {
        instanceId: instance.instanceId,
        script: 'document.title'
      })
    );

    const jsResults = await Promise.all(jsPromises);
    
    jsResults.forEach((result, index) => {
      if (result.success) {
        console.log(`✅ JS execution ${index + 1}: Success`);
      } else {
        console.log(`❌ JS execution ${index + 1}: Failed`);
      }
    });

    // Batch click operations
    console.log('🖱️ Batch click operations...');
    const clickPromises = this.instances.map(instance => 
      this.client.callTool('browser_click', {
        instanceId: instance.instanceId,
        selector: '#demo-button'
      })
    );

    const clickResults = await Promise.all(clickPromises);
    
    clickResults.forEach((result, index) => {
      if (result.success) {
        console.log(`✅ Click ${index + 1}: Success`);
      } else {
        console.log(`❌ Click ${index + 1}: Failed`);
      }
    });
  }

  async cleanup() {
    console.log('🧹 Cleaning up resources...');
    
    // Close all instances
    if (this.instances.length > 0) {
      const closePromises = this.instances.map(instance => 
        this.client.callTool('browser_close_instance', { instanceId: instance.instanceId })
      );

      await Promise.all(closePromises);
      console.log(`✅ Closed ${this.instances.length} instances`);
    }

    // Stop server
    await this.client.stopServer();
    console.log('✅ Cleanup completed');
  }
}

// Run demo
if (import.meta.url === `file://${process.argv[1]}`) {
  const demo = new ConcurrentBrowserDemo();
  demo.run().catch(console.error);
} 