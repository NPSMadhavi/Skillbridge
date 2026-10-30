/**
 * Root Phusion Passenger CommonJS bootstrap wrapper for Plesk.
 * Routes to Backend/index.js if Plesk Application Root is configured at the repository root.
 */
(async () => {
  try {
    await import('./Backend/index.js');
  } catch (err) {
    console.error('[PASSENGER ROOT BOOTSTRAP ERROR]', err);
    process.exit(1);
  }
})();
