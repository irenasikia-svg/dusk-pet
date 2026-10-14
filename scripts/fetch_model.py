#!/usr/bin/env python3
"""从 isHarryh/Ark-Models 下载基建 Q 版模型，放进 assets/models/<key>/ 并统一命名为 model.*

用法：python3 scripts/fetch_model.py <key> <模型编号> [<key> <模型编号> ...]
例如：python3 scripts/fetch_model.py haruka 4202_haruka makoto_p3r '4217_makoto_p3r#1'
模型编号见 https://github.com/isHarryh/Ark-Models 的 models_data.json（Operator 类型、build_char_* 的那些）。
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

REPO = "isHarryh/Ark-Models"
RAW = f"https://raw.githubusercontent.com/{REPO}/main/models"
API = f"https://api.github.com/repos/{REPO}/contents/models"
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "models")


def get(url, tries=4):
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "dusk-pet"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:  # 网络偶尔会断，重试
            if i == tries - 1:
                raise
            print(f"  重试 {os.path.basename(url)}：{e}")
            time.sleep(2 * (i + 1))


def fetch(key, model_id):
    enc = urllib.parse.quote(model_id)
    names = [f["name"] for f in json.loads(get(f"{API}/{enc}"))]
    out = os.path.join(ROOT, key)
    os.makedirs(out, exist_ok=True)
    for n in names:
        with open(os.path.join(out, n), "wb") as f:
            f.write(get(f"{RAW}/{enc}/{urllib.parse.quote(n)}"))

    # 文件名里的 # 会被 file:// 当成锚点，统一改名；atlas 里引用的贴图名同步改掉
    atlas = next(n for n in names if n.endswith(".atlas"))
    skel = next(n for n in names if n.endswith(".skel"))
    with open(os.path.join(out, atlas), encoding="utf8") as f:
        lines = f.read().split("\n")
    pages = [l.strip() for l in lines if l.strip().endswith(".png")]
    rename = {p: ("model.png" if i == 0 else f"model_{i + 1}.png") for i, p in enumerate(pages)}
    for old, new in rename.items():
        os.replace(os.path.join(out, old), os.path.join(out, new))
    os.replace(os.path.join(out, skel), os.path.join(out, "model.skel"))
    os.remove(os.path.join(out, atlas))
    with open(os.path.join(out, "model.atlas"), "w", encoding="utf8") as f:
        f.write("\n".join(rename.get(l.strip(), l) for l in lines))

    size = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out))
    print(f"✓ {key:<20} ← {model_id}  {size // 1024} KB  {sorted(os.listdir(out))}")


if __name__ == "__main__":
    args = sys.argv[1:]
    if not args or len(args) % 2:
        sys.exit(__doc__)
    for k, m in zip(args[::2], args[1::2]):
        fetch(k, m)
