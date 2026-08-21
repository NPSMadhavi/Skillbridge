# 🎓 SkillBridge AI — Frontend

> **Next-Generation AI-Powered Learning Management System (LMS)** with Adaptive Multi-Lingual AI Tutoring, Biometric Face ID Authentication, Dynamic AI Curriculum Generation, and Automated Certificate Issuance.

---

## 🌟 Table of Contents

- [Overview](#-overview)
- [Key Features](#-key-features)
  - [Student Experience](#-student-experience)
  - [Admin Console](#-admin-console)
- [Tech Stack](#-tech-stack)
- [Architecture & Folder Structure](#-architecture--folder-structure)
- [Getting Started](#-getting-started)
  - [Prerequisites](#prerequisites)
  - [Installation](#installation)
  - [Development Server](#development-server)
  - [Production Build](#production-build)
- [Seeded Credentials](#-seeded-credentials)
- [Configuration & API Integration](#-configuration--api-integration)
- [Key UI Modules](#-key-ui-modules)

---

## 📖 Overview

**SkillBridge AI** is an intelligent, accessible, and enterprise-grade learning platform tailored for multilingual learners and modern workforces. It bridges skill gaps through personalized AI teaching, automated document-to-course generation, strict assessment criteria, and biometric security.

---

## ✨ Key Features

### 🎓 Student Experience

- **🤖 ARIA AI Tutor Player**:
  - Interactive lesson delivery with synchronized voice, text, and visual breakdowns.
  - Multi-language voice narration and text translations (English, Chinese, Malay, Tamil, Bangla).
  - Real-time AI chat assistant with microphone voice input and streaming responses.
- **🔒 Module Progression & Lesson Gating**:
  - Step-by-step lesson completion tracking.
  - Interactive chapter quizzes with pass threshold mark (60%+ required).
- **📜 Verified Certificate of Completion**:
  - Instant vector-rendered completion certificates.
  - One-click direct PDF generation & download using `jsPDF` and `html2canvas`.
  - Celebration fanfare and confetti on milestone achievement.
- **🌐 Language Selection & Localization**:
  - User-preferred language onboarding for personalized localized learning.

### 🛡️ Admin Console

- **📊 Metrics Dashboard**:
  - Real-time statistics tracking total learners, Face ID enrollment rates, regional distribution, and pending verifications.
- **📸 Biometric Face ID Registration**:
  - Integrated multi-shot webcam capture for Face ID registration.
  - Duplicate detection checks for FIN, Email, and Face biometrics.
- **📚 AI Course Manager**:
  - Upload course documents & PDFs (up to 30MB).
  - Automated AI pipeline: Uploading ➔ Parsing ➔ Structuring Curriculum ➔ Finalizing Lessons & Quizzes.
  - Full CRUD operations: create, preview, edit, and delete courses.
- **👥 Learner Roster & Management**:
  - View, search, edit, activate/deactivate, and delete user profiles.
  - Biometric Face ID re-capture and profile audits.
- **🎯 Course Assignment Matrix**:
  - Assign courses **By Learner** (bulk assign courses to an individual).
  - Assign courses **By Course** (bulk enroll multiple learners to a course).
- **🔔 Toastify Notifications**:
  - Real-time feedback and status alerts across all admin operations using `react-toastify`.

---

## 🛠️ Tech Stack

| Category | Technology |
|---|---|
| **Framework** | [React 19](https://react.dev/) |
| **Build Tool & Bundler** | [Vite 8](https://vitejs.dev/) |
| **Routing** | [React Router v7](https://reactrouter.com/) |
| **Styling** | [Tailwind CSS v4](https://tailwindcss.com/) & Vanilla CSS |
| **Notifications** | [React-Toastify](https://fkhadra.github.io/react-toastify/) |
| **PDF Generation** | [jsPDF](https://github.com/parallax/jsPDF) & [html2pdf.js](https://github.com/eKoopmans/html2pdf.js) |
| **Animations & FX** | [canvas-confetti](https://www.npmjs.com/package/canvas-confetti) & Web Audio API Fanfare |
| **Linter** | [Oxlint](https://oxc.rs/) |

---

## 📂 Architecture & Folder Structure

```text
Frontend/
├── public/                  # Static assets & favicons
├── src/
│   ├── assets/              # Branding logos, badges, and icons
│   ├── components/          # Reusable UI components
│   │   ├── admin/           # Admin layout, sidebar, and nav
│   │   ├── CountrySelect.jsx# Searchable country dropdown
│   │   └── Header.jsx       # Student navigation header & search bar
│   ├── data/
│   │   └── courses.js       # Default curriculum fallback datasets
│   ├── pages/
│   │   ├── admin/           # Admin Console views
│   │   │   ├── AdminCourses.jsx       # Course manager & AI generation
│   │   │   ├── AdminDashboard.jsx     # Overview & metrics
│   │   │   ├── AdminLogin.jsx         # Admin authentication
│   │   │   ├── CourseAssignments.jsx  # Learner enrollment matrix
│   │   │   ├── RegisterUser.jsx       # User onboarding + Face ID
│   │   │   └── UsersList.jsx          # Learner directory & management
│   │   ├── Assessment.jsx   # Quiz evaluation & scoring engine
│   │   ├── Certificate.jsx  # Printable certificate renderer
│   │   ├── CoursePlayer.jsx # AI interactive player & tutor
│   │   ├── Home.jsx         # Student course catalog & dashboard
│   │   ├── Language.jsx     # Language onboarding selection
│   │   ├── Login.jsx        # Student login & Face ID verification
│   │   └── MyCertificates.jsx# Earned certificates gallery
│   ├── services/
│   │   └── api.js           # Centralized API service & HTTP client
│   ├── utils/
│   │   ├── certificatePdf.js# Direct vector PDF certificate exporter
│   │   └── confettiBlast.js # Confetti FX & Web Audio fanfare
│   ├── App.jsx              # Application router & route guards
│   ├── index.css            # Design tokens, typography & CSS animations
│   └── main.jsx             # React DOM root entry point
├── package.json
└── vite.config.js
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: `v18.0.0` or later (Node 20+ recommended)
- **npm**: `v9.0.0` or later

### Installation

Navigate to the `Frontend` directory and install the dependencies:

```bash
cd Frontend
npm install
```

### Development Server

Start the local Vite development server:

```bash
npm run dev
```

The application will be accessible at: `http://localhost:5173` (or the port specified by Vite).

### Production Build

Create an optimized production bundle:

```bash
npm run build
```

Preview the production build locally:

```bash
npm run preview
```

---

## 🔑 Seeded Login Credentials

Use the pre-configured credentials below to test both roles:

### 🛡️ Admin Portal (`/admin`)
- **Email**: `admin@skillbridge.com`
- **Password**: `AdminPassword123`

### 🎓 Student Portal (`/login`)
- **Email**: `premsai@netopsys.in`
- **Password**: `Password123`

---

## ⚙️ Configuration & API Integration

The frontend communicates with the backend via [`src/services/api.js`](file:///c:/Praveen/Skill-Bridge/Frontend/src/services/api.js):

- **Production / Proxy Mode**: `/api/v1`
- **Local Standalone API**: `http://localhost:5000/api/v1`

When deploying behind a reverse proxy (Nginx / Vite proxy / Cloudflare), requests to `/api/v1/*` are automatically forwarded to the backend server.

---

## 📄 License

This project is proprietary and confidential. Created for **SkillBridge AI**.
