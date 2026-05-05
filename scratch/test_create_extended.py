
from google.oauth2 import service_account
from googleapiclient.discovery import build

def test_create_extended():
    SCOPES = [
        'https://www.googleapis.com/auth/script.projects',
        'https://www.googleapis.com/auth/spreadsheets', 
        'https://www.googleapis.com/auth/drive',
        'https://www.googleapis.com/auth/script.external_request'
    ]
    i = 12
    try:
        creds = service_account.Credentials.from_service_account_file(
            f'credentials_{i}.json',
            scopes=SCOPES
        )
        service = build('script', 'v1', credentials=creds, cache_discovery=False)
        print(f'Testing Account {i} create with extended scopes...')
        proj = service.projects().create(body={"title": f"Test {i}"}).execute()
        print(f"✅ Account {i} SUCCESS: {proj['scriptId']}")
    except Exception as e:
        print(f"❌ Account {i} FAILED: {str(e)[:200]}")

if __name__ == '__main__':
    test_create_extended()
