
import { NestFactory } from '@nestjs/core';
import { AppModule } from './src/app.module';
import { DbService } from './src/database/db.service';

async function bootstrap() {
    const app = await NestFactory.createApplicationContext(AppModule);
    const db = app.get('DbService');
    const tables = await db.query('SHOW TABLES');
    console.log('Tables:', tables);
    for (const t of tables) {
        const tableName = Object.values(t)[0];
        const columns = await db.query(`DESCRIBE ${tableName}`);
        console.log(`Columns for ${tableName}:`, columns.map((c: any) => c.Field));
    }
    await app.close();
}
bootstrap();
