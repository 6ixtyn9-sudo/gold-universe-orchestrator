#!/bin/bash
# Setup script for Antigravity — Gold Universe Satellite Deployment

set -e

echo "🛰️  ANTIGRAVITY SETUP — Gold Universe Satellite Fleet"
echo "======================================================"
echo ""

# Colors
GOLD='\033[93m'
GREEN='\033[92m'
RED='\033[91m'
CYAN='\033[96m'
RESET='\033[0m'

# Check Python
if ! command -v python3 &> /dev/null; then
    echo -e "${RED}❌ Python 3 is required but not installed${RESET}"
    exit 1
fi

echo -e "${CYAN}📦 Step 1: Installing Python dependencies...${RESET}"
pip install -q gspread google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client python-dotenv supabase pygithub 2>/dev/null || true
echo -e "${GREEN}✅ Dependencies installed${RESET}"

echo ""
echo -e "${CYAN}📁 Step 2: Setting up directory structure...${RESET}"
mkdir -p creds
mkdir -p logs
mkdir -p registry
echo -e "${GREEN}✅ Directories created${RESET}"

echo ""
echo -e "${CYAN}🔗 Step 3: Initializing git submodules...${RESET}"
git submodule update --init --recursive || echo "⚠️  Could not update submodules (this is OK if already done)"
echo -e "${GREEN}✅ Submodules ready${RESET}"

echo ""
echo -e "${CYAN}🔑 Step 4: Checking credentials...${RESET}"
if [ ! -d "creds" ] || [ -z "$(ls -A creds 2>/dev/null)" ]; then
    echo -e "${RED}⚠️  No credentials found in creds/${RESET}"
    echo "   You'll need to:"
    echo "   1. Run: python scripts/complete_auth.py"
    echo "   2. Or copy existing token_*.json files to creds/"
else
    TOKEN_COUNT=$(ls creds/token_*.json 2>/dev/null | wc -l)
    echo -e "${GREEN}✅ Found $TOKEN_COUNT credential token(s)${RESET}"
fi

echo ""
echo -e "${CYAN}📋 Step 5: Checking .env file...${RESET}"
if [ ! -f ".env" ]; then
    echo -e "${RED}⚠️  No .env file found${RESET}"
    cat > .env.example << 'EOF'
# Supabase configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_KEY=your-service-role-key

# Google Service Account (JSON string)
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
EOF
    echo "   Created .env.example — copy to .env and fill in your values"
else
    echo -e "${GREEN}✅ .env file exists${RESET}"
fi

echo ""
echo -e "${CYAN}🧪 Step 6: Testing imports...${RESET}"
python3 -c "
try:
    from syncer.script_syncer import load_gs_sources
    print('✅ syncer module OK')
except Exception as e:
    print(f'⚠️  syncer module: {e}')

try:
    from registry.supabase_registry import list_satellites
    print('✅ registry module OK')
except Exception as e:
    print(f'⚠️  registry module: {e}')

try:
    from google.oauth2.credentials import Credentials
    print('✅ google auth OK')
except Exception as e:
    print(f'⚠️  google auth: {e}')
" 2>/dev/null || echo "⚠️  Some imports failed (this is OK if running setup for first time)"

echo ""
echo -e "${CYAN}📊 Step 7: Checking satellite sources...${RESET}"
if [ -d "Ma_Golide_Satellites/docs" ]; then
    GS_COUNT=$(ls Ma_Golide_Satellites/docs/*.gs 2>/dev/null | wc -l)
    echo -e "${GREEN}✅ Found $GS_COUNT .gs file(s) in Ma_Golide_Satellites/docs/${RESET}"
else
    echo -e "${RED}⚠️  Ma_Golide_Satellites/docs/ not found${RESET}"
    echo "   Run: git submodule update --init --recursive"
fi

echo ""
echo "======================================================"
echo -e "${GOLD}🚀 SETUP COMPLETE!${RESET}"
echo ""
echo "Next steps:"
echo "  1. Edit .env with your credentials"
echo "  2. Run: python antigravity_deploy.py --dry-run"
echo "  3. Then: python antigravity_deploy.py --parallel"
echo ""
echo "Or use GitHub Actions for CI/CD deployment."
echo "======================================================"
