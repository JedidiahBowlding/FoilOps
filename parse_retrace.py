import re
import sys

def parse_file(filepath):
    try:
        with open(filepath, 'r') as f:
            content = f.read()
    except:
        return []
    
    # Each content.txt seems to be for one specific wallet based on the URL or textbox
    url_m = re.search(r'URL: https://foilops\.com/graph/(\w+)', content)
    target_wallet = url_m.group(1) if url_m else "Unknown"
    
    # Find terminalWallets blocks - they seem to be in a list or paragraph
    # Example: "address": "...", "reason": "...", "path": ["..."]
    
    results = []
    
    # Extract terminalWallets
    tw_matches = re.findall(r'"address":\s*"([^"]+)",\s*"reason":\s*"([^"]+)",\s*"path":\s*\[([^\]]*)\]', content)
    linked = []
    for addr, reason, path_str in tw_matches:
        path = [p.strip().strip('"') for p in path_str.split(',') if p.strip()]
        linked.append({'address': addr, 'reason': f"Terminal: {reason}", 'path': path})
    
    # Extract steps
    # "steps": [ { "from": "...", "to": "...", ... } ]
    step_matches = re.findall(r'"from":\s*"([^"]+)",\s*"to":\s*"([^"]+)"', content)
    from_counts = {}
    to_counts = {}
    for f_addr, t_addr in step_matches:
        from_counts[f_addr] = from_counts.get(f_addr, 0) + 1
        to_counts[t_addr] = to_counts.get(t_addr, 0) + 1
    
    high_freq = [addr for addr, count in from_counts.items() if count > 2]
    high_freq += [addr for addr, count in to_counts.items() if count > 2 and addr not in high_freq]
    
    if linked or high_freq or target_wallet != "Unknown":
        results.append({
            'wallet': target_wallet,
            'linked': linked,
            'high_freq_steps': high_freq
        })
    return results

files = [
    "/Users/blockdev/Library/Application Support/Code/User/workspaceStorage/68b33a59d36d4a01f1d23f9658d81061/GitHub.copilot-chat/chat-session-resources/c5a4f169-9364-40da-a454-6f5bf7f34a33/call_5owqwWkMqpMxQnAVTO0jx958__vscode-1777144891537/content.txt",
    "/Users/blockdev/Library/Application Support/Code/User/workspaceStorage/68b33a59d36d4a01f1d23f9658d81061/GitHub.copilot-chat/chat-session-resources/c5a4f169-9364-40da-a454-6f5bf7f34a33/call_87NA3ZEtjXSgJrM7KHx9boUS__vscode-1777144891538/content.txt",
    "/Users/blockdev/Library/Application Support/Code/User/workspaceStorage/68b33a59d36d4a01f1d23f9658d81061/GitHub.copilot-chat/chat-session-resources/c5a4f169-9364-40da-a454-6f5bf7f34a33/call_Bt2dcjjSu30z08B1Cultrrez__vscode-1777144891539/content.txt"
]

print("| Wallet | Linked-Main-Wallets | Evidence Snippets |")
print("|---|---|---|")
for f in files:
    data = parse_file(f)
    for item in data:
        wallet = item['wallet']
        linked_addrs = [l['address'] for l in item['linked']]
        for l in item['linked']:
            for p in l['path']:
                if p not in linked_addrs: linked_addrs.append(p)
        
        unique_linked = list(set(linked_addrs + item['high_freq_steps']))
        evidence = [f"{l['address'][:8]} ({l['reason']})" for l in item['linked']]
        if item['high_freq_steps']:
            evidence.append(f"High freq: {', '.join([a[:8] for a in item['high_freq_steps']])}")
            
        print(f"| {wallet} | {', '.join(unique_linked)} | {'; '.join(evidence)} |")
