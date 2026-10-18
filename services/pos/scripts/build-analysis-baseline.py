"""2025/data/day12.json から分析用の非個人データだけを抽出。
Usage: python3 scripts/build-analysis-baseline.py /path/to/sohosai-analysis
注文コメント・指名・名前・Firestore IDは出力しない。
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

repo = Path(sys.argv[1])
source = repo / '2025/data/day12.json'
raw = source.read_bytes()
orders = json.loads(raw)['orders']
output = {
    'source': 'https://github.com/cafeore-tkb/sohosai-analysis/blob/main/2025/data/day12.json',
    'commit': subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip(),
    'sha256': hashlib.sha256(raw).hexdigest(),
    'orders': [[o['orderId'], o['createdAt'], o.get('readyAt'), o.get('servedAt'), o['billingAmount'],
                [[i['name'], i['type']] for i in o['items']]] for o in orders],
}
target = Path(__file__).resolve().parents[1] / 'app/lib/analytics/data/baseline-2025.json'
target.write_text(json.dumps(output, ensure_ascii=False, separators=(',', ':')) + '\n')
print(f'{len(orders)} orders -> {target}')
