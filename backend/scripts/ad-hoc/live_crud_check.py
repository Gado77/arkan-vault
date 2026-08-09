import httpx
import sys

BASE_URL = "https://arkan-server.tail9b08be.ts.net/api/v1"

def run_check():
    print(f"Verificando Arkan Vault em {BASE_URL}...")
    
    with httpx.Client(verify=False, timeout=60.0) as client:
        # 1. Create
        print("\n1. Criando memoria (POST)...")
        payload = {
            "title": "CRUD Check",
            "content": "Conteúdo original",
            "project": "hermes-test",
            "tags": ["teste", "live-check"],
            "context": {"source": "live_crud_check.py"}
        }
        resp = client.post(f"{BASE_URL}/memories", json=payload)
        if resp.status_code != 201:
            print(f"[FAIL] Falha ao criar: {resp.status_code} {resp.text}")
            sys.exit(1)
        mem_id = resp.json()["id"]
        print(f"[OK] Criado com sucesso: {mem_id}")
        
        # 2. Read
        print("\n2. Lendo memoria (GET)...")
        resp = client.get(f"{BASE_URL}/memories/{mem_id}")
        if resp.status_code != 200:
            print(f"[FAIL] Falha ao ler: {resp.status_code} {resp.text}")
            sys.exit(1)
        print("[OK] Leitura bem sucedida")
        
        # 3. Update (PUT)
        print("\n3. Atualizando memoria (PUT)...")
        put_payload = {"title": "CRUD Check - Updated PUT"}
        resp = client.put(f"{BASE_URL}/memories/{mem_id}", json=put_payload)
        if resp.status_code != 200:
            print(f"[FAIL] Falha no PUT: {resp.status_code} {resp.text}")
            sys.exit(1)
        if resp.json()["title"] != "CRUD Check - Updated PUT" or resp.json()["content"] != "Conteúdo original":
            print(f"[FAIL] PUT falhou na semântica parcial.")
            sys.exit(1)
        print("[OK] PUT bem sucedido")
        
        # 4. Update (PATCH)
        print("\n4. Atualizando memoria (PATCH)...")
        patch_payload = {"title": "CRUD Check - Updated PATCH"}
        resp = client.patch(f"{BASE_URL}/memories/{mem_id}", json=patch_payload)
        if resp.status_code != 200:
            print(f"[FAIL] Falha no PATCH: {resp.status_code} {resp.text}")
            sys.exit(1)
        if resp.json()["title"] != "CRUD Check - Updated PATCH" or resp.json()["content"] != "Conteúdo original":
            print(f"[FAIL] PATCH falhou na semântica parcial.")
            sys.exit(1)
        print("[OK] PATCH bem sucedido")
        
        # 5. Delete
        print("\n5. Deletando memoria (DELETE)...")
        resp = client.delete(f"{BASE_URL}/memories/{mem_id}")
        if resp.status_code != 204:
            print(f"[FAIL] Falha no DELETE: {resp.status_code} {resp.text}")
            sys.exit(1)
        print("[OK] DELETE bem sucedido")
        
        # 6. Verify Delete
        resp = client.get(f"{BASE_URL}/memories/{mem_id}")
        if resp.status_code != 404:
            print(f"[FAIL] Memória não foi deletada! HTTP {resp.status_code}")
            sys.exit(1)
        print("[OK] Verificação final bem sucedida. O Contrato CRUD está perfeito e funcional!")

if __name__ == "__main__":
    run_check()
