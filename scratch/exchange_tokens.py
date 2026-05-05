
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
    
    # Note: This might fail if the user's code is tied to a specific state/verifier
    # from a previous run. If it fails, I'll have to regenerate the links.
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
    # Use the codes provided by the user
    exchange_code(11, "4/1AeoWuM_MuzIcNLbVxjCWUeZ0iJWPvJJ2IpxoohAiMA61_KhDrq1I3NhvAWM", "client_secret_11.json")
    exchange_code(12, "4/1AeoWuM97YpWrjl2EP8rPNbceSxYMZRbnMjDDT4j2JZgz8-UeS6wf5W-l-nU", "client_secret_12.json")
