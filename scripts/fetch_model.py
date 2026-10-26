#!/usr/bin/env python3
"""从 isHarryh/Ark-Models 下载基建 Q 版模型，放进 assets/models/<key>/ 并统一命名为 model.*

用法：python3 scripts/fetch_model.py <key> <模型编号> [<key> <模型编号> ...]
例如：python3 scripts/fetch_model.py haruka 4202_haruka makoto_p3r '4217_makoto_p3r#1'
模型编号见 https://github.com/isHarryh/Ark-Models 的 models_data.json（Operator 类型、build_char_* 的那些）。
Ark-Models 还没收录的新时装，可以用 gh:<owner>/<repo>/<目录> 指定其他仓库里的模型文件夹，例如
  gh:HellaOrg/HellaAssets/spine/operator/build/build_char_2025_shu_nlc#1
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


def get(url, tries=4, accept=None):
    for i in range(tries):
        try:
            headers = {"User-Agent": "dusk-pet"}
            if accept:
                headers["Accept"] = accept
            # 未登录的 GitHub API 每小时只有 60 次；有令牌就带上（例如 GH_TOKEN=$(gh auth token)）
            token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
            if token and url.startswith("https://api.github.com/"):
                headers["Authorization"] = f"Bearer {token}"
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except Exception as e:  # 网络偶尔会断，重试
            if i == tries - 1:
                raise
            print(f"  重试 {os.path.basename(url)}：{e}")
            time.sleep(2 * (i + 1))


def fetch(key, model_id):
    if model_id.startswith("gh:"):  # 其他仓库：gh:<owner>/<repo>/<目录>
        owner, repo, folder = model_id[3:].split("/", 2)
        listing = f"https://api.github.com/repos/{owner}/{repo}/contents/{urllib.parse.quote(folder)}"
    else:
        listing = f"{API}/{urllib.parse.quote(model_id)}"
    files = [f for f in json.loads(get(listing)) if f["name"].rsplit(".", 1)[-1] in ("atlas", "png", "skel")]
    names = [f["name"] for f in files]
    if not any(n.endswith(".skel") for n in names):
        sys.exit(f"{model_id} 里没有 .skel 文件（只支持二进制骨骼），找到的是：{names}")
    out = os.path.join(ROOT, key)
    os.makedirs(out, exist_ok=True)
    for f in files:
        try:
            data = get(f["download_url"], tries=2)
        except Exception:  # raw.githubusercontent.com 有时连不上，改走 API 取原始内容
            print(f"  改用 GitHub API 下载 {f['name']}")
            data = get(f["url"], accept="application/vnd.github.raw")
        with open(os.path.join(out, f["name"]), "wb") as fh:
            fh.write(data)

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
