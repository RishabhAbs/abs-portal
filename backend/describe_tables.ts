import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { DbService } from './src/database/db.service';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const db = app.get(DbService);
  
  const tables = ['customer', 'tallydetails', 'singlemaster', 'admin'];
  const result: any = {};
  for (const table of tables) {
    const cols = await db.query(`DESCRIBE ${table}`);
    result[table] = cols;
  }
  
  console.log(JSON.stringify(result, null, 2));
  await app.close();
}
bootstrap();
