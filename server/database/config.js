const mysql = require("mysql2");

const con = mysql.createPool({
  connectionLimit: Number(process.env.DB_POOL || 50),
  host: process.env.DBHOST || "localhost",
  port: process.env.DBPORT || 3306,
  user: process.env.DBUSER,
  password: process.env.DBPASS,
  database: process.env.DBNAME,
  charset: "utf8mb4",
  waitForConnections: true,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  // ADITIVO: sem isto o mysql2 usa o default e o boot falha com
  // "connect ETIMEDOUT" quando o MariaDB ainda esta subindo/recovery.
  connectTimeout: 15000,
});

// Handle connection errors
con.on("connection", function (connection) {
  // console.log("Database connection established as id " + connection.threadId);
});

con.on("error", function (err) {
  console.error("Database error:", err);
  if (err.code === "PROTOCOL_CONNECTION_LOST") {
    console.log("Database connection lost, reconnecting...");
  }
});

// ADITIVO: retry com backoff na conexao inicial. O pool reconecta sozinho
// nas queries, mas antes o boot registrava "Database connected error" e
// seguia sem nenhuma tentativa extra (o MariaDB podia estar em recovery).
(function pingDb(attempt = 1) {
  con.getConnection((err, connection) => {
    if (err) {
      console.error(
        `[db] conexao inicial falhou (tentativa ${attempt}):`,
        err.code || err.message,
      );
      if (attempt < 10) {
        return setTimeout(() => pingDb(attempt + 1), attempt * 2000);
      }
      console.log({
        err: err,
        msg: "Database connected error",
      });
      return;
    }
    console.log("Database has been connected");
    connection.release();
  });
})();

module.exports = con;
