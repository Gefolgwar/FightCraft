export class SeededRandom {
    constructor(seed) {
        this.seed = seed != null ? seed : Math.floor(Math.random() * 2147483647);
    }
    next() {
        let t = this.seed += 0x6D2B79F5;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }
    range(min, max) {
        return min + this.next() * (max - min);
    }
    rangeInt(min, max) {
        return Math.floor(this.range(min, max + 1));
    }
    pick(array) {
        if (!array || array.length === 0) return null;
        return array[this.rangeInt(0, array.length - 1)];
    }
    shuffle(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = this.rangeInt(0, i);
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
    generateId(length = 7) {
        let result = '';
        const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < length; i++) {
            result += characters.charAt(this.rangeInt(0, characters.length - 1));
        }
        return result;
    }
}
