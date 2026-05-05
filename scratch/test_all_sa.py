
from auth.google_auth import get_credentials
from googleapiclient.discovery import build

def test_all_creds():
    for i in range(11, 15):
        try:
            creds = get_credentials(i)
            service = build('script', 'v1', credentials=creds, cache_discovery=False)
            print(f'Testing Account {i} create...')
            proj = service.projects().create(body={"title": f"Test {i}"}).execute()
            print(f"✅ Account {i} SUCCESS: {proj['scriptId']}")
        except Exception as e:
            print(f"❌ Account {i} FAILED: {str(e)[:100]}")

if __name__ == '__main__':
    test_all_creds()
