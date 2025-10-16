@echo off
git fetch
git pull
cd ygg-chat
call npm i
call npm run build:server
call npm run build:client
start http://localhost:5173/
call npm run migrate
call npm run dev