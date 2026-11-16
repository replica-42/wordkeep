import { app } from 'electron';

app.setPath('userData', process.env.WORDKEEP_TEST_USER_DATA);
await import('../out/main/index.js');
