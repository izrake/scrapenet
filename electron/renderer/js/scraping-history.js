// Add download buttons to each session card
function createSessionCard(session) {
    const card = document.createElement('div');
    card.className = 'session-card';
    card.innerHTML = `
        <div class="session-header">
            <h3>${session.scrape_type === 'profile' ? 'Profile Scraping' : 'Search Scraping'}</h3>
            <div class="session-actions">
                <button class="download-btn" data-session-id="${session._id}">
                    <i class="fas fa-download"></i> Download
                </button>
                <button class="delete-btn" data-session-id="${session._id}">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        </div>
        <div class="session-details">
            <p><strong>Target:</strong> ${session.target}</p>
            <p><strong>Status:</strong> <span class="status-${session.status}">${session.status}</span></p>
            <p><strong>Tweets Found:</strong> ${session.tweets_found || 0}</p>
            <p><strong>Started:</strong> ${new Date(session.started_at).toLocaleString()}</p>
            ${session.completed_at ? `<p><strong>Completed:</strong> ${new Date(session.completed_at).toLocaleString()}</p>` : ''}
        </div>
    `;

    // Add click handler for download button
    const downloadBtn = card.querySelector('.download-btn');
    downloadBtn.addEventListener('click', async () => {
        try {
            downloadBtn.disabled = true;
            downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Downloading...';
            
            const result = await window.electron.ipcRenderer.invoke('downloadTweetsBySession', session._id);
            
            if (result.success) {
                showNotification(`Successfully downloaded ${result.tweetCount} tweets to ${result.filePath}`, 'success');
            } else {
                showNotification('Failed to download tweets', 'error');
            }
        } catch (error) {
            console.error('Error downloading tweets:', error);
            showNotification('Error downloading tweets: ' + error.message, 'error');
        } finally {
            downloadBtn.disabled = false;
            downloadBtn.innerHTML = '<i class="fas fa-download"></i> Download';
        }
    });

    return card;
}

// Add download all tweets button to the header
function createScrapingHistoryHeader() {
    const header = document.createElement('div');
    header.className = 'scraping-history-header';
    header.innerHTML = `
        <h2>Scraping History</h2>
        <div class="header-actions">
            <button id="downloadAllBtn" class="download-all-btn">
                <i class="fas fa-download"></i> Download All Tweets
            </button>
            <button id="clearHistoryBtn" class="clear-history-btn">
                <i class="fas fa-trash"></i> Clear History
            </button>
        </div>
    `;

    // Add click handler for download all button
    const downloadAllBtn = header.querySelector('#downloadAllBtn');
    downloadAllBtn.addEventListener('click', async () => {
        try {
            downloadAllBtn.disabled = true;
            downloadAllBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Downloading...';
            
            const result = await window.electron.ipcRenderer.invoke('downloadAllTweets');
            
            if (result.success) {
                showNotification(`Successfully downloaded ${result.tweetCount} tweets to ${result.filePath}`, 'success');
            } else {
                showNotification('Failed to download tweets', 'error');
            }
        } catch (error) {
            console.error('Error downloading all tweets:', error);
            showNotification('Error downloading tweets: ' + error.message, 'error');
        } finally {
            downloadAllBtn.disabled = false;
            downloadAllBtn.innerHTML = '<i class="fas fa-download"></i> Download All Tweets';
        }
    });

    return header;
} 