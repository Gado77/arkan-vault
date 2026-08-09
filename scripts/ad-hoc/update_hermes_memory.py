import httpx
import sys

BASE_URL = "https://arkan-server.tail9b08be.ts.net/api/v1"

def update_memory():
    mem_id = "mem_0c582b514f1142d08b4c992906b06048"
    
    with httpx.Client(verify=False, timeout=60.0) as client:
        resp = client.get(f"{BASE_URL}/memories/{mem_id}")
        if resp.status_code == 404:
            print("Memory not found. Cannot update.")
        elif resp.status_code == 200:
            data = resp.json()
            old_content = data.get("content", "")
            if "PATCH endpoint" not in old_content:
                new_content = old_content + "\n\n## API Updates\n- Stabilized REST CRUD Contract for MemoryObjects.\n- Added PATCH endpoint to `/api/v1/memories/{id}` (same semantics as PUT for partial updates).\n- Enhanced memory API with robust event publishing (MemoryCreated, MemoryUpdated, MemoryDeleted) for downstream processing."
                patch_payload = {"content": new_content}
                patch_resp = client.patch(f"{BASE_URL}/memories/{mem_id}", json=patch_payload)
                if patch_resp.status_code == 200:
                    print("Memory updated successfully.")
                else:
                    print(f"Failed to update memory: {patch_resp.text}")
            else:
                print("Memory already up to date.")
        else:
            print(f"Error fetching memory: {resp.status_code} {resp.text}")

if __name__ == "__main__":
    update_memory()
