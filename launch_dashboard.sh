#!/bin/bash
TMUX_BIN="/c/msys64/usr/bin/tmux"
# Гарантовано додаємо Node.js та глобальні npm-модулі до PATH
ENV_SETUP="export PATH=\"/c/Program Files/nodejs:/c/Users/user/AppData/Roaming/npm:\$PATH\""

# Панель 1: System Architect
$TMUX_BIN split-window -h
$TMUX_BIN send-keys "$ENV_SETUP" Enter
$TMUX_BIN send-keys "cd /d/Project/FightCraft" Enter
$TMUX_BIN send-keys "claude.cmd -p \"Ти @system-architect з теки .claude/agents. Негайно використай інструмент Read для швидкого аналізу архітектури www/js/app.js. Напиши 3 речення висновку.\"" Enter

# Панель 2: Security Reviewer
$TMUX_BIN split-window -v
$TMUX_BIN send-keys "$ENV_SETUP" Enter
$TMUX_BIN send-keys "cd /d/Project/FightCraft" Enter
$TMUX_BIN send-keys "claude.cmd -p \"Ти @security-reviewer з теки .claude/agents. Негайно використай інструмент Read для аналізу firestore.rules. Напиши 3 речення висновку.\"" Enter

# Повертаємось до основної панелі і ділимо її для 3-го агента
$TMUX_BIN select-pane -t 0
$TMUX_BIN split-window -v
$TMUX_BIN send-keys "$ENV_SETUP" Enter
$TMUX_BIN send-keys "cd /d/Project/FightCraft" Enter
$TMUX_BIN send-keys "claude.cmd -p \"Ти @perf-reviewer з теки .claude/agents. Негайно використай інструмент Read для аналізу продуктивності www/js/sync-engine.js. Напиши 3 речення висновку.\"" Enter

# Вирівнюємо всі 4 панелі (основна + 3 агенти) плиткою
$TMUX_BIN select-layout tiled
