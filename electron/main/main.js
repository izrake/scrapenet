// Add handlers for downloading tweets
ipcMain.handle('download-all-tweets', async () => {
    try {
        if (!db) {
            throw new Error('Database connection not available');
        }
        
        console.log('Downloading all tweets...');
        const tweets = await db.downloadAllTweets();
        
        // Create a timestamp for the filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `all_tweets_${timestamp}.json`;
        
        // Save to downloads folder
        const downloadsPath = app.getPath('downloads');
        const filePath = path.join(downloadsPath, filename);
        
        await fs.writeFile(filePath, JSON.stringify(tweets, null, 2));
        
        return {
            success: true,
            filePath,
            tweetCount: tweets.length
        };
    } catch (error) {
        console.error('Error downloading all tweets:', error);
        throw error;
    }
});

ipcMain.handle('download-tweets-by-session', async (event, sessionId) => {
    try {
        if (!db) {
            throw new Error('Database connection not available');
        }
        
        if (!sessionId) {
            throw new Error('Session ID is required');
        }

        console.log('Downloading tweets for session:', sessionId);
        const data = await db.downloadTweetsBySession(sessionId);
        
        // Create a timestamp for the filename
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const filename = `session_${sessionId}_tweets_${timestamp}.json`;
        
        // Save to downloads folder
        const downloadsPath = app.getPath('downloads');
        const filePath = path.join(downloadsPath, filename);
        
        await fs.writeFile(filePath, JSON.stringify(data, null, 2));
        
        return {
            success: true,
            filePath,
            tweetCount: data.tweets.length,
            sessionInfo: data.session
        };
    } catch (error) {
        console.error('Error downloading session tweets:', error);
        throw error;
    }
}); 