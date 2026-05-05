
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/script.projects",
    "https://www.googleapis.com/auth/script.external_request"
]

def generate_auth_url(client_secret_path):
    flow = InstalledAppFlow.from_client_secrets_file(client_secret_path, SCOPES)
    flow.redirect_uri = 'urn:ietf:wg:oauth:2.0:oob' # Out of band for CLI
    auth_url, _ = flow.authorization_url(prompt='consent')
    return auth_url

print("--- AUTH FOR SLOT 11 ---")
print(generate_auth_url('client_secret_11.json'))
print("\n--- AUTH FOR SLOT 12 ---")
print(generate_auth_url('client_secret_12.json'))
