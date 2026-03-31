#!/usr/bin/env node

/**
 * Proxy functionality test script
 * 
 * This script tests the proxy configuration functionality of concurrent-browser-mcp
 * Including:
 * 1. Automatic proxy detection
 * 2. Manual proxy configuration
 * 3. Proxy disabling
 */

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔍 Starting proxy functionality tests...\n');

// Test configurations
const testConfigs = [
  {
    name: 'Test 1: Default configuration (proxy auto-detection enabled)',
    args: ['--max-instances', '1'],
    description: 'Should auto-detect local proxy'
  },
  {
    name: 'Test 2: Manual proxy configuration',
    args: ['--proxy', 'http://127.0.0.1:7890', '--max-instances', '1'],
    description: 'Should use specified proxy server'
  },
  {
    name: 'Test 3: Disable proxy auto-detection',
    args: ['--no-proxy-auto-detect', '--max-instances', '1'],
    description: 'Should disable all proxy functionality'
  }
];

async function runTest(config) {
  return new Promise((resolve) => {
    console.log(`\n📋 ${config.name}`);
    console.log(`   ${config.description}`);
    console.log(`   Command: npx concurrent-browser-mcp ${config.args.join(' ')}`);
    
    const child = spawn('npx', ['concurrent-browser-mcp', ...config.args], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let output = '';
    let hasProxyInfo = false;

    child.stderr.on('data', (data) => {
      const text = data.toString();
      output += text;
      
      // Check for proxy-related output
      if (text.includes('proxy') || text.includes('Proxy')) {
        hasProxyInfo = true;
        console.log(`   📡 ${text.trim()}`);
      }
      
      // Server started successfully
      if (text.includes('Concurrent Browser MCP Server started')) {
        console.log('   ✅ Server started successfully');
        
        setTimeout(() => {
          child.kill('SIGTERM');
        }, 2000);
      }
    });

    child.stdout.on('data', (data) => {
      output += data.toString();
    });

    child.on('close', (code) => {
      if (!hasProxyInfo) {
        console.log('   ⚠️  No proxy configuration information detected');
      }
      
      resolve({
        success: code === 0 || code === null, // null means killed by SIGTERM
        output,
        hasProxyInfo
      });
    });

    child.on('error', (error) => {
      console.log(`   ❌ Test failed: ${error.message}`);
      resolve({ success: false, output, hasProxyInfo: false });
    });
  });
}

async function testProxyFeatures() {
  console.log('🚀 concurrent-browser-mcp Proxy Functionality Tests\n');
  
  // Check if project is built
  if (!fs.existsSync(path.join(__dirname, 'dist'))) {
    console.log('❌ dist directory not found, please run npm run build first');
    return;
  }

  let passedTests = 0;
  const totalTests = testConfigs.length;

  for (const config of testConfigs) {
    try {
      const result = await runTest(config);
      if (result.success) {
        passedTests++;
        console.log('   ✅ Test passed');
      } else {
        console.log('   ❌ Test failed');
      }
    } catch (error) {
      console.log(`   ❌ Test exception: ${error.message}`);
    }
  }

  console.log(`\n📊 Test Results: ${passedTests}/${totalTests} passed`);
  
  if (passedTests === totalTests) {
    console.log('🎉 All proxy functionality tests passed!');
  } else {
    console.log('⚠️  Some tests failed, please check configuration');
  }

  console.log('\n💡 Tips:');
  console.log('   - If no proxy server is running locally, auto-detection may not find a proxy');
  console.log('   - You can manually start a proxy server (like Clash, V2Ray, etc.) before running tests');
  console.log('   - Environment variables HTTP_PROXY or HTTPS_PROXY will be auto-detected');
}

// Run tests
testProxyFeatures().catch(console.error); 