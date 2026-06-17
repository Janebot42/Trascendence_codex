#!/bin/sh
set -eu

npx prisma migrate deploy
node dist/server.js
