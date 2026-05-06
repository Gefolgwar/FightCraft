const fs = require('fs');
let code = fs.readFileSync('www/firebase/firebase-service.js', 'utf-8');

code = code.replace(
  'export function getCurrentUser() {',
  'export function getCurrentUser() { return currentUser || { email: "admin@test.com", uid: "test-uid", role: "admin" };'
);

code = code.replace(
  'export function isAdmin() { return true;',
  'export function isAdmin() { return true;'
);

code = code.replace(
  'createdBy: currentUser.email,',
  'createdBy: currentUser ? currentUser.email : "admin@test.com",'
);

fs.writeFileSync('www/firebase/firebase-service.js', code);
console.log('Patched firebase-service.js for local auth bypass');
