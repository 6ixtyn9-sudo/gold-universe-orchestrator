
from google_auth_oauthlib.flow import InstalledAppFlow
import json

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
    # The code challenge is usually handled automatically by the flow if started with authorization_url
    # But since we are doing it manually, we might need the state or PKCE.
    # Actually, let's try the simple fetch_token first.
    code = '4/1Aci98E-amg22EozEgRZn4JfiF3yWv8AqGitXurfwtwyFp2pRk6r4GxmEhLg'
    try:
        flow.fetch_token(code=code)
        with open('token.json', 'w') as f:
            f.write(flow.credentials.to_json())
        print("SUCCESS! token.json created.")
    except Exception as e:
        print(f"Error: {e}")

if __name__ == "__main__":
    main()
