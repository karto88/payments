# Jira Agent

ამ პროექტის ტესტებიდან **ავტომატურად ქმნის Jira Bug-ს** — მაგრამ **მხოლოდ რეალურ product bug-ზე**.

⚠️ არსებულ Jira issue-ებს **არ ვეხებით** — მხოლოდ ვქმნით ახალ ticket-ებს ამ პროექტის ტესტებიდან.

---

## 🎯 მთავარი წესი: რა არის bug და რა არა

| ჩავარდნა | Jira Bug? | რატომ |
|---|---|---|
| GET status-მა body/ველი არ დააბრუნა | ✅ **კი** | product bug |
| ორდერზე backend-მა URL არ დააბრუნა | ✅ **კი** | product bug |
| OTP ვერ მოვიდა / დააგვიანა | ❌ **არა** | infra flakiness |
| Chrome / timeout / ქსელი | ❌ **არა** | infra |

**როგორ განვასხვავებთ:** Bug იქმნება მხოლოდ მაშინ, როცა ტესტი ჩავარდა
`utils/assertions.ts`-ის helper-ით (`ApiAssertionError`). ეს helper-ები აყენებენ
marker-ს `❌ API TEST FAILED`, რომელსაც reporter ცნობს.

👉 ამიტომ **product შემოწმებები დაწერე `assertions.ts`-ის helper-ებით**
(`assertKeysPresent`, `assertField`, `assertCondition`). infra შეცდომები (OTP და ა.შ.)
ჩვეულებრივ `throw`-ით რჩება და bug-ს **არ** ქმნის.

---

## გამოყენება

### ტესტები + ავტომატური Jira bug reporting
```bash
npm run test:jira                                          # ყველა ტესტი
npm run test:jira -- tests/Positive/gps-status.spec.ts     # კონკრეტული
```
- ✅ ტესტი გაიარა → არაფერი
- ❌ product bug → Jira Bug იქმნება (dedup — დუბლიკატს არ ქმნის, კომენტარს ამატებს)
- ❌ infra (OTP და ა.შ.) → ticket **არ** იქმნება

### ჩვეულებრივი გაშვება (Jira-ს გარეშე)
```bash
npx playwright test        # bug არ იქმნება (JIRA_REPORT არ არის)
```

### ბაგის ხელით შექმნა
```bash
npm run create-bug -- "summary" "description"
```

---

## Setup (`.env`)
```
JIRA_BASE_URL=https://keepz-me.atlassian.net
JIRA_EMAIL=d.kartozia@keepz.me
JIRA_API_TOKEN=<შენი token>
JIRA_PROJECT_KEY=KD
```

---

## ფაილები

| ფაილი | დანიშნულება |
|---|---|
| `jiraClient.js` | Jira REST API client (token-ით) |
| `reporter.js` | 🎯 Playwright reporter — product bug → Jira Bug |
| `run-with-report.js` | `test:jira`-ის wrapper (JIRA_REPORT=1) |
| `create-bug.js` | ბაგის ხელით შექმნა |
