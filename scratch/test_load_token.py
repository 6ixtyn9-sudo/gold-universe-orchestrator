
import json
from google.oauth2.credentials import Credentials

def test_load():
    with open('creds/token_1.json', 'r') as f:
        data = json.load(f)
    print("Data keys:", data.keys())
    try:
        creds = Credentials.from_authorized_user_file('creds/token_1.json')
        print("✅ Load successful")
    except Exception as e:
        print("❌ Load failed:", e)

if __name__ == '__main__':
    test_load()
