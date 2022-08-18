#!/usr/bin/env sh

# abort on errors
set -e

# build
# yarn build
cd dist

# Commit repo
git init
git add -A
git commit -m 'deploy'
git push -f git@github.com:BertrandBev/soldrive.git master:gh-pages

# Nav back
cd -