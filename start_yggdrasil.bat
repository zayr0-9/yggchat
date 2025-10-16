@echo off
cd ygg-chat
call npm i
start http://localhost:5173/
call npm run migrate
call npm run dev