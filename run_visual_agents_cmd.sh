#!/bin/bash
TMUX_BIN="/c/msys64/usr/bin/tmux"

# Create first pane and send the exact path to claude.cmd
$TMUX_BIN split-window -h
$TMUX_BIN send-keys "C:/Users/user/AppData/Roaming/npm/claude.cmd -p 'Ти @system-architect. Обовʼязково використай інструмент Read, щоб прочитати D:\Project\FightCraft\app.js, і напиши короткий звіт про його архітектуру.'" Enter

# Create second pane for security
$TMUX_BIN split-window -v
$TMUX_BIN send-keys "C:/Users/user/AppData/Roaming/npm/claude.cmd -p 'Ти @security-reviewer. Обовʼязково використай інструмент Read, щоб прочитати D:\Project\FightCraft\firestore.rules, і вкажи на знайдені вразливості.'" Enter

# Balance
$TMUX_BIN select-layout tiled
