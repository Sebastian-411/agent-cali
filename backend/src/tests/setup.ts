// El cliente de postgres es perezoso: definir estas variables basta para que los
// módulos se importen sin abrir conexiones.
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5433/test'
process.env.DB_SCHEMA ??= 'grupos_test'
process.env.ADMIN_API_KEY ??= 'clave-de-prueba'
process.env.EVOLUTION_API_URL ??= 'http://localhost:9999'
process.env.EVOLUTION_API_KEY ??= 'x'
process.env.EVOLUTION_INSTANCE ??= 'test'
process.env.GEMINI_API_KEY ??= 'clave-de-prueba'

// Los secretos normalmente se leen de la base; en pruebas se fijan a mano.
const { setSecrets } = await import('../lib/secrets.js')
setSecrets({ webhookToken: 'token-de-prueba', senderSalt: 'sal-de-prueba' })
