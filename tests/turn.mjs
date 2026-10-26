process.env.CESC_TEST_TURN='true';
process.env.VITE_ICE_TRANSPORT_POLICY='relay';
process.env.VITE_TURN_TLS_ONLY='true';
delete process.env.VITE_ICE_SERVERS;
await import('./live.mjs');
