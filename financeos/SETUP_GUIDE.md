# FinanceOS Setup Guide (Windows)

This guide assumes no programming experience. Every command is meant to be typed (or pasted) into **Command Prompt** and followed by the Enter key.

> **To open Command Prompt:** press the Windows key, type `cmd`, and press Enter.
> We use Command Prompt rather than PowerShell because PowerShell sometimes blocks the `npm` command.

Total time: about 20 minutes, plus downloads. Everything is free.

---

## Part 1 — Install the tools (one time)

### 1. Install Node.js
1. Go to **https://nodejs.org**.
2. Download the **LTS** version (version 22 or newer) for Windows and run the installer. Accept the defaults.
3. Close any open Command Prompt windows, open a new one, and check:
   ```
   node --version
   npm --version
   ```
   You should see version numbers such as `v24.x.x` and `11.x.x`. Node must be **22.12 or newer**.

### 2. Install Git (to download FinanceOS)
1. Go to **https://git-scm.com/download/win** and run the installer with the default options.
2. Open a new Command Prompt and check: `git --version`

---

## Part 2 — Download and start FinanceOS

### 3. Download the code
In Command Prompt:
```
cd %USERPROFILE%\Documents
git clone https://github.com/andrewtnewsome-debug/Mapsite.git
cd Mapsite
git checkout claude/financeos-build-nw1h8c
cd financeos
```
If GitHub asks you to sign in, a browser window opens; sign in with your GitHub account.

*(Alternative without Git: on GitHub, open the `claude/financeos-build-nw1h8c` branch, click **Code → Download ZIP**, unzip it into Documents, and in Command Prompt run `cd %USERPROFILE%\Documents\Mapsite-claude-financeos-build-nw1h8c\financeos` — adjust the folder name to match what was unzipped.)*

### 4. Install FinanceOS
Still inside the `financeos` folder:
```
npm install
```
This downloads the free open-source libraries FinanceOS uses (a few minutes the first time). Messages about "funding" are normal.

### 5. Start FinanceOS
```
npm run dev
```
Wait for the line `Ready`, then open your browser to:

## **http://localhost:3000**

You will see the **Demo Company** (a fictional facilities services business). Everything works with demo data before you connect anything.

**To stop FinanceOS:** click the Command Prompt window and press `Ctrl + C`.
**To start it again later:** open Command Prompt and run
```
cd %USERPROFILE%\Documents\Mapsite\financeos
npm run dev
```
Or simply double-click **`start-financeos.cmd`** inside the `financeos` folder.

*Optional, faster pages:* run `npm run build` once, then `npm start` (instead of `npm run dev`). Re-run `npm run build` after updating the code.

---

## Part 3 — Turn on the AI CFO (free, runs on your computer)

FinanceOS uses **Ollama** to run an AI model locally. No account, no API key, no per-message cost, and your financial data never leaves your computer.

1. Go to **https://ollama.com/download**, download the Windows installer, and run it. Ollama starts automatically (you'll see its icon near the clock).
2. In a **new** Command Prompt window, download the default model (about 2.5 GB):
   ```
   ollama pull qwen3:4b
   ```
3. Optional check that it works:
   ```
   ollama run qwen3:4b "Say hello in five words"
   ```
   Type `/bye` to exit.
4. Reload the **AI CFO** page in FinanceOS. The **Local AI** panel should say **Ready**.

Tips:
- A computer with 8 GB of RAM or more is recommended. A graphics card makes answers much faster but is not required.
- **About speed:** `qwen3:4b` is a "reasoning" model: it always thinks before it answers. On a computer without a graphics card, an answer can take **1 to 5 minutes** (FinanceOS shows a timer while it works). For noticeably faster answers, install the same-size model that answers directly:
  ```
  ollama pull qwen3:4b-instruct
  ```
  then choose it in **Settings → Local AI model**.
- To use a different installed model, go to **Settings → Local AI model**.
- Without Ollama, the AI CFO still answers supported questions directly from FinanceOS calculations, and tells you that full AI chat requires Ollama.

---

## Part 4 — Connect your QuickBooks Online sandbox

A **sandbox** is a free practice QuickBooks company that Intuit gives developers. It contains sample data, not your real books. FinanceOS only reads from it.

> **Never paste your Client Secret into a chat, email, or document.** It only goes into the `.env.local` file on your computer.

### 4.1 Create a free Intuit Developer account and app
1. Go to **https://developer.intuit.com** and click **Sign up** (or **Sign in** with an existing Intuit account).
2. Open your **Dashboard** and choose **Create an app** (sometimes shown as **+ Create an app** or under **My Hub → App dashboard**).
3. Choose **QuickBooks Online and Payments** (or **QuickBooks Online Accounting**), give it a name such as `FinanceOS Local`, and select the **Accounting** scope (`com.intuit.quickbooks.accounting`).
4. Intuit creates a **sandbox company** for you automatically (look under **Sandbox** in the developer dashboard; it is usually named something like *Sandbox Company_US_1*).

### 4.2 Get your development keys and set the redirect URI
1. Open your app and go to **Keys & credentials** (or **Development settings**). Make sure you are looking at the **Development / Sandbox** keys, not Production.
2. Under **Redirect URIs**, click **Add URI** and enter exactly:
   ```
   http://localhost:3000/api/auth/callback
   ```
   Click **Save**.
