/*
 * Connects the app to the church's Firebase project (shared online database).
 * These values are public identifiers, not passwords: every Firebase website shows
 * them to its visitors. The data is protected by the sign-in and by the Firestore
 * security rules (only signed-in accounts can read or write).
 * Delete this file to go back to saving entries on each device.
 */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCbAy1CZpwq9q7aggpBVKVegHTQzrxdXr4",
  authDomain: "assemblies-of-god-accounting.firebaseapp.com",
  projectId: "assemblies-of-god-accounting",
  storageBucket: "assemblies-of-god-accounting.firebasestorage.app",
  messagingSenderId: "786393609324",
  appId: "1:786393609324:web:c8db4b35c6cefa145d5449"
};
