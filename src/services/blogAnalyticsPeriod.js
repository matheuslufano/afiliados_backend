const { fail } = require("./blogValidation");
const DAY = 86400000;
function shiftDate(value, amount) {
  return new Date(Date.parse(value + "T12:00:00Z") + amount * DAY)
    .toISOString()
    .slice(0, 10);
}
function validDate(value) {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value)) &&
    new Date(value + "T12:00:00Z").toISOString().slice(0, 10) === value
  );
}
/** Reporting days use the Blog's Brazilian timezone, including both selected calendar dates. */
function analyticsPeriod(query, now = new Date()) {
  const today = new Date(now.getTime() - 3 * 3600000)
    .toISOString()
    .slice(0, 10);
  const end = query.end || today;
  if (!validDate(end)) fail("Informe uma data final válida.");
  const start = query.start || shiftDate(end, -6);
  if (!validDate(start) || !validDate(end) || start > end || end > today)
    fail("Informe datas válidas, sem datas futuras.");
  const days = Math.round((Date.parse(end) - Date.parse(start)) / DAY) + 1;
  if (days > 180) fail("Selecione no máximo 180 dias por consulta.");
  if (
    query.articleId != null &&
    (typeof query.articleId !== "string" ||
      query.articleId.length > 200 ||
      !query.articleId)
  )
    fail("Artigo inválido.");
  const previousStart = shiftDate(start, -days),
    previousEnd = shiftDate(start, -1);
  return {
    start,
    end,
    previousStart,
    previousEnd,
    days,
    timeZone: "America/Araguaina",
    from: new Date(start + "T00:00:00-03:00"),
    until: new Date(shiftDate(end, 1) + "T00:00:00-03:00"),
    previousFrom: new Date(previousStart + "T00:00:00-03:00"),
  };
}
module.exports = { analyticsPeriod, shiftDate };
