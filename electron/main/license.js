const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const axios = require('axios');
const os = require('os');
const crypto = require('crypto');
const fetch = require('node-fetch');

// Default API endpoint as fallback
const DEFAULT_API_ENDPOINT = 'https://scrapenet.ai';

class LicenseManager {
    constructor() {
        this.licenseFilePath = path.join(app.getPath('userData'), 'license.json');
        this.apiEndpoint = process.env.LICENSE_API_ENDPOINT || DEFAULT_API_ENDPOINT;
        
        // Ensure the directory exists
        const licenseDir = path.dirname(this.licenseFilePath);
        if (!fs.existsSync(licenseDir)) {
            fs.mkdirSync(licenseDir, { recursive: true });
        }
        
        this.licenseData = this.loadLicenseData();
        
        // Log the API endpoint being used (helpful for debugging)
        console.log('License API Endpoint:', this.apiEndpoint);
        console.log('License Data:', this.licenseData);
        
        this.initializeHandlers();
    }

    loadLicenseData() {
        try {
            if (fs.existsSync(this.licenseFilePath)) {
                const data = fs.readFileSync(this.licenseFilePath, 'utf8');
                const licenseData = JSON.parse(data);
                
                // Validate the loaded data
                if (!licenseData.key || !licenseData.machineId || !licenseData.expiryDate) {
                    console.error('Invalid license data format');
                    return null;
                }
                
                return licenseData;
            }
        } catch (error) {
            console.error('Error loading license data:', error);
        }
        return null;
    }

    saveLicenseData(data) {
        try {
            // Ensure the directory exists
            const licenseDir = path.dirname(this.licenseFilePath);
            if (!fs.existsSync(licenseDir)) {
                fs.mkdirSync(licenseDir, { recursive: true });
            }
            
            // Validate the data before saving
            if (!data.key || !data.machineId || !data.expiryDate) {
                throw new Error('Invalid license data format');
            }
            
            fs.writeFileSync(this.licenseFilePath, JSON.stringify(data, null, 2), 'utf8');
            this.licenseData = data;
            console.log('License data saved successfully:', data);
            return true;
        } catch (error) {
            console.error('Error saving license data:', error);
            return false;
        }
    }

    async activateLicense(licenseKey) {
        try {
            const deviceId = await this.getMachineId();
            
            // Make API call to activate license with the specified format
            const response = await fetch(`${this.apiEndpoint}/api/licenses/activate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ 
                    licenseKey: licenseKey,
                    deviceId: deviceId
                }),
            });

            if (!response.ok) {
                throw new Error('License activation failed');
            }

            const data = await response.json();
            
            // Save the license data after successful activation
            await this.saveLicenseData({
                key: licenseKey,
                expiryDate: data.expiryDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
                machineId: deviceId,
                activatedAt: new Date().toISOString(),
                lastValidated: new Date().toISOString()
            });

            return {
                success: true,
                message: 'License activated successfully',
                expiryDate: data.expiryDate
            };
        } catch (error) {
            console.error('License activation error:', error);
            return {
                success: false,
                message: `License activation failed: ${error.message}`
            };
        }
    }

    async isLicenseValid() {
        try {
            if (!this.licenseData) {
                return {
                    success: false,
                    message: 'No license data found. Please activate a license first.'
                };
            }

            const deviceId = await this.getMachineId();
            
            // Make API call to verify license status
            const response = await fetch(`${this.apiEndpoint}/api/licenses/validate`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    licenseKey: this.licenseData.key,
                    deviceId: deviceId
                })
            });

            const data = await response.json();

            if (!data.isValid) {
                return {
                    success: false,
                    message: data.message || 'License validation failed'
                };
            }
            const expiryValidation = await this.validateLicenseBeforeAction();

            if(!expiryValidation.success){
                return {
                    success: false,
                    message: expiryValidation.message
                };
            }
            // Update last validated timestamp
            this.licenseData.lastValidated = new Date().toISOString();
            await this.saveLicenseData(this.licenseData);

            return {
                success: true,
                message: 'License is valid',
                expiryDate: this.licenseData.expiryDate
            };
        } catch (error) {
            console.error('License validation error:', error);
            return {
                success: false,
                message: `Error checking license: ${error.message}`
            };
        }
    }

    async validateLicenseBeforeAction() {
        try {
            if (!this.licenseData) {
                return {
                    success: false,
                    message: 'No license found. Please activate a license first.'
                };
            }

            // Check if license is expired
            const expiryDate = new Date(this.licenseData.expiryDate);
            if (expiryDate < new Date()) {
                return {
                    success: false,
                    message: 'License has expired. Please renew your license.'
                };
            }

            // Check if machine ID matches
            const currentMachineId = await this.getMachineId();
            if (currentMachineId !== this.licenseData.machineId) {
                return {
                    success: false,
                    message: 'License is not valid for this machine.'
                };
            }

            return { success: true };
        } catch (error) {
            console.error('License validation error:', error);
            return {
                success: false,
                message: 'Error validating license: ' + error.message
            };
        }
    }

    getMachineId() {
        // Generate a unique machine ID based on hardware information
        // This is a simple example - you might want to use more sophisticated methods
        const networkInterfaces = os.networkInterfaces();
        
        // Get the first MAC address we can find
        let macAddress = '';
        for (const interfaceKey in networkInterfaces) {
            const networkInterface = networkInterfaces[interfaceKey];
            for (const config of networkInterface) {
                if (!config.internal && config.mac !== '00:00:00:00:00:00') {
                    macAddress = config.mac;
                    break;
                }
            }
            if (macAddress) break;
        }

        // Combine various system information
        const systemInfo = [
            macAddress,
            os.hostname(),
            os.platform(),
            os.arch(),
            os.cpus()[0].model
        ].join('|');

        // Create a hash of the system information
        return crypto.createHash('sha256').update(systemInfo).digest('hex');
    }

    initializeHandlers() {
        ipcMain.handle('activate-license', async (event, licenseKey) => {
            return await this.activateLicense(licenseKey);
        });

        ipcMain.handle('check-license-status', async () => {
            return await this.isLicenseValid();
        });
    }
}

module.exports = LicenseManager; 