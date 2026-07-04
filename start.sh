#!/bin/zsh
export PATH="$HOME/node-local/bin:$PATH"
cd "$(dirname "$0")"
DATABASE_URL="file:./prisma/dev.db" node node_modules/next/dist/bin/next dev
