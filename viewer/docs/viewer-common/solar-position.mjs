const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mod(value, period) {
  return ((value % period) + period) % period;
}

function parseLocalDate(dateText) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateText || ''));
  if (!m) throw new Error(`Invalid solar date '${dateText}', expected YYYY-MM-DD`);
  return {
    year: Number(m[1]),
    month: Number(m[2]),
    day: Number(m[3]),
  };
}

function solarTerms(dateMs) {
  const jd = dateMs / DAY_MS + 2440587.5;
  const t = (jd - 2451545.0) / 36525.0;

  const meanLong = mod(280.46646 + t * (36000.76983 + t * 0.0003032), 360);
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t);
  const ecc = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  const m = meanAnomaly * DEG;
  const equationCenter = Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t))
    + Math.sin(2 * m) * (0.019993 - 0.000101 * t)
    + Math.sin(3 * m) * 0.000289;
  const trueLong = meanLong + equationCenter;
  const omega = 125.04 - 1934.136 * t;
  const apparentLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * DEG);

  const meanObliquity = 23
    + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * DEG);
  const ob = obliquity * DEG;
  const lambda = apparentLong * DEG;
  const declination = Math.asin(Math.sin(ob) * Math.sin(lambda));

  const y = Math.tan(ob / 2) * Math.tan(ob / 2);
  const l0 = meanLong * DEG;
  const eqTime = 4 * RAD * (
    y * Math.sin(2 * l0)
    - 2 * ecc * Math.sin(m)
    + 4 * ecc * y * Math.sin(m) * Math.cos(2 * l0)
    - 0.5 * y * y * Math.sin(4 * l0)
    - 1.25 * ecc * ecc * Math.sin(2 * m)
  );

  return { declination, eqTime };
}

export function solarPosition(dateMs, latitudeDeg, longitudeDeg) {
  if (!Number.isFinite(dateMs)) throw new Error(`Invalid solar timestamp '${dateMs}'`);
  if (!Number.isFinite(latitudeDeg)) throw new Error(`Invalid solar latitude '${latitudeDeg}'`);
  if (!Number.isFinite(longitudeDeg)) throw new Error(`Invalid solar longitude '${longitudeDeg}'`);

  const { declination, eqTime } = solarTerms(dateMs);
  const date = new Date(dateMs);
  const utcMinutes = date.getUTCHours() * 60
    + date.getUTCMinutes()
    + date.getUTCSeconds() / 60
    + date.getUTCMilliseconds() / 60000;
  const trueSolarMinutes = mod(utcMinutes + eqTime + 4 * longitudeDeg, 1440);
  const hourAngleDeg = trueSolarMinutes / 4 < 0
    ? trueSolarMinutes / 4 + 180
    : trueSolarMinutes / 4 - 180;
  const hourAngle = hourAngleDeg * DEG;
  const lat = latitudeDeg * DEG;

  const cosZenith = clamp(
    Math.sin(lat) * Math.sin(declination)
      + Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngle),
    -1,
    1,
  );
  const zenith = Math.acos(cosZenith);
  const elevationDeg = 90 - zenith * RAD;

  const sinZenith = Math.sin(zenith);
  let azimuthDeg;
  if (Math.abs(sinZenith) < 1e-8) {
    azimuthDeg = 180;
  } else {
    const azArg = clamp(
      (Math.sin(lat) * Math.cos(zenith) - Math.sin(declination))
        / (Math.cos(lat) * sinZenith),
      -1,
      1,
    );
    const az = Math.acos(azArg) * RAD;
    azimuthDeg = hourAngleDeg > 0 ? mod(az + 180, 360) : mod(540 - az, 360);
  }

  return { azimuthDeg, elevationDeg };
}

export function formatLocalHHMM(dateMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(dateMs));
  let hour = parts.find((p) => p.type === 'hour')?.value || '00';
  const minute = parts.find((p) => p.type === 'minute')?.value || '00';
  if (hour === '24') hour = '00';
  return `${hour}:${minute}`;
}

export function findSunrise({
  date,
  timeZone = 'UTC',
  utcOffsetMinutes = 0,
  latitude,
  longitude,
  horizonDeg = -0.833,
} = {}) {
  const { year, month, day } = parseLocalDate(date);
  if (!Number.isFinite(utcOffsetMinutes)) throw new Error('utcOffsetMinutes must be finite');
  const localMidnightUtcMs = Date.UTC(year, month - 1, day) - utcOffsetMinutes * MINUTE_MS;
  const endMs = localMidnightUtcMs + DAY_MS;
  const stepMs = 5 * MINUTE_MS;

  let prevMs = localMidnightUtcMs;
  let prevAlt = solarPosition(prevMs, latitude, longitude).elevationDeg - horizonDeg;
  for (let ms = localMidnightUtcMs + stepMs; ms <= endMs; ms += stepMs) {
    const alt = solarPosition(ms, latitude, longitude).elevationDeg - horizonDeg;
    if (prevAlt <= 0 && alt >= 0) {
      let lo = prevMs;
      let hi = ms;
      for (let i = 0; i < 32; i++) {
        const mid = (lo + hi) / 2;
        const midAlt = solarPosition(mid, latitude, longitude).elevationDeg - horizonDeg;
        if (midAlt >= 0) hi = mid;
        else lo = mid;
      }
      const utcMs = hi;
      const pos = solarPosition(utcMs, latitude, longitude);
      return {
        date,
        timeZone,
        utcMs,
        localTime: formatLocalHHMM(utcMs, timeZone),
        azimuthDeg: pos.azimuthDeg,
        elevationDeg: pos.elevationDeg,
      };
    }
    prevMs = ms;
    prevAlt = alt;
  }

  throw new Error(`No sunrise crossing found for ${date} at ${latitude},${longitude}`);
}
