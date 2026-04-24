#!/bin/bash
sed -i -e '/const MAX_RENDER_DIST = 50000;/,/return dist <= MAX_RENDER_DIST;/c\    const isAdmin = gameState.player.role === "admin";\
    const playerPos = gameState.player.position;\
    const playerPoint = turf.point([playerPos.lng, playerPos.lat]);\
\
    const monstersToShow = staticMonsters.filter(m => {\
        if (isAdmin) return true;\
        if (!m.lng || !m.lat) return false;\
        const mPoint = turf.point([m.lng, m.lat]);\
        const distance = turf.distance(playerPoint, mPoint, { units: "kilometers" });\
        return distance <= 100;\
    });' www/map/map.js
