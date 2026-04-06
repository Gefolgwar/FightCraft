#!/bin/bash
TMUX_BIN="C:/msys64/usr/bin/tmux.exe"
CLAUDE_BIN="/c/Users/user/AppData/Roaming/npm/claude.cmd"

# Експортуємо змінні оточення
ENV_VARS="export ANTHROPIC_BASE_URL=\"http://localhost:8080\" && export ANTHROPIC_API_KEY=\"sk-ant-antigravity-pool\""

# Права панель для Security
$TMUX_BIN split-window -h "bash -c \"$ENV_VARS && \\\"$CLAUDE_BIN\\\" --model gemini-3.1-pro-high --teammate-mode tmux -p 'Ти Security Reviewer. Знайди критичну вразливість (isAdmin) у firestore.rules та відкрий файл, щоб виправити її. Пиши українською.'; echo '--- Агент завершив роботу ---'; read -p 'Натисни Enter...'\""

# Права нижня панель для Coder
$TMUX_BIN split-window -v "bash -c \"$ENV_VARS && \\\"$CLAUDE_BIN\\\" --model gemini-3.1-pro-high --teammate-mode tmux -p 'Ти Fullstack Coder. Знайди витік пам\'яті у combat.js (_cleanupCombatState). Виправ це. Пиши українською.'; echo '--- Агент завершив роботу ---'; read -p 'Натисни Enter...'\""

$TMUX_BIN select-layout tiled
