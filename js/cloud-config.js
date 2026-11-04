/*
 * Cloud saving settings (Firebase). Leave "apiKey" empty to keep Magic Picker local-only, as before.
 * Fill these in from Firebase console → Project settings → Your apps → Web app → "firebaseConfig".
 * These values are not secret: access is protected by Firebase sign-in and the Firestore rules.
 */
window.MP_CLOUD_CONFIG = {
  firebase: {
    apiKey: 'AIzaSyDlj3fnTtxf5eQJnSbVahWitatp8jvUxO4',
    authDomain: 'magic-picker.firebaseapp.com',
    projectId: 'magic-picker',
    appId: '1:436920775293:web:1428f33373b932cbf37714'
  },
  // All devices that use the same "space" share the same classes, stars and cards.
  space: 'magic-picker-main',
  // Optional: fills in the email on the sign-in screen.
  email: 'cinaryusuf5816@gmail.com'
};
