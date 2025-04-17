# Scrapenet AI - Your social assistant which keeps everything local

A powerful, open-source desktop application for ethically scraping Twitter data. Built with Electron and Playwright.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)

## 🤔 Why I Built This

Ever found yourself endlessly scrolling through Twitter, watching hours slip away? I did. That's why I created this tool.

### 🎯 The Vision
I wanted to add more meaningful hours back into people's lives. Instead of being caught in the infinite scroll:
- Let ScrapeNet handle the data collection
- Check updates on your schedule (every 5 minutes or end of day)
- Get exactly what matters to you, when you want it

### 💡 The Impact
- **Time Saved**: Personally saved hours daily by eliminating mindless scrolling
- **Better Focus**: Get updates on your terms, not the platform's
- **Data Control**: Everything runs locally - your data stays with you
- **Future-Proof**: Starting with Twitter, expanding to more social platforms

### 🔒 Privacy First
Your privacy matters. That's why:
- All processing happens on your local machine
- No cloud storage or third-party servers
- You maintain complete control of your data
- Open source for full transparency

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
git clone https://github.com/izrake/scrapenet.git
cd scrapenet
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
1. Check the [Issues](https://github.com/izrake/scrapenet/issues) page
2. Create a new issue if your problem isn't already listed
3. For commercial use inquiries, contact: scrapenetai@gmail.com

## 🔄 Updates

Stay updated with the latest version:
```bash
git pull origin main
npm install
```

## 🗺️ Roadmap

- Twitter Integration (Current)
- LinkedIn Integration (Coming Soon)
- Instagram Integration (Planned)
- Facebook Integration (Planned)
- Custom Alert System
- Advanced Analytics Dashboard

## 💭 Philosophy

This project was born from a simple idea: technology should work for us, not the other way around. By automating social media monitoring, we free ourselves to focus on what truly matters while staying informed.

### Core Principles:
- **Time is Precious**: Automate the mundane to focus on the meaningful
- **Data Privacy**: Your data should belong to you
- **Open Source**: Community-driven development for better solutions
- **Ethical Design**: Respecting platform rules and user privacy

## 📢 Feedback & Community

Your feedback helps make ScrapeNet better! We'd love to hear about your experience.

### 📝 Share Your Experience
Please take a moment to fill out our feedback form:
[**Submit Feedback**](https://forms.gle/CFC4LwiDEJX4Vsy8A)

We're particularly interested in:
- How many hours ScrapeNet is saving you daily
- Features you love
- Areas for improvement
- New feature suggestions

### 🐛 Reporting Issues
For technical issues or bugs:
1. Check existing [Issues](https://github.com/izrake/scrapenet/issues)
2. Create a new issue with detailed reproduction steps

### 📊 Impact Tracking
Help us measure the collective time saved by sharing:
- Your use cases
- Time saved daily
- Productivity improvements

---
Made with ❤️ by [Prashant Maurya](https://github.com/izrake)