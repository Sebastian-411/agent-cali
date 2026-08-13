// El cliente de postgres es perezoso: definir estas variables basta para que los
// módulos se importen sin abrir conexiones.
process.env.DATABASE_URL ??= 'postgres://test:test@localhost:5433/test'
process.env.DB_SCHEMA ??= 'grupos_test'
process.env.SENDER_SALT ??= 'sal-de-prueba'
process.env.WEBHOOK_TOKEN ??= 'token-de-prueba'
process.env.ADMIN_API_KEY ??= 'clave-de-prueba'
process.env.EVOLUTION_API_URL ??= 'http://localhost:9999'
process.env.EVOLUTION_API_KEY ??= 'x'
process.env.EVOLUTION_INSTANCE ??= 'test'
process.env.GEMINI_API_KEY ??= 'clave-de-prueba'
