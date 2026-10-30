"""sohosai-analysis の在庫切れの見込みの当てた値(T-93)を、ダッシュボード用に同梱する。
Usage: python3 scripts/build-stockout-params.py /path/to/sohosai-analysis
当てた値(単位ごとの α・r̄・品名の対応表)と、テストの正解の表を分けて書く。注文の行は元の JSON にも無い。
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

repo = Path(sys.argv[1])
relative = '2025/nisui/cafeore_analysis/python/export/stockout_params_2026.json'
source = repo / relative
raw = source.read_bytes()
data = json.loads(raw)
if data.get('schema_version') != 1:
    sys.exit(f"schema_version {data.get('schema_version')} は読めません")
checks = data.pop('checks')
provenance = {
    'source': f'https://github.com/cafeore-tkb/sohosai-analysis/blob/main/{relative}',
    'commit': subprocess.check_output(['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip(),
    'sha256': hashlib.sha256(raw).hexdigest(),
}
target = Path(__file__).resolve().parents[1] / 'app/lib/analytics/data'
(target / 'stockout-params-2026.json').write_text(
    json.dumps({**provenance, **data}, ensure_ascii=False, separators=(',', ':')) + '\n')
(target / 'stockout-checks-2026.json').write_text(
    json.dumps({**provenance, **checks}, ensure_ascii=False, separators=(',', ':')) + '\n')
print(f"{len(data['units'])} units, {len(checks['nb'])} + {len(checks['forecast'])} checks -> {target}")
