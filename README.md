# Twitter Scraper

A powerful, open-source desktop application for ethically scraping Twitter data. Built with Electron and Playwright.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)

## 🚀 Features

- **Automated Twitter Authentication**: Secure login process using your Twitter credentials
- **Advanced Search Capabilities**: Search tweets by keywords, hashtags, or users
- **Profile Scraping**: Gather public profile information
- **Data Export**: Export results in multiple formats
- **Cross-Platform**: Supports macOS, Windows, and Linux
- **User-Friendly Interface**: Clean and intuitive desktop application

## 📋 Prerequisites

- Node.js 16.x or higher
- A compatible Chromium-based browser (Chrome, Edge, or Brave)
- Valid Twitter account

## 🔧 Installation

1. Clone the repository:
```bash
git clone https://github.com/izrake/twitter-scraper.git
cd twitter-scraper
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file based on `.env.example`:
```bash
cp .env.example .env
```

4. Build the application:
```bash
# For macOS
npm run build:mac

# For Windows
npm run build:win

# For Linux
npm run build:linux
```

## 💻 Usage

1. Launch the application
2. Log in with your Twitter credentials
3. Configure your scraping parameters
4. Start collecting data

### Development

To run the application in development mode:

```bash
npm run dev
```

## 🔐 Authentication

This application requires users to authenticate with their Twitter credentials to:
- Ensure ethical data collection
- Comply with Twitter's terms of service
- Provide accurate and reliable results

## 📄 License

This project is licensed under the MIT License with the following conditions:

1. **Personal Use**: Free for personal, non-commercial use
2. **Commercial Use**: Requires explicit permission from the author
3. **Authentication**: Required for all usage

See the [LICENSE](LICENSE) file for details.

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 Guidelines

- Follow the existing code style
- Add unit tests for any new code
- Update documentation as needed
- Ensure all tests pass before submitting

## ⚠️ Disclaimer

This tool is for educational and research purposes only. Users are responsible for ensuring their use of this tool complies with Twitter's Terms of Service and applicable laws.

## 🙏 Acknowledgments

- [Electron](https://www.electronjs.org/)
- [Playwright](https://playwright.dev/)
- [Node.js](https://nodejs.org/)

## 📞 Support

For support, please:
1. Check the [Issues](https://github.com/izrake/twitter-scraper/issues) page
2. Create a new issue if your problem isn't already listed
3. For commercial use inquiries, contact: scrapenetai@gmail.com

## 🔄 Updates

Stay updated with the latest version:
```bash
git pull origin main
npm install
```

---
Made with ❤️ by [Prashant Maurya](https://github.com/izrake)