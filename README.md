# AG Church Accounts

An income and expenditure ledger for an Assemblies of God church. It runs entirely in the web browser. There is nothing to install and no server.

## What it does

- Records income and expenses, each with a date, type, amount, description, name, payment method and receipt number.
- Backdating: choose any past date and the entry is filed under that month.
- Income and expense types can be added and removed (Tithes, Offerings, Building Fund and so on).
- Four bank accounts (Projects, Bible School, National General Fund, Festival of Hope): enter each account's balance from its statement, choose the account on every income and expense, and see each balance plus the total across all accounts.
- Reports for any week, month, quarter or year, and a General Council report covering 2.5 years: statement, bank accounts, provinces, month-by-month figures, an AI-written report, and a PDF to download, print or share.
- Provinces: record the province and church on each income entry to see a chart of giving by province, month-by-month activity, participation by church, and an AI summary.
- Scan documents: photograph a receipt, invoice, bank statement or report and Claude summarizes it, pulls out the figures, and can fill in an entry from it.
- A year view and CSV export.
- Invoices: create numbered invoices with line items, download them as PDF, print or share them, and mark them paid (which records the income).
- AI-written monthly report with a summary, observations and recommendations.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The app. This is the page GitHub Pages serves. |
| `standalone.js` | Storage, AI reports and downloads for the GitHub version. |
| `logo.png` | The church crest shown in the header. |
| `claude-version/church-accounts.html` | The same app as published on claude.ai, kept here as a copy of the source. |

## Using it from GitHub (GitHub Pages)

1. In the repository, open **Settings**, then **Pages**.
2. Under **Build and deployment**, set **Source** to "Deploy from a branch", choose the `main` branch and the `/ (root)` folder, and save.
3. After a minute or two the page shows the address of the site, in the form `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`.

GitHub Pages on a **private** repository needs a paid GitHub plan. On a free account, either make the repository public (no financial entries are ever stored in the repository) or download the files and open `index.html` from the computer.

## Where the entries are kept

In the GitHub version, entries are saved in the browser on the device being used.

- They are not uploaded to GitHub and are not shared between devices.
- Clearing the browser's data deletes them.
- Use **Download backup** in the "This device" panel at the bottom of the page regularly, and keep the file somewhere safe. **Restore from backup** loads it again, on the same or another device.

The version published on claude.ai keeps entries online in the owner's Claude account instead, so they are available from any device after signing in.

## AI reports

In the GitHub version, AI reports use your own Anthropic API key, and Anthropic bills each report to that key's account.

1. Create an API key in the Anthropic Console.
2. In the app, open **AI report key** in the "This device" panel and paste the key. It is stored only in that browser.
3. Open **Monthly report** and press **Write report with AI**. That month's entries are sent to Anthropic to write the report.

Never put the API key into any file in this repository.

## Keeping track of changes

Every change uploaded to this repository is recorded under **Commits**, with the date and what changed, and any earlier version can be opened or restored from there.

## Shared online database (Firebase)

`firebase-config.js` connects the GitHub version to the church's Firebase project (`assemblies-of-god-accounting`). While that file is present:

- Entries, invoices, reports and settings are saved online in Cloud Firestore, so every signed-in device sees the same books. The section "Where the entries are kept" above describes the app without this file.
- The app opens on a sign-in screen. Accounts are created only in the Firebase console (Authentication, Users, Add user); public sign-up is switched off.
- The Firestore security rule allows reading and writing only for signed-in accounts.
- The values in `firebase-config.js` are public identifiers, not passwords.
- "Download backup" in the "Shared database" panel saves a copy of everything in the database.