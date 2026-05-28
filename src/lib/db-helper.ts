import { drizzle } from 'drizzle-orm/mysql2';
import { MySql2Database } from 'drizzle-orm/mysql2';
import mysql from 'mysql2/promise';

let connection: mysql.Connection;
let db: MySql2Database;

export async function getDb() {
  if (!connection) {
    connection = await mysql.createConnection(process.env.DATABASE_URL!);
    db = drizzle(connection);
  }

  return db;
}

export async function closeDb() {
  if (connection) {
    await connection.end();
    connection = undefined!;
    db = undefined!;
  }
}
