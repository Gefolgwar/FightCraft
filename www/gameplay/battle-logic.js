
export class BattleLogic {
    constructor(battleId, currentUser, role, callbacks) {
        this.battleId = battleId;
        this.currentUser = currentUser; // { uid, name }
        this.role = role; // 'player1' or 'player2' (or 'host'/'joiner')
        this.callbacks = callbacks; // { onUpdate, onRoundResult, onTimerTick }
        this.currentRound = 1;
        this.timer = null;
        this.timeLeft = 20;
    }

    /**
     * Called when UI initiates attack
     */
    async submitChoice(attackZone, defenseZone) {
        const roundAtStart = this.currentRound;

        // 1. Instant UI Feedback (Disable buttons immediately)
        this.callbacks.onWait("Waiting for opponent...");

        // Stop timer visually (logic continues until confirmed)
        if (this.timer) clearInterval(this.timer);

        const safeName = this.currentUser.name || this.currentUser.displayName || 'Unknown Hero';
        console.log(`🎮 PvP Action: ${safeName} (Role: ${this.role}) chose Attack: ${attackZone}, Defend: ${defenseZone}`);

        const choice = {
            attack: attackZone,
            defense: defenseZone,
            ready: true,
            timestamp: Date.now(),
            // Fix: handle undefined name by checking multiple sources
            playerName: safeName
        };

        // Double-check to be safe
        if (!choice.playerName) choice.playerName = 'Unknown Fighter';

        const path = `battles/${this.battleId}/rounds/${this.currentRound}/${this.role}_choice`;

        // 2. Perform Network Update
        const { updateRTDB } = await import('../firebase/firebase-service.js');
        const success = await updateRTDB(path, choice);

        if (!success) {
            console.error("Failed to submit move. Retrying might be needed.");
            // Optional: If failed, we could re-enable buttons? 
        }
    }

    /**
     * Main listener for the round node
     */
    handleRoundUpdate(roundData) {
        if (!roundData) return;

        const p1 = roundData.player1_choice;
        const p2 = roundData.player2_choice;
        const result = roundData.result;

        // Debug Log to diagnose hangs
        const p1Ready = p1?.ready ? '✅' : '❌';
        const p2Ready = p2?.ready ? '✅' : '❌';
        const hasResult = result ? '✅' : '❌';

        // Log state
        if (p1 || p2 || result) {
            console.log(`🤖 Logic Update (R${this.currentRound}): P1=${p1Ready} P2=${p2Ready} Res=${hasResult} | Role=${this.role}`);
        }

        // If result exists, round is over -> Show result & Prep next
        if (result) {
            const isGameOver = this.callbacks.onRoundResult(result);
            if (isGameOver) {
                console.log(`⚔️ PvP: Battle is over (Role: ${this.role}). Timer stopped.`);
                if (this.timer) clearInterval(this.timer);
                return;
            }
            this.currentRound++;
            this.startTimer(); // Auto-start next round timer
            return;
        }

        // If both ready but no result -> Host calculates
        if (p1?.ready && p2?.ready && !result) {
            console.log(`⚔️ PvP: Both players ready! Resolving... (Role: ${this.role})`);
            if (this.role === 'player1') { // Host Authority
                this.resolveRound(p1, p2);
            }
        } else {
            // Restore Waiting state if I already moved
            const myChoice = this.role === 'player1' ? p1 : p2;
            if (myChoice?.ready && !result) {
                this.callbacks.onWait("Waiting for opponent...");
            }

            // Log individual readiness
            if (p1?.ready && this.role !== 'player1') console.log(`⚔️ PvP: Player 1 is Ready.`);
            if (p2?.ready && this.role !== 'player2') console.log(`⚔️ PvP: Player 2 is Ready.`);
        }
    }

    async resolveRound(p1, p2) {
        // Import calculation logic from combat.js (or reuse shared function if extracted)
        // Since calculateDamage is not exported or complex to import circularly, 
        // we will implement a simplified robust version here or move it to a shared helper.
        // Better: We should export calculateDamage from combat.js.
        // Assuming it IS exported (I checked combat.js earlier, it wasn't exported but I can add export or copy logic).

        // Let's implement a robust standalone calc here to avoid circular dependency issues for now.
        // We need stats.
        // P1 Stats = this.currentUser (if Host is P1) ?? No, this.currentUser is ME.
        // If I am Host (P1), I have my stats. But I don't have P2 stats easily unless they sent them.

        // FIX: StartPvPCombat saves stats to gameState.combat.monster (Enemy).
        // So P1 has P2 stats in 'gameState.combat.monster'.
        // P1 has own stats in 'recalculateStats()'.

        try {
            const { gameState, recalculateStats } = await import('../core/gameState.js');

            // Host is ALWAYS Player 1
            const p1Stats = recalculateStats();
            const p2Stats = gameState.combat ? gameState.combat.monster : { damage: 5, defense: 0, hp: 100 };

            // Helper for Calc
            const calc = (attacker, defender, attackZone, defenseZones) => {
                let hitChance = attacker.hitChance || 80;
                let damage = Math.max(1, (attacker.derivedDamage || attacker.damage || 5) - (defender.defense || 0));

                // Crit
                const isCrit = Math.random() * 100 < (attacker.critChance || 5);
                if (isCrit) damage *= 2;

                // Block
                let blocked = false;
                if (defenseZones && defenseZones.includes(attackZone)) {
                    damage = Math.floor(damage * 0.5);
                    blocked = true;
                }

                return { damage, isCrit, blocked };
            };

            // P1 attacks P2
            const r1 = calc(p1Stats, p2Stats, p1.attack, p2.defense);

            // P2 attacks P1
            const r2 = calc(p2Stats, p1Stats, p2.attack, p1.defense);

            const result = {
                round: this.currentRound,
                p1_damage: r1.damage,
                p2_damage: r2.damage,
                p1_crit: r1.isCrit,
                p2_crit: r2.isCrit,
                p1_blocked: r1.blocked,
                p2_blocked: r2.blocked,
                timestamp: Date.now()
            };

            const path = `battles/${this.battleId}/rounds/${this.currentRound}/result`;
            const { updateRTDB } = await import('../firebase/firebase-service.js');
            await updateRTDB(path, result);
        } catch (e) {
            console.error("❌ PvP Resolve Error:", e);
        }
    }

    startTimer() {
        if (this.timer) clearInterval(this.timer);
        this.timeLeft = 20;
        this.callbacks.onTimerTick(this.timeLeft);

        this.timer = setInterval(() => {
            this.timeLeft--;
            this.callbacks.onTimerTick(this.timeLeft);
            if (this.timeLeft <= 0) {
                clearInterval(this.timer);
                this.forceRandomMove();
            }
        }, 1000);
    }

    async forceRandomMove() {
        // If haven't moved, pick random
        const zones = ['head', 'body', 'belt', 'legs'];
        const randomAtt = zones[Math.floor(Math.random() * 4)];
        const randomDef = zones[Math.floor(Math.random() * 4)];
        await this.submitChoice(randomAtt, randomDef);
    }
}
