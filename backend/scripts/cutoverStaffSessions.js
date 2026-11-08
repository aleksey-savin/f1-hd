// По умолчанию только чтение счётчиков. --apply запускать при остановленных писателях приложения.
const { runStaffSessionCutover } = require("../services/staffSessionCutover");

const main = async ({
  argv = process.argv.slice(2),
  mongoose = require("mongoose"),
  env = process.env,
  log = console.log,
} = {}) => {
  if (argv.length > 1 || (argv.length === 1 && argv[0] !== "--apply")) {
    throw new Error("usage: node scripts/cutoverStaffSessions.js [--apply]");
  }
  const uri = `mongodb://${env.MONGODB_USERNAME}:${env.MONGODB_PASSWORD}@mongodb:27017/${env.MONGODB_DATABASE}?authSource=admin`;
  await mongoose.connect(uri);
  try {
    const summary = await runStaffSessionCutover({ db: mongoose.connection.db, apply: argv[0] === "--apply" });
    log(JSON.stringify(summary));
    return summary;
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  main().catch(() => {
    // Ошибки драйвера могут содержать сведения о подключении. Не выводить учётные данные.
    console.error("Staff session cutover failed");
    process.exitCode = 1;
  });
}

module.exports = { main };