3. Keep this page open; you need the **Client ID** and **Client Secret** in the next step.

### 4.3 Put the keys in FinanceOS
In Command Prompt, inside the `financeos` folder:
```
copy .env.local.example .env.local
notepad .env.local
```
Notepad opens. Fill in the first two lines with your values (no quotes, no spaces):
```
INTUIT_CLIENT_ID=paste-your-development-client-id-here
INTUIT_CLIENT_SECRET=paste-your-development-client-secret-here
```
Leave the other lines as they are. Save (`Ctrl + S`) and close Notepad.

`.env.local` is ignored by Git, so it will not be uploaded anywhere.

### 4.4 Connect
1. Restart FinanceOS: in its Command Prompt window press `Ctrl + C`, then run `npm run dev` again.
2. Open **http://localhost:3000/settings** (use `localhost`, not `127.0.0.1`).
3. Click **Connect QuickBooks Sandbox**.
4. Sign in to Intuit, choose your **sandbox company**, and click **Connect** / **Authorize**.
5. You return to FinanceOS. It syncs automatically (usually under a minute) and switches to **QuickBooks Sandbox** data. The badge at the top changes from **Demo data** to **QuickBooks Sandbox**.

Use **Sync now** in Settings to refresh. Use **Disconnect** to delete the stored tokens and synced data from your computer. You can switch between the Demo Company and QuickBooks Sandbox at any time with the selector in the top bar; the two are never mixed.

---

## Troubleshooting

| Problem | Fix |
| --- | --- |
| `'node' is not recognized` | Node.js is not installed or Command Prompt was open during installation. Install Node.js, then open a **new** Command Prompt. |
| `npm.ps1 cannot be loaded because running scripts is disabled` | You are in PowerShell. Use Command Prompt (`cmd`) instead, or type `npm.cmd` instead of `npm`. |
| `npm install` fails with network errors | Check your internet connection and try again. Company VPNs or firewalls can block npm. |
| `Port 3000 is already in use` | FinanceOS (or another app) is already running. Close the other Command Prompt window, or restart your computer. |
| The page keeps reloading in development mode | Stop FinanceOS (`Ctrl + C`), run `npm run clean`, then `npm run dev`. |
| AI CFO says "Ollama is not running" | Start the Ollama app from the Start menu, wait a few seconds, reload the page. |
| AI CFO says the model is not installed | Run `ollama pull qwen3:4b` (or the model chosen in Settings). |
| AI answers are slow | Normal for `qwen3:4b` on computers without a graphics card, because it reasons before answering. Install `qwen3:4b-instruct` (`ollama pull qwen3:4b-instruct`) and select it in Settings. |
| AI answer says the model "took too long" | Increase `OLLAMA_TIMEOUT_SECONDS` in `.env.local` (e.g. `600`) or switch to `qwen3:4b-instruct`. FinanceOS shows the calculated answer instead. |
| "Keys not configured" in Settings | Check `.env.local` is in the `financeos` folder (not `.env.local.example`), has no quotes, and restart FinanceOS. |
| "The security check (OAuth state) failed or expired" | Open FinanceOS at **http://localhost:3000** (not 127.0.0.1), click Connect again, and finish within 10 minutes. |
| "Intuit rejected the app credentials" | You may have copied Production keys. Use the **Development/Sandbox** Client ID and Secret. |
| "redirect_uri is invalid" on the Intuit page | The redirect URI in your Intuit app must be exactly `http://localhost:3000/api/auth/callback`. |
| "The QuickBooks authorization has expired" | Click **Disconnect**, then **Connect QuickBooks Sandbox** again. Sandbox authorizations expire after about 100 days without use. |
| Want to start fresh | Stop FinanceOS and run `npm run reset-local-data` (deletes tokens, synced data, drafts and settings on this computer). |

## Configuration reference (`.env.local`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `INTUIT_CLIENT_ID` | (empty) | Intuit **development** client ID |
| `INTUIT_CLIENT_SECRET` | (empty) | Intuit **development** client secret |
| `INTUIT_REDIRECT_URI` | `http://localhost:3000/api/auth/callback` | Must match the URI saved in your Intuit app |
| `INTUIT_ENVIRONMENT` | `sandbox` | Only `sandbox` is allowed in this version |
| `OLLAMA_MODEL` | `qwen3:4b` | Default local model (can be overridden in Settings) |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Local Ollama address; non-local addresses are refused |
| `OLLAMA_TIMEOUT_SECONDS` | `300` | Maximum time to wait for an AI answer |
| `FINANCEOS_ENCRYPTION_KEY` | (generated) | Optional 64-hex-character key for encrypting stored tokens; otherwise generated into `.data/secret.key` |
| `FINANCEOS_DATA_DIR` | `financeos/.data` | Optional folder for local data |
| `FINANCEOS_ALLOWED_HOSTS` | (none) | Optional extra host names allowed to reach the app (advanced; leave empty) |

## What leaves your computer
- **QuickBooks:** when you connect or sync, FinanceOS talks to Intuit's sign-in and token service and the **sandbox** API.
- **Nothing else.** AI runs in Ollama on your computer. Next.js telemetry is turned off by FinanceOS's start scripts. `npm install` downloads open-source packages from the npm registry.
