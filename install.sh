#!/bin/bash

# Concurrent Browser MCP Server Installation Script

echo "🚀 Installing Concurrent Browser MCP Server..."
echo ""

# Check Node.js version
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18 or higher."
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2)
REQUIRED_VERSION="18.0.0"

if [ "$(printf '%s\n' "$REQUIRED_VERSION" "$NODE_VERSION" | sort -V | head -n1)" != "$REQUIRED_VERSION" ]; then
    echo "❌ Node.js version too low. Requires 18.0.0 or higher, current version: $NODE_VERSION"
    exit 1
fi

echo "✅ Node.js version check passed: $NODE_VERSION"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed."
    exit 1
fi

echo "✅ npm check passed"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

if [ $? -ne 0 ]; then
    echo "❌ Dependencies installation failed"
    exit 1
fi

echo "✅ Dependencies installed successfully"

# Build project
echo "🔨 Building project..."
npm run build

if [ $? -ne 0 ]; then
    echo "❌ Project build failed"
    exit 1
fi

echo "✅ Project built successfully"

# Install Playwright browsers
echo "🌐 Installing Playwright browsers..."
npx playwright install

if [ $? -ne 0 ]; then
    echo "❌ Playwright browsers installation failed"
    exit 1
fi

echo "✅ Playwright browsers installed successfully"

# Create global link (optional)
echo "🔗 Creating global link..."
npm link

if [ $? -eq 0 ]; then
    echo "✅ Global link created successfully"
    echo "📝 You can now use 'concurrent-browser-mcp' command"
else
    echo "⚠️ Global link creation failed, you can use 'node dist/index.js' to run"
fi

echo ""
echo "🎉 Installation completed!"
echo ""
echo "📋 Usage:"
echo "  1. Basic usage: node dist/index.js"
echo "  2. Show help: node dist/index.js --help"
echo "  3. Show examples: node dist/index.js example"
echo "  4. Run demo: node examples/demo.js"
echo ""
echo "🔧 MCP Client configuration example:"
echo "  {"
echo "    \"mcpServers\": {"
echo "      \"concurrent-browser\": {"
echo "        \"command\": \"node\","
echo "        \"args\": [\"$(pwd)/dist/index.js\"]"
echo "      }"
echo "    }"
echo "  }"
echo ""
echo "🚀 Start using Concurrent Browser MCP Server!" 