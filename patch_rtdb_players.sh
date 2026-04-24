#!/bin/bash
sed -i -e '/onUpdate(players);/i \
        const isAdmin = gameState && gameState.player && gameState.player.role === "admin";\
        const playerPos = gameState && gameState.player ? gameState.player.position : null;\
        let filteredPlayers = players;\
        if (!isAdmin && playerPos && window.turf) {\
            const playerPoint = turf.point([playerPos.lng, playerPos.lat]);\
            filteredPlayers = players.filter(p => {\
                if (p.isSelf) return true;\
                if (!p.lng || !p.lat) return false;\
                const pPoint = turf.point([p.lng, p.lat]);\
                return turf.distance(playerPoint, pPoint, { units: "kilometers" }) <= 100;\
            });\
        }\
' www/firebase/firebase-service.js

sed -i 's/onUpdate(players);/onUpdate(filteredPlayers);/' www/firebase/firebase-service.js
