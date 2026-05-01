#!/bin/bash
cd ~/Desktop/gold-universe-orchestrator || exit 1
if [ ! -d ".git" ]; then git init; fi
git remote set-url origin https://github.com/6ixtyn9-sudo/gold-universe-orchestrator.git 2>/dev/null || git remote add origin https://github.com/6ixtyn9-sudo/gold-universe-orchestrator.git
git checkout -b main 2>/dev/null || git checkout main 2>/dev/null
git add -A
git status --short
git commit -m "Gold Universe Orchestrator update"
git push -u origin main
