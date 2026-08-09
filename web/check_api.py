import json

with open("openapi2.json", encoding="utf-16") as f:
    data = json.load(f)

paths = data.get("paths", {})
for p, ops in paths.items():
    if "memories" in p:
        print(f"{p}: {list(ops.keys())}")
