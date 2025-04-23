const fs = require('fs').promises;
const path = require('path');
const { app } = require('electron');
const os = require('os');

class Logger {
    constructor(options = {}) {
        this.options = {
            logDir: options.logDir || path.join(app.getPath('userData'), 'logs'),
            logLevel: options.logLevel || 'info', // 'debug', 'info', 'warn', 'error'
            filePrefix: options.filePrefix || 'audit',
            maxLogFiles: options.maxLogFiles || 10,
            maxLogSize: options.maxLogSize || 10 * 1024 * 1024, // 10 MB
            ...options
        };
        
        this.logLevels = {
            debug: 0,
            info: 1,
            warn: 2,
            error: 3
        };
        
        this.currentLogLevel = this.logLevels[this.options.logLevel] || 1;
        this.currentLogFile = null;
        this.logStream = null;
        this.isInitialized = false;
    }
    
    async initialize() {
        try {
            // Ensure log directory exists
            await fs.mkdir(this.options.logDir, { recursive: true });
            
            // Set current log file
            const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            this.currentLogFile = path.join(this.options.logDir, `${this.options.filePrefix}-${date}.log`);
            
            // Check for log rotation
            await this.rotateLogsIfNeeded();
            
            this.isInitialized = true;
            
            this.info('Logger initialized', {
                logDir: this.options.logDir,
                logLevel: this.options.logLevel,
                logFile: this.currentLogFile
            });
            
            return true;
        } catch (error) {
            console.error('Failed to initialize logger:', error);
            return false;
        }
    }
    
    async rotateLogsIfNeeded() {
        try {
            // Check if current log file exists and exceeds size limit
            try {
                const stats = await fs.stat(this.currentLogFile);
                if (stats.size < this.options.maxLogSize) {
                    return;
                }
            } catch (err) {
                // File doesn't exist yet, no need to rotate
                return;
            }
            
            // Get list of log files
            const files = await fs.readdir(this.options.logDir);
            const logFiles = files
                .filter(f => f.startsWith(this.options.filePrefix))
                .map(f => path.join(this.options.logDir, f));
            
            // Sort by modification time (oldest first)
            const fileStats = await Promise.all(
                logFiles.map(async f => ({ 
                    file: f, 
                    mtime: (await fs.stat(f)).mtime.getTime() 
                }))
            );
            
            fileStats.sort((a, b) => a.mtime - b.mtime);
            
            // Delete oldest files if we exceed the limit
            if (fileStats.length >= this.options.maxLogFiles) {
                const filesToDelete = fileStats.slice(0, fileStats.length - this.options.maxLogFiles + 1);
                for (const file of filesToDelete) {
                    await fs.unlink(file.file);
                    console.log(`Rotated log file: ${file.file}`);
                }
            }
            
            // Create a new log file with timestamp
            const timestamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
            this.currentLogFile = path.join(
                this.options.logDir,
                `${this.options.filePrefix}-${timestamp}.log`
            );
        } catch (error) {
            console.error('Error rotating logs:', error);
        }
    }
    
    async ensureInitialized() {
        if (!this.isInitialized) {
            await this.initialize();
        }
    }
    
    async log(level, message, data = {}) {
        await this.ensureInitialized();
        
        if (this.logLevels[level] < this.currentLogLevel) {
            return;
        }
        
        try {
            const timestamp = new Date().toISOString();
            const hostname = os.hostname();
            
            const logEntry = {
                timestamp,
                level,
                message,
                hostname,
                data
            };
            
            const logText = JSON.stringify(logEntry) + '\n';
            
            // Write to log file
            await fs.appendFile(this.currentLogFile, logText);
            
            // Also log to console for development
            if (process.env.NODE_ENV === 'development') {
                console.log(`[${level.toUpperCase()}] ${message}`, data);
            }
        } catch (error) {
            console.error('Error writing to log file:', error);
        }
    }
    
    debug(message, data) {
        return this.log('debug', message, data);
    }
    
    info(message, data) {
        return this.log('info', message, data);
    }
    
    warn(message, data) {
        return this.log('warn', message, data);
    }
    
    error(message, data) {
        return this.log('error', message, data);
    }
    
