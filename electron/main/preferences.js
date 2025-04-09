const { ipcMain } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { app } = require('electron');

class PreferencesManager {
    constructor() {
        this.preferencesPath = path.join(app.getPath('userData'), 'preferences.json');
        this.preferences = {
            shareData: false // Default to false
        };
        
        this.loadPreferences();
    }

    async loadPreferences() {
        try {
            const data = await fs.readFile(this.preferencesPath, 'utf8');
            this.preferences = JSON.parse(data);
        } catch (error) {
            // If file doesn't exist or is invalid, use defaults
            await this.savePreferences();
        }
    }

    async savePreferences() {
        try {
            await fs.writeFile(this.preferencesPath, JSON.stringify(this.preferences, null, 2));
            return true;
        } catch (error) {
            console.error('Error saving preferences:', error);
            return false;
        }
    }

    async setDataSharing(enabled) {
        this.preferences.shareData = enabled;
        const success = await this.savePreferences();
        return { success };
    }

    getDataSharing() {
        return this.preferences.shareData;
    }
}

module.exports = PreferencesManager; 