# Steel Scrap CBAM Dashboard

A modern, interactive web dashboard for analyzing steel scrap prices with CBAM (Carbon Border Adjustment Mechanism) impact analysis.

## Features

- 📊 Interactive price charts with Recharts
- 📈 Moving averages (30-day and 90-day)
- 🎯 CBAM milestone markers and timeline
- 💰 Financial analysis by period
- 📱 Responsive design
- 🎨 Modern minimalistic UI

## Quick Start

1. **Install dependencies:**
```bash
npm install
```

2. **Verify data file:**
   - The `data.csv` file should be in the `public/` folder
   - If not, copy it: `cp data.csv public/data.csv`

3. **Start the development server:**
```bash
npm run dev
```

4. **Open your browser:**
   - The app will automatically open at `http://localhost:3000`
   - Or manually navigate to the URL shown in the terminal

## Build for Production

```bash
npm run build
```

The built files will be in the `dist/` folder. You can serve them with any static file server.

## Technologies Used

- **React 18** - UI framework
- **Recharts** - Charting library
- **Vite** - Build tool and dev server
- **Modern CSS** - Responsive, minimalistic design

## Project Structure

```
├── src/
│   ├── App.jsx          # Main dashboard component
│   ├── App.css          # Dashboard styles
│   ├── main.jsx         # React entry point
│   ├── index.css        # Global styles
│   └── utils/
│       └── dataParser.js # Data parsing utilities
├── public/
│   └── data.csv         # Steel scrap price data
├── index.html           # HTML template
├── package.json         # Dependencies
└── vite.config.js       # Vite configuration

```