    // Specific method for API audit logging
    async logApiRequest(req, res, responseTime, responseData) {
        await this.ensureInitialized();
        
        try {
            const requestInfo = {
                method: req.method,
                url: req.originalUrl || req.url,
                path: req.path,
                params: req.params,
                query: req.query,
                body: this.sanitizeRequestBody(req.body),
                headers: this.sanitizeHeaders(req.headers),
                ip: req.ip || req.connection.remoteAddress,
                timestamp: new Date().toISOString(),
                responseTime: responseTime,
                responseStatus: res.statusCode,
                responseData: this.sanitizeResponseData(responseData)
            };
            
            await this.info('API Request', requestInfo);
        } catch (error) {
            console.error('Error logging API request:', error);
        }
    }
    
    // Sanitize sensitive data like keys and tokens
    sanitizeRequestBody(body) {
        if (!body) return null;
        
        const sanitized = { ...body };
        
        // Remove sensitive fields if present
        if (sanitized.publicKey) sanitized.publicKey = '[REDACTED]';
        if (sanitized.token) sanitized.token = '[REDACTED]';
        if (sanitized.key) sanitized.key = '[REDACTED]';
        if (sanitized.password) sanitized.password = '[REDACTED]';
        
        return sanitized;
    }
    
    sanitizeHeaders(headers) {
        if (!headers) return null;
        
        const sanitized = { ...headers };
        
        // Remove sensitive headers
        if (sanitized.authorization) sanitized.authorization = '[REDACTED]';
        if (sanitized.cookie) sanitized.cookie = '[REDACTED]';
        
        return sanitized;
    }
    
    sanitizeResponseData(data) {
        if (!data) return null;
        
        // If data is too large, truncate it
        const dataStr = JSON.stringify(data);
        if (dataStr.length > 1024) {
            return {
                summary: '[Response data truncated]',
                size: dataStr.length,
                type: typeof data === 'object' ? (Array.isArray(data) ? 'array' : 'object') : typeof data
            };
        }
        
        return data;
    }
    
    // Method to get API logs
    async getApiLogs(options = {}) {
        await this.ensureInitialized();
        
        try {
            // Default options
            const { 
                limit = 100, 
                startDate = null, 
                endDate = null,
                filterByPath = null 
            } = options;
            
            // Get all log files
            const files = await fs.readdir(this.options.logDir);
            
            // Filter log files that match our prefix (api-audit)
            const logFiles = files
                .filter(f => f.startsWith(this.options.filePrefix))
                .map(f => path.join(this.options.logDir, f));
            
            // Sort files by modification time (newest first)
            const fileStats = await Promise.all(
                logFiles.map(async f => ({ 
                    file: f, 
                    mtime: (await fs.stat(f)).mtime.getTime() 
                }))
            );
            
            fileStats.sort((a, b) => b.mtime - a.mtime);
            
            // Read logs from files, starting with newest
            const logs = [];
            
            for (const fileStat of fileStats) {
                if (logs.length >= limit) break;
                
                const fileContent = await fs.readFile(fileStat.file, 'utf-8');
                const lines = fileContent.split('\n').filter(line => line.trim());
                
                for (const line of lines) {
                    try {
                        const logEntry = JSON.parse(line);
                        
                        // Only include API request logs
                        if (logEntry.message !== 'API Request') continue;
                        
                        // Apply date filters if provided
                        if (startDate && new Date(logEntry.timestamp) < new Date(startDate)) continue;
                        if (endDate && new Date(logEntry.timestamp) > new Date(endDate)) continue;
                        
                        // Apply path filter if provided
                        if (filterByPath && !logEntry.data.path.includes(filterByPath)) continue;
                        
                        logs.push(logEntry);
                        
                        // Break if we've reached the limit
                        if (logs.length >= limit) break;
                    } catch (err) {
                        // Skip invalid JSON entries
                        continue;
                    }
                }
            }
            
            // Sort logs by timestamp (newest first)
            logs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
            
            return logs;
        } catch (error) {
            console.error('Error retrieving API logs:', error);
            throw new Error('Failed to retrieve API logs: ' + error.message);
        }
    }
}

module.exports = Logger; 