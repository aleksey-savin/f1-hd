// Разовая заморозка расчёта у отчётов по услугам, сформированных до появления
// снимка (services/reportSnapshot.js), 2026-10-01.
//
// Новый отчёт запоминает расчёт при формировании. У старых снимка нет, и взять
// его неоткуда: условия услуги на тот день нигде не записаны. Поэтому снимок
// считается СЕЙЧАС. Если он даёт те же деньги, что отчёт уже хранит (`price`,
// `additionalPrice`), — с момента формирования ничего, что влияет на расчёт, не
// менялось, и нынешняя разбивка и есть подписанная.
//
// Если не сошёлся (цены услуги поднимали, правило округления меняли, работы
// правили) — правда документа в сохранённых суммах: их видел клиент и по ним
// выставлен счёт. Они и остаются итогом, а разбивка по работам и условия
// берутся сегодняшние и помечаются `legacy`: карточка скажет, что они
// восстановлены и могут с итогом не сходиться. Суммы отчёта скрипт НЕ меняет.
//
// Несошедшиеся отчёты, по которым ещё можно что-то поправить (не оплачены и не
// в архиве), перечисляются поимённо: такой отчёт можно вернуть в превью и
// сформировать заново — тогда он посчитается по нынешним условиям.
//
// Скрипт только дописывает поле `snapshot` и идемпотентен: отчёты со снимком
// пропускаются. Останавливать приложение не обязательно. Код выхода 0.
//
// Запуск внутри контейнера бэкенда:
//   node scripts/snapshotReports.js            # показать
//   node scripts/snapshotReports.js --apply    # записать
require("module-alias/register");
const mongoose = require("mongoose");

const Company = require("@/models/company");
const Preferences = require("@/models/preferences");
const ServicePlan = require("@/models/finances/servicePlan");
const ServicePlanReport = require("@/models/finances/servicePlanReport");
const TicketCategory = require("@/models/ticketCategory");
const Work = require("@/models/work");
// Модель заявки нужна populate'у работ
require("@/models/ticket");

const { priceWorks } = require("@/services/servicePlanBilling");
const {
  buildSnapshot,
  matchesStoredTotals,
  pinToStored,
} = require("@/services/reportSnapshot");
const { fmtMonthYear, resolveTimezone } = require("@/utils/datetime");

const rub = (value) =>
  (Math.round((value || 0) * 100) / 100).toLocaleString("ru-RU");

const run = async () => {
  const apply = process.argv.includes("--apply");

  await mongoose.connect(
    `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
  );

  const [preferences, categories] = await Promise.all([
    Preferences.findOne({}).lean(),
    TicketCategory.find({}).select("alwaysWithinPlan").lean(),
  ]);
  const zone = resolveTimezone(preferences);
  const categoryById = new Map(
    categories.map((category) => [String(category._id), category]),
  );

  const reports = await ServicePlanReport.find({
    $or: [{ snapshot: null }, { snapshot: { $exists: false } }],
  })
    .select("company servicePlan works price additionalPrice periodFrom status")
    .sort({ periodFrom: 1 })
    .lean();

  const companies = new Map();
  const plans = new Map();
  const cached = async (cache, model, id) => {
    const key = String(id);
    if (!cache.has(key)) {
      cache.set(key, await model.findById(id).lean());
    }
    return cache.get(key);
  };

  // Отчёты, которые ещё можно переформировать: счёт не оплачен, архива нет
  const OPEN = new Set(["pendingApproval", "declined", "approved", "awaitingPayment"]);

  let matched = 0;
  let pinned = 0;
  let written = 0;
  const openMismatched = [];
  const orphaned = [];

  for (const report of reports) {
    const [company, plan] = await Promise.all([
      cached(companies, Company, report.company),
      cached(plans, ServicePlan, report.servicePlan),
    ]);
    const label = [
      company?.alias || "компания удалена",
      plan?.title || "услуга удалена",
      report.periodFrom ? fmtMonthYear(report.periodFrom, zone) : "без периода",
      report.status,
    ].join(" · ");

    if (!company || !plan) {
      orphaned.push(`  ${report._id} · ${label}`);
      continue;
    }

    const works = await Work.find({ _id: { $in: report.works } })
      .select("company startedAt finishedAt withinPlan tickets")
      .populate({ path: "tickets", select: "num categoryId" })
      .lean();

    const computed = buildSnapshot({
      priced: priceWorks({ plan, company, works, zone, categoryById }),
      works,
      zone,
    });

    let snapshot = computed;
    if (matchesStoredTotals(computed, report)) {
      matched += 1;
    } else {
      pinned += 1;
      snapshot = pinToStored(computed, report);
      if (OPEN.has(report.status)) {
        openMismatched.push(
          `  ${report._id} · ${label} · сохранено ${rub(report.price)} + ${rub(report.additionalPrice)}, сейчас ${rub(computed.price)} + ${rub(computed.additionalPrice)}${
            works.length < (report.works || []).length
              ? ` · работ в базе ${works.length} из ${report.works.length}`
              : ""
          }`,
        );
      }
    }

    if (apply) {
      // Условие на отсутствие снимка — на случай, если отчёт успели
      // переформировать, пока шёл прогон
      const result = await ServicePlanReport.updateOne(
        {
          _id: report._id,
          $or: [{ snapshot: null }, { snapshot: { $exists: false } }],
        },
        { $set: { snapshot } },
      );
      written += result.modifiedCount || 0;
    }
  }

  console.log(`Отчётов без снимка: ${reports.length}`);
  console.log(`  сошлись с нынешним расчётом: ${matched}`);
  console.log(`  не сошлись — итогом остаются сохранённые суммы: ${pinned}`);
  console.log(`  без компании или услуги (не тронуты): ${orphaned.length}`);

  if (openMismatched.length) {
    console.log(
      "\nНе сошлись и ещё не оплачены (в тарифе + сверх тарифа). Суммы отчёта не меняются;" +
        " чтобы пересчитать по нынешним условиям, верните отчёт в превью и сформируйте заново:",
    );
    for (const line of openMismatched) console.log(line);
  }
  if (orphaned.length) {
    console.log("\nБез компании или услуги (не тронуты):");
    for (const line of orphaned) console.log(line);
  }

  console.log(
    apply
      ? `\nЗаписано снимков: ${written}.`
      : `\nПоказ без записи: снимок получат отчёты — ${matched + pinned}. Повторите с --apply.`,
  );

  await mongoose.disconnect();
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
