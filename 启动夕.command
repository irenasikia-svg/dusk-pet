#!/bin/zsh
# 双击启动夕（Claude 桌宠）
cd "$(dirname "$0")"
if [ ! -d node_modules/electron/dist ]; then
  npm install --no-audit --no-fund && node node_modules/electron/install.js
fi
open -n node_modules/electron/dist/Electron.app --args "$PWD"
