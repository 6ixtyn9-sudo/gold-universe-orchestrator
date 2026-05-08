import json

with open("sheet_to_token_map.json") as f:
    data = json.load(f)

for k in data["map"].keys():
    data["map"][k] = "creds/token_1.json"

with open("sheet_to_token_map.json", "w") as f:
    json.dump(data, f, indent=2)

print("Fixed sheet_to_token_map.json to use token_1.json")
