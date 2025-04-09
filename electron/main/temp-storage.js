const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');
const config = require('./config');

class TempStorage {
    constructor() {
        // Use temp directory path from config
        this.tempDir = config.storage.tempDir;
        this.isInitialized = false;
    }

    async initialize() {
        try {
            console.log('\n=== Initializing Temporary Storage ===');
            console.log('Temp directory path:', this.tempDir);
            
            await fs.mkdir(this.tempDir, { recursive: true });
            
            // Cleanup any existing files
            const files = await fs.readdir(this.tempDir);
            console.log('Found existing temp files:', files.length);
            
            for (const file of files) {
                try {
                    await fs.unlink(path.join(this.tempDir, file));
                    console.log('Cleaned up old temp file:', file);
                } catch (error) {
                    console.error('Error cleaning up file:', file, error);
                }
            }

            this.isInitialized = true;
            console.log('Temporary storage initialized successfully');
            return true;
        } catch (error) {
            console.error('Error initializing temp storage:', error);
            throw error;
        }
    }

    async ensureInitialized() {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }

    async saveTempData(sessionId, data) {
        try {
            await this.ensureInitialized();
            
            console.log('\n=== Saving Temporary Data ===');
            console.log('Session ID:', sessionId);
            console.log('Data type:', data.type);
            
            const fileName = `${sessionId}_${data.type}.json`;
            const filePath = path.join(this.tempDir, fileName);
            
            const tempData = {
                sessionId,
                timestamp: new Date().toISOString(),
                data
            };

            console.log('Writing to file:', filePath);
            await fs.writeFile(filePath, JSON.stringify(tempData, null, 2));
            console.log('Temporary data saved successfully');
            
            // Verify the file was written
            const stats = await fs.stat(filePath);
            console.log('File size:', stats.size, 'bytes');
            
            return filePath;
        } catch (error) {
            console.error('Error saving temporary data:', error);
            throw error;
        }
    }

    async loadTempData(sessionId) {
        try {
            await this.ensureInitialized();
            
            console.log('\n=== Loading Temporary Data ===');
            console.log('Session ID:', sessionId);
            
            // Find all files for this session
            const files = await fs.readdir(this.tempDir);
            const sessionFiles = files.filter(f => f.startsWith(sessionId));
            
            if (sessionFiles.length === 0) {
                console.log('No temporary data found for session');
                return null;
            }

            const filePath = path.join(this.tempDir, sessionFiles[0]);
            console.log('Loading from file:', filePath);
            
            const data = await fs.readFile(filePath, 'utf8');
            console.log('Temporary data loaded successfully');
            
            return JSON.parse(data);
        } catch (error) {
            console.error('Error loading temporary data:', error);
            throw error;
        }
    }

    async deleteTempData(sessionId) {
        try {
            await this.ensureInitialized();
            
            console.log('\n=== Deleting Temporary Data ===');
            console.log('Session ID:', sessionId);
            
            // Find all files for this session
            const files = await fs.readdir(this.tempDir);
            const sessionFiles = files.filter(f => f.startsWith(sessionId));
            
            if (sessionFiles.length === 0) {
                console.log('No temporary data found to delete');
                return;
            }

            for (const file of sessionFiles) {
                const filePath = path.join(this.tempDir, file);
                await fs.unlink(filePath);
                console.log('Deleted temp file:', file);
            }
            
            console.log('Temporary data deleted successfully');
        } catch (error) {
            console.error('Error deleting temporary data:', error);
            throw error;
        }
    }

    async cleanup() {
        try {
            await this.ensureInitialized();
            
            console.log('\n=== Cleaning Up Temporary Storage ===');
            const files = await fs.readdir(this.tempDir);
            
            for (const file of files) {
                const filePath = path.join(this.tempDir, file);
                await fs.unlink(filePath);
                console.log('Deleted file:', file);
            }
            
            console.log('Temporary storage cleaned up successfully');
        } catch (error) {
            console.error('Error cleaning up temporary storage:', error);
            throw error;
        }
    }
}

module.exports = TempStorage; 