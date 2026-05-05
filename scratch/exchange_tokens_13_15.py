
import json
from google_auth_oauthlib.flow import InstalledAppFlow

def exchange_code(slot, code, client_secret_path):
    flow = InstalledAppFlow.from_client_secrets_file(
        client_secret_path,
        scopes=[
            "https://www.googleapis.com/auth/spreadsheets",
            "https://www.googleapis.com/auth/drive",
            "https://www.googleapis.com/auth/script.projects",
            "https://www.googleapis.com/auth/script.external_request"
        ]
    )
    flow.redirect_uri = 'urn:ietf:wg:oauth:2.0:oob'
    
    try:
        flow.fetch_token(code=code)
        creds = flow.credentials
        
        token_data = {
            "token": creds.token,
            "refresh_token": creds.refresh_token,
            "token_uri": creds.token_uri,
            "client_id": creds.client_id,
            "client_secret": creds.client_secret,
            "scopes": creds.scopes,
            "universe_domain": getattr(creds, 'universe_domain', 'googleapis.com'),
            "expiry": creds.expiry.isoformat() if creds.expiry else None
        }
        
        output_path = f"creds/token_{slot}.json"
        with open(output_path, 'w') as f:
            json.dump(token_data, f, indent=2)
        print(f"✅ Token {slot} saved successfully to {output_path}")
    except Exception as e:
        print(f"❌ Failed to exchange code for slot {slot}: {e}")

if __name__ == '__main__':
    exchange_code(13, "4/1AeoWuM8rRuVIeiWre5mqbWqzM0CfbHo3sQvne4LOwtEs2Wj4bJQUscXmnfY", "client_secret_13.json")
    exchange_code(14, "4/1AeoWuM9bYFtM-isDOXhspS5Dw0a_OQqSMvLryq0jd93bNXbEdQlOUvCxFRA", "client_secret_14.json")
    exchange_code(15, "4/1AeoWuM9bTfApzchBz2jvmKEJDwJ9wiXo_aK94_mWlQF2vh8VI-A99IlLOZQ", "client_secret_15.json")
