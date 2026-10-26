if(!process.env.VITE_ICE_SERVERS)throw new Error('Configura VITE_ICE_SERVERS amb credencials TURN vàlides abans de provar el relé.');
process.env.CESC_TEST_TURN='true';
process.env.VITE_ICE_TRANSPORT_POLICY='relay';
await import('./live.mjs');
