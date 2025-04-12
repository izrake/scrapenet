# Twitter Scraper App

A desktop application for scraping Twitter/X data with support for profile scraping, search queries, and home timeline extraction.

## Features

- Profile scraping with detailed user information
- Search tweets by keywords
- Home timeline scraping
- Automatic session management
- Data storage in MongoDB
- Cross-platform support (macOS, Windows, Linux)

## Prerequisites

- Node.js (v16 or higher)
- npm (v7 or higher)
- Xcode Command Line Tools (for macOS builds)

## Installation

### Pre-built Binaries

Download the latest release for your platform:

- **Windows**: Download the `.exe` installer or portable version
- **macOS**: Download the `.dmg` file
- **Linux**: Download the `.AppImage` or `.deb` package

### Building from Source

1. Clone the repository:
```bash
git clone https://github.com/yourusername/twitter-scraper.git
cd twitter-scraper
```

2. Install dependencies:
```bash
npm install
```

3. Build the application:
```bash
# Build for all platforms
npm run build

# Or build for specific platform
npm run build:mac    # For macOS
npm run build:win    # For Windows
npm run build:linux  # For Linux
```

The built applications will be available in the `dist` directory.

## Configuration

1. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

2. Configure the MongoDB connection and other settings in the `.env` file.

## Usage

1. Launch the application
2. Click "Start Twitter Authentication" to log in
3. Use the different scraping options:
   - Search Tweets: Enter keywords and number of tweets
   - Scrape Profile: Enter Twitter username and tweet limit
   - Home Timeline: Set number of tweets to scrape

## Data Storage

- Tweets and profile data are stored in MongoDB
- Temporary files are stored in the application data directory
- Session data is preserved between app restarts

## Requirements

- MongoDB server (local or remote)
- Internet connection
- Twitter/X account for authentication

## Troubleshooting

1. **Login Issues**
   - Clear the stored session using the logout button
   - Restart the application
   - Check your internet connection

2. **Scraping Issues**
   - Verify your MongoDB connection
   - Check the tweet limits
   - Ensure you're properly logged in

## License

MIT License - See LICENSE file for details 