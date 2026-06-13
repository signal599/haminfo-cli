#!/bin/bash
git pull
pnpm run build
chmod +x dist/index.js
