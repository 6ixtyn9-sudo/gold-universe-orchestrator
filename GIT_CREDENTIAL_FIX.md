# Git Credential Fix for 6ixtyn9-sudo

## The Issue
The system was incorrectly attempting to use the `CCBBetBot` SSH key, which is suspended. This resulted in "Account Suspended" errors even though the primary account `6ixtyn9-sudo` is active.

## The Fix

### 1. GitHub Personal Access Token (PAT)
- Go to [GitHub Tokens Settings](https://github.com/settings/tokens/new).
- Select `repo` and `workflow` scopes.
- Generate and copy the token.

### 2. Configure Local Repository
Run these commands in the terminal at the repo root:

```bash
# Switch main remote to HTTPS
git remote set-url origin https://6ixtyn9-sudo@github.com/6ixtyn9-sudo/gold-universe-orchestrator.git

# Switch submodules to HTTPS
git -C Ma_Golide_Satellites remote set-url origin https://6ixtyn9-sudo@github.com/6ixtyn9-sudo/Ma_Golide_Satellites.git
git -C Ma_Assayer remote set-url origin https://6ixtyn9-sudo@github.com/6ixtyn9-sudo/Ma_Assayer.git

# Store credentials in the macOS keychain
git config --global credential.helper osxkeychain

# Force HTTPS for all github.com URLs (prevents accidental SSH usage)
git config --global url."https://github.com/".insteadOf "git@github.com:"
```

### 3. Push Changes
Run the push command:
```bash
git push origin main
```
When prompted for a password, **paste your GitHub Personal Access Token**.

### 4. Cline References Removed
The `.clinerules` file has been deleted as it contained non-interactive git overrides that were blocking credential prompts.
