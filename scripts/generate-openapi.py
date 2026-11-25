"""从应用导出接口契约；不连接数据库，不读取 Secret。"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.core.config import Settings  # noqa: E402
from app.main import create_app  # noqa: E402

app = create_app(Settings(_env_file=None))
target = ROOT / "docs" / "openapi.json"
target.write_text(json.dumps(app.openapi(), ensure_ascii=False, indent=2) + "\n")
print("已生成 docs/openapi.json")
