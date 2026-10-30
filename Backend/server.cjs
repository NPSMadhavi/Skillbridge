/**
 * Phusion Passenger CommonJS bootstrap wrapper for Plesk.
 * Solves ERR_REQUIRE_ESM when Passenger boots Node.js applications with require().
 */
(async () => {
  try {
    await import('./index.js');
  } catch (err) {
    console.error('[PASSENGER BOOTSTRAP ERROR]', err);
    process.exit(1);
  }
})();
