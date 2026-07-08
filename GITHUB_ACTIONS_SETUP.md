# GitHub Actions + Allure Report Setup

## 📋 ჩამატებული ფაილები და ცვლილებები

### 1. **დაინსტალირებული პაკეტები**
```bash
npm install --save-dev allure-playwright
```

**package.json** - დაემატა:
- `allure-playwright` (devDependencies)

---

### 2. **playwright.config.ts**
დაემატა Allure reporter:

```typescript
reporter: [
  ['html'],
  ['allure-playwright', {
    outputFolder: 'allure-results',
    detail: true,
    suiteTitle: true,
  }],
],
```

---

### 3. **.github/workflows/playwright.yml** (ახალი ფაილი)
GitHub Actions workflow რომელიც:
- ✅ ავტომატურად გაუშვებს Playwright ტესტებს
- ✅ დააგენერირებს Allure Report-ს
- ✅ გამოაქვეყნებს GitHub Pages-ზე

**Workflow Triggers:**
- Push to `main` or `master` branch
- Pull Request to `main` or `master` branch
- Manual trigger (workflow_dispatch)

---

### 4. **.gitignore**
დაემატა Allure დირექტორიები:
```
/allure-results/
/allure-report/
/allure-history/
```

---

## 🚀 GitHub-ზე ატვირთვის ინსტრუქცია

### 1️⃣ **GitHub Repository-ში GitHub Pages გააქტიურება**

1. GitHub-ზე გადადით თქვენს რეპოზიტორიაში
2. Settings → Pages
3. **Source:** აირჩიეთ `gh-pages` branch
4. **Folder:** `/ (root)`
5. Save

---

### 2️⃣ **GitHub Secrets დამატება**

Settings → Secrets and variables → Actions → New repository secret

დაამატეთ შემდეგი secrets:

| Secret Name | Value |
|------------|-------|
| `GMAIL_USER` | თქვენი Gmail |
| `GMAIL_APP_PASSWORD` | Gmail App Password |
| `ADMIN_USERNAME` | ადმინის Username |
| `ADMIN_PASSWORD` | ადმინის Password |
| `AUTH_DEVICE_USERNAME` | Device Auth Username |
| `AUTH_DEVICE_PASSWORD` | Device Auth Password |

---

### 3️⃣ **კოდის ატვირთვა GitHub-ზე**

```bash
git add .
git commit -m "Add GitHub Actions with Allure Report"
git push origin main
```

---

## 📊 Allure Report-ის ნახვა

ატვირთვის შემდეგ Allure Report იქნება ხელმისაწვდომი:

```
https://<your-username>.github.io/<repository-name>/
```

**მაგალითი:**
- თუ თქვენი username არის: `karto88`
- Repository: `playwright-testing`
- Allure Report: `https://karto88.github.io/playwright-testing/`

---

## 🔄 როგორ მუშაობს Workflow

1. **ტესტების გაშვება** - Playwright ტესტები ეშვება CI-ში
2. **Allure Results** - ტესტების შედეგები ინახება `allure-results/` დირექტორიაში
3. **History Load** - იტვირთება წინა ტესტების ისტორია `gh-pages` branch-დან
4. **Report Generation** - Allure Report იგენერირება ისტორიით
5. **GitHub Pages Deploy** - რეპორტი აიტვირთება `gh-pages` branch-ზე
6. **Live URL** - რეპორტი ხელმისაწვდომია GitHub Pages URL-ზე

---

## 📁 პროექტის სტრუქტურა

```
Admin - Playwright/
├── .github/
│   └── workflows/
│       └── playwright.yml       # GitHub Actions workflow
├── .gitignore                   # Allure დირექტორიები დამატებული
├── playwright.config.ts         # Allure reporter დაკონფიგურირებული
├── package.json                 # allure-playwright დაინსტალირებული
└── GITHUB_ACTIONS_SETUP.md      # ეს დოკუმენტაცია
```

---

## ✅ შემოწმება

GitHub-ზე ატვირთვის შემდეგ:

1. **Actions** tab-ში დაინახავთ workflow-ის გაშვებას
2. Workflow დასრულების შემდეგ გადადით GitHub Pages URL-ზე
3. Allure Report უნდა იყოს ხელმისაწვდომი

---

## 🐛 Troubleshooting

### თუ GitHub Pages არ მუშაობს:
1. Settings → Pages → Source: `gh-pages` branch
2. დაელოდეთ 2-3 წუთს deployment-ს
3. დარწმუნდით რომ workflow წარმატებით დასრულდა

### თუ ტესტები ვერ გაეშვა:
1. შეამოწმეთ GitHub Secrets სწორად არის დამატებული
2. Actions → Workflow run → ნახეთ logs რა შეცდომა იყო

---

## 📝 შენიშვნა

⚠️ **არ დაამატოთ .env ფაილი GitHub-ზე!**  
ყველა სენსიტიური ინფორმაცია უნდა იყოს GitHub Secrets-ში.
