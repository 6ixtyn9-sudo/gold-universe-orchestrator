# Parallel Deployment Setup Guide

To deploy all 501 satellites in one day, we need to bypass Google's "50 project creations per day" limit. We do this by spreading the load across **10 different Google Cloud Projects**.

### Time Required: ~15 minutes (One-time setup)

---

## 1. Create the Projects
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Create **9 new projects** (you already have 1).
   - Suggested names: `ma-golide-deploy-1`, `ma-golide-deploy-2`, ..., `ma-golide-deploy-9`.
3. For **EACH** project:
   - Go to **APIs & Services > Library**.
   - Search for **"Google Apps Script API"** and click **Enable**.
   - Go to **APIs & Services > Credentials**.
   - Click **Create Credentials > OAuth client ID**.
   - Select **Application type: Desktop app**.
   - Name it (e.g., `Deployer 1`).
   - Click **Download JSON** and save it as `credentials_1.json`, `credentials_2.json`, etc., to your **Desktop**.

---

## 2. Prepare the Workspace
1. Create the `creds` folder in the repo root:
   ```bash
   mkdir -p creds
   ```
2. Move your existing `personal_token.json` to the new folder:
   ```bash
   cp personal_token.json creds/token_0.json
   ```
3. Move all the downloaded `credentials_N.json` files to the repo root.

---

## 3. Authorize All Projects
Run the mass-auth script:
```bash
python3 scripts/auth_all_projects.py
```
- This will open your browser for each project one by one.
- Log in and approve each.
- It will save `token_1.json` through `token_9.json` in the `creds/` folder.

---

## 4. Run the Parallel Deploy
Once all tokens are in `creds/`, run the deployer:

```bash
# Verify the plan first
python3 scripts/deploy_parallel.py --dry-run

# Run for real
python3 scripts/deploy_parallel.py
```

### Performance
- **Threads**: 10 (one per project)
- **Speed**: ~50 satellites per thread
- **Total Time**: ~7-10 minutes for all 501 satellites.
