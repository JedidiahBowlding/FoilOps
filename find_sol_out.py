import os, json, time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

def load_dotenv(path):
    out = {}
    p = Path(path)
    if not p.exists(): return out
    for line in p.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line: continue
        k, v = line.split('=', 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out

def pick_rpc_endpoint():
    env = {}
    env.update(load_dotenv('.env'))
    env.update(load_dotenv('.env.production'))
    env.update(load_dotenv('.env.local'))
    env.update(os.environ)
    rpc = (env.get('RPC_ENDPOINT') or '').strip()
    if (not rpc) or ('REPLACE_HELIUS_API_KEY' in rpc):
        endpoints = (env.get('RPC_ENDPOINTS') or '').split(',')
        rpc = endpoints[0].strip() if endpoints else ''
    return rpc

def rpc_call(rpc_url, method, params, retries=3):
    payload = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode('utf-8')
    for i in range(retries):
        try:
            req = Request(rpc_url, data=payload, headers={'Content-Type': 'application/json'}, method='POST')
            with urlopen(req, timeout=25) as resp:
                body = json.loads(resp.read().decode('utf-8'))
            if 'error' in body: raise RuntimeError(str(body['error']))
            return body.get('result')
        except Exception as exc:
            if i == retries - 1: raise
            time.sleep(1)

def main():
    wallet = 'DWpvfqzGWuVy9jVSKSShdM2733nrEsnnhsUStYbkj6Nn'
    rpc = pick_rpc_endpoint()
    if not rpc:
        print('Error: No RPC endpoint found.')
        return
    sigs = rpc_call(rpc, 'getSignaturesForAddress', [wallet, {'limit': 20}])
    if not sigs:
        print('No recent signatures found.')
        return
    for s_info in sigs:
        sig = s_info['signature']
        tx = rpc_call(rpc, 'getTransaction', [sig, {'encoding': 'jsonParsed', 'maxSupportedTransactionVersion': 0}])
        if not tx or not tx.get('meta'): continue
        meta = tx['meta']
        keys = tx['transaction']['message']['accountKeys']
        wallet_idx = -1
        for i, acc in enumerate(keys):
            if acc.get('pubkey') == wallet:
                wallet_idx = i
                break
        if wallet_idx == -1: continue
        pre, post = meta['preBalances'][wallet_idx], meta['postBalances'][wallet_idx]
        delta = pre - post
        if delta > 1000:
            bt = tx.get('blockTime')
            utc_time = datetime.fromtimestamp(bt, tz=timezone.utc).strftime('%Y-%m-%d %H:%M:%S UTC') if bt else 'Unknown'
            print(f'Signature: {sig}')
            print(f'Time: {utc_time}')
            print(f'Wallet Delta: -{delta / 1e9:.8f} SOL')
            print(f'Fee: {meta.get("fee", 0) / 1e9:.8f} SOL')
            dests = []
            for i, (p_pre, p_post) in enumerate(zip(meta['preBalances'], meta['postBalances'])):
                if i != wallet_idx and p_post > p_pre:
                    dests.append((keys[i]['pubkey'], p_post - p_pre))
            dests.sort(key=lambda x: x[1], reverse=True)
            print('Top destinations:')
            for d_pub, d_gain in dests[:5]: print(f'  {d_pub}: +{d_gain / 1e9:.8f} SOL')
            return
    print('No outgoing SOL transactions (> 0.000001 SOL) found in the last 20 transactions.')

if __name__ == '__main__':
    main()
