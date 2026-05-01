# Contributing to PhotoBook Studio

Thank you for your interest in contributing! This document explains how to get involved.

## Ways to contribute

- 🐛 **Bug reports** — open an Issue with steps to reproduce
- 💡 **Feature requests** — open an Issue describing the use case
- 🔧 **Code contributions** — fork → branch → PR
- 🌍 **Translations** — add a new locale file (see below)
- 📸 **Screenshots / docs** — improve the README with real screenshots

## Development setup

```bash
# Backend
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev
```

Vite proxies `/api/*` to `localhost:8000` automatically.

## Adding a language

1. Copy `frontend/src/locales/en.js` → `frontend/src/locales/XX.js`  
   (use the ISO 639-1 code, e.g. `de`, `fr`, `es`)
2. Translate all **values** — do not change the **keys**
3. Register the locale in `frontend/src/i18n.jsx`:

```js
import xx from './locales/xx.js'
export const LOCALES = {
  it: { label: 'Italiano', dict: it },
  en: { label: 'English',  dict: en },
  xx: { label: 'Your language name', dict: xx },
}
```

4. Open a PR with the title `i18n: add [Language name]`

## Pull request checklist

- [ ] The frontend builds without errors: `cd frontend && npm run build`
- [ ] The backend imports without errors: `python3 -c "from main import app"`
- [ ] Existing functionality is not broken
- [ ] New strings are added to **both** `it.js` and `en.js`
- [ ] The PR description explains what and why

## Code style

- **Python**: PEP 8, type hints on public functions, docstrings for modules
- **JavaScript/React**: functional components, hooks, no class components
- **Commits**: `Add: feature`, `Fix: bug description`, `Refactor: what`, `Docs: what`

## Reporting security issues

Please **do not** open a public Issue for security vulnerabilities.  
Email the maintainer directly or use GitHub's private security advisory feature.
