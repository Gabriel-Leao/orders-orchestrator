import { TEST_ENV } from './test-env';

// Executa antes de cada arquivo de teste (setupFiles), antes de qualquer import
// da aplicação: garante que o ConfigModule enxergue o ambiente de teste.
Object.assign(process.env, TEST_ENV);
