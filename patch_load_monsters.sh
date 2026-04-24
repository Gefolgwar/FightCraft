#!/bin/bash
sed -i -e '/setStaticMonsters(monsters);/i \
                const isAdmin = window.gameState && window.gameState.player && window.gameState.player.role === "admin";\
                const playerPos = window.gameState && window.gameState.player ? window.gameState.player.position : null;\
                let filteredMonsters = monsters;\
                if (!isAdmin && playerPos && window.turf) {\
                    const playerPoint = turf.point([playerPos.lng, playerPos.lat]);\
                    filteredMonsters = monsters.filter(m => {\
                        if (!m.lng || !m.lat) return false;\
                        const mPoint = turf.point([m.lng, m.lat]);\
                        return turf.distance(playerPoint, mPoint, { units: "kilometers" }) <= 100;\
                    });\
                }\
' www/gameplay/monsters.js

sed -i 's/setStaticMonsters(monsters);/setStaticMonsters(filteredMonsters);/' www/gameplay/monsters.js
sed -i 's/return monsters;/return filteredMonsters;/' www/gameplay/monsters.js
