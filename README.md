# Schoolar Schedule

A client-side, local-first school scheduling application.

## 🚀 Live Demo
The application is automatically deployed to GitHub Pages:
`https://<your-username>.github.io/schoolar-schedule/`

## ✨ Features
- **Offline-First:** All data is stored in your browser's IndexedDB. No server required.
- **Privacy:** Your school data never leaves your computer.
- **Powerful Scheduling:** A dedicated Web Worker handles heavy computations without freezing the UI.
- **Export/Import:** Save your work as `.schoolproj` files for portability.

## 🛠 Development

### Setup
```bash
npm install
```

### Run Locally
```bash
npm run dev
```

### Build for Production
```bash
npm run build
```

## 🏗 Architecture
- **UI:** React + Vite + TypeScript
- **State Management:** React Context + IndexedDB (StorageService)
- **Scheduling Engine:** Web Worker (Scheduling Engine Layer)
- **Deployment:** GitHub Actions to GitHub Pages

## 📄 License
MIT
