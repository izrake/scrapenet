#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Function to print colored messages
print_message() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Check if running on macOS
if [[ "$OSTYPE" != "darwin"* ]]; then
    print_warning "This script is designed for macOS only!"
    exit 1
fi

# Check architecture
ARCH=$(uname -m)
print_message "Detected architecture: $ARCH"

# Create build directories
mkdir -p dist/{mac-intel,mac-arm,universal}

# Install dependencies
print_message "Installing dependencies..."
npm install

# Build based on architecture
if [[ "$ARCH" == "arm64" ]]; then
    print_message "Building for Apple Silicon (M1/M2)..."
    npm run build:mac-arm
    cp -r dist/*.dmg dist/mac-arm/
    cp -r dist/*.zip dist/mac-arm/
elif [[ "$ARCH" == "x86_64" ]]; then
    print_message "Building for Intel Mac..."
    npm run build:mac-intel
    cp -r dist/*.dmg dist/mac-intel/
    cp -r dist/*.zip dist/mac-intel/
fi

# Build universal binary
print_message "Building universal binary..."
npm run build:universal
cp -r dist/*.dmg dist/universal/
cp -r dist/*.zip dist/universal/

print_message "Build process completed!"
print_message "Check the dist directory for build artifacts:"
ls -la dist/ 