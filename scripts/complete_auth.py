
import sys
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    'https://www.googleapis.com/auth/script.projects',
    'https://www.googleapis.com/auth/drive',
    'https://www.googleapis.com/auth/spreadsheets'
]

def main():
    flow = InstalledAppFlow.from_client_secrets_file(
        'credentials.json', 
        SCOPES, 
        redirect_uri='urn:ietf:wg:oauth:2.0:oob'
    )
    
    auth_url, _ = flow.authorization_url(prompt='consent')
    
    print("\n1. CLICK THIS NEW LINK (the previous one expired or was tied to a different session):\n")
    print(auth_url)
    
    print("\n2. PASTE THE NEW CODE HERE:")
    code = input().strip()
    
    try:
        flow.fetch_token(code=code)
        with open('token.json', 'w') as f:
            f.write(flow.credentials.to_json())
        print("\nSUCCESS! token.json has been created.")
    except Exception as e:
        print(f"\nERROR: {e}")

if __name__ == "__main__":
    main()
