const { PythonShell } = require('python-shell');
const path = require('path');
const { app } = require('electron');
const fetch = require('node-fetch');

class PythonService {
    constructor() {
        this.pyshell = null;
        this.isReady = false;
    }

    async start() {
        return new Promise((resolve, reject) => {
            try {
                // Get path to bundled Python
                const pythonPath = process.env.NODE_ENV === 'development'
                    ? 'python'  // Use system Python in development
                    : path.join(process.resourcesPath, 'python', 'python');  // Use bundled Python in production

                // Get path to Python script
                const scriptPath = process.env.NODE_ENV === 'development'
                    ? path.join(__dirname, '../../python/main.py')
                    : path.join(process.resourcesPath, 'python', 'main.py');

                // Configure Python process
                const options = {
                    mode: 'text',
                    pythonPath: pythonPath,
                    pythonOptions: ['-u'],  // Unbuffered output
                };

                // Start Python process
                this.pyshell = new PythonShell(scriptPath, options);

                // Handle Python process output
                this.pyshell.on('message', (message) => {
                    console.log('Python:', message);
                });

                // Handle Python process errors
                this.pyshell.on('error', (error) => {
                    console.error('Python error:', error);
                    this.isReady = false;
                });

                // Handle Python process exit
                this.pyshell.on('close', () => {
                    console.log('Python process closed');
                    this.isReady = false;
                    this.pyshell = null;
                });

                // Wait for API server to be ready
                this.waitForServer()
                    .then(() => {
                        this.isReady = true;
                        resolve();
                    })
                    .catch(reject);

            } catch (error) {
                console.error('Failed to start Python service:', error);
                reject(error);
            }
        });
    }

    async stop() {
        if (this.pyshell) {
            return new Promise((resolve) => {
                this.pyshell.end((err) => {
                    if (err) console.error('Error stopping Python service:', err);
                    this.isReady = false;
                    this.pyshell = null;
                    resolve();
                });
            });
        }
    }

    async waitForServer(retries = 30, interval = 1000) {
        for (let i = 0; i < retries; i++) {
            try {
                const response = await fetch('http://localhost:8000/docs');
                if (response.ok) {
                    console.log('API server is ready');
                    return;
                }
            } catch (error) {
                console.log('Waiting for API server...');
                await new Promise(resolve => setTimeout(resolve, interval));
            }
        }
        throw new Error('API server failed to start');
    }

    isRunning() {
        return this.pyshell !== null && this.isReady;
    }
}

module.exports = { PythonService }; 