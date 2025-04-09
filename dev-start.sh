#!/bin/bash

# Make scripts executable
chmod +x python/setup.sh

# Setup Python environment
cd python
./setup.sh
cd ..

# Install Node.js dependencies
npm install

# Start the app in development mode
npm run dev 