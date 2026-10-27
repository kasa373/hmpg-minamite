import {
  apply3, formatJst, formatLatLon, formatSolar, gmstDeg, horizontalMatrix,
  julianDate, jstInputToDate, moonRaDec, normDeg, planetRaDec, precessionMatrix,
  raDecToVec, routePoint, sunRaDec,
} from './astro.js';
import { CITIES } from './cities.js';
import { isLand, prepareLand } from './land.js';
import { createGlobe } from './globe.js';
import { createRenderer, decodeStars, indexFaint } from './render.js';

const PREFS = [
  ['01', '北海道'], ['02', '青森県'], ['03', '岩手県'], ['04', '宮城県'],
  ['05', '秋田県'], ['06', '山形県'], ['07', '福島県'], ['08', '茨城県'],
  ['09', '栃木県'], ['10', '群馬県'], ['11', '埼玉県'], ['12', '千葉県'],
  ['13', '東京都'], ['14', '神奈川県'], ['15', '新潟県'], ['16', '富山県'],
  ['17', '石川県'], ['18', '福井県'], ['19', '山梨県'], ['20', '長野県'],
  ['21', '岐阜県'], ['22', '静岡県'], ['23', '愛知県'], ['24', '三重県'],
  ['25', '滋賀県'], ['26', '京都府'], ['27', '大阪府'], ['28', '兵庫県'],
  ['29', '奈良県'], ['30', '和歌山県'], ['31', '鳥取県'], ['32', '島根県'],
  ['33', '岡山県'], ['34', '広島県'], ['35', '山口県'], ['36', '徳島県'],
  ['37', '香川県'], ['38', '愛媛県'], ['39', '高知県'], ['40', '福岡県'],
  ['41', '佐賀県'], ['42', '長崎県'], ['43', '熊本県'], ['44', '大分県'],
  ['45', '宮崎県'], ['46', '鹿児島県'], ['47', '沖縄県'],
];

const $ = (id) => document.getElementById(id);
const canvas = $('sky');
const renderer = createRenderer(canvas);
const globe = createGlobe($('globe'));
const MIN_R = renderer.minRadius;

const prefEl = $('pref');
const townEl = $('town');
const townList = $('townList');
const cityEl = $('city');
const placeKindEl = $('placeKind');
const latEl = $('lat');
const lonEl = $('lon');
const whenEl = $('when');
const tiltEl = $('tilt');
const minutesEl = $('minutes');
const dayMinutesEl = $('dayMinutes');
const playModeEl = $('playMode');
const magEl = $('mag');
const northEl = $('north');
const shadeEl = $('shade');
const starSizeEl = $('starSize');
const linesEl = $('showLines');
const namesEl = $('showNames');
const infoEl = $('showInfo');
const hudText = $('hudText');
const faintButtons = [9, 10, 11].map((mag) => ({ mag, el: $(`btn${mag}`) }));

for (const [code, name] of PREFS) {
  const opt = document.createElement('option');
  opt.value = code;
  opt.textContent = name;
  prefEl.appendChild(opt);
}

{
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '選ばない';
  cityEl.appendChild(blank);
  let region = '';
  let group = null;
  for (const [reg, name] of CITIES) {
    if (reg !== region) {
      group = document.createElement('optgroup');
      group.label = reg;
      cityEl.appendChild(group);
      region = reg;
    }
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    group.appendChild(opt);
  }
}

const saved = loadSettings();
let placeName = saved.placeName || '東京駅付近';
let towns = [];
let playing = false;
let fraction = 0;
let lastTick = 0;
let viewRadius = 32;
let zoomPower = 1;
let centerAlt = 22;
let centerAz = 180;
let faintLimit = 0;
let faint = null;
let faintIndex = null;
let faintLoading = false;
let selected = null;
let pointerMoved = false;
let pointerPinched = false;
let land = [];
let sky = { constellations: [], stars: [] };
let stars = { n: 0, ra: new Float32Array(), dec: new Float32Array(), mag: new Float32Array(), bv: new Float32Array() };
let onLand = true;
let layout = { radius: 300, dpr: 1 };

latEl.value = saved.lat ?? 35.6812;
lonEl.value = saved.lon ?? 139.7671;
prefEl.value = saved.pref || '13';
magEl.value = saved.mag || '6';
minutesEl.value = saved.minutes || '30';
dayMinutesEl.value = saved.dayMinutes || '30';
playModeEl.value = saved.playMode === 'here' ? 'here' : 'world';
tiltEl.value = saved.tilt == null || saved.tilt === '' ? '-45' : saved.tilt;
northEl.value = saved.north || '0';
shadeEl.value = saved.shade ?? '0';
starSizeEl.value = saved.starSize == null || saved.starSize === '' ? '1' : saved.starSize;
linesEl.checked = saved.lines !== false;
namesEl.checked = saved.names !== false;
infoEl.checked = saved.info !== false;
$('dir').value = saved.dir || 'east';
$('volume').value = saved.volume ?? 0.7;
cityEl.value = saved.city || '';
placeKindEl.value = saved.placeKind || (saved.city ? 'city' : 'japan');
whenEl.value = saved.when || defaultWhen();
updateLabels();

const audio = new Audio();
audio.volume = Number($('volume').value);
let tracks = [];
let trackIndex = 0;
if (window.showDirectoryPicker) $('pickDir').hidden = false;

function defaultWhen() {
  const jst = new Date(Date.now() + 9 * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return `${jst.getUTCFullYear()}-${p(jst.getUTCMonth() + 1)}-${p(jst.getUTCDate())}T20:00`;
}

function loadSettings() {
  try { return JSON.parse(localStorage.getItem('minastar-v1') || '{}'); }
  catch { return {}; }
}

function saveSettings() {
  localStorage.setItem('minastar-v1', JSON.stringify({
    lat: latEl.value, lon: lonEl.value, pref: prefEl.value, placeName,
    mag: magEl.value, minutes: minutesEl.value, dayMinutes: dayMinutesEl.value,
    playMode: playModeEl.value, tilt: tiltEl.value,
    north: northEl.value, shade: shadeEl.value, starSize: starSizeEl.value,
    lines: linesEl.checked, names: namesEl.checked, info: infoEl.checked,
    dir: $('dir').value, volume: $('volume').value,
    when: whenEl.value, city: cityEl.value, placeKind: placeKindEl.value,
  }));
}

function startLatLon() {
  return {
    lat: Math.max(-89, Math.min(89, Number(latEl.value) || 0)),
    lon: Math.max(-180, Math.min(180, Number(lonEl.value) || 0)),
  };
}

function hereMode() {
  return playModeEl.value === 'here';
}

function observer() {
  const start = startLatLon();
  if (hereMode()) return start;
  return routePoint(start.lat, start.lon, Number(tiltEl.value), $('dir').value === 'west', fraction);
}

function flightLine() {
  const start = startLatLon();
  const tilt = Number(tiltEl.value);
  const west = $('dir').value === 'west';
  const n = 360;
  const route = [];
  for (let i = 0; i <= n; i++) route.push(routePoint(start.lat, start.lon, tilt, west, i / n));
  return route;
}

function skyDate() {
  const base = jstInputToDate(whenEl.value);
  if (!hereMode()) return base;
  return new Date(base.getTime() + fraction * 86400000);
}

function resetRoute() {
  fraction = 0;
  playing = false;
  lastTick = 0;
  disableFaint();
  syncPlayButtons();
}

function syncPlayButtons() {
  const label = playing ? '一時停止' : '再生';
  $('play').textContent = label;
  $('playHud').textContent = label;
  $('play').classList.toggle('playing', playing);
  $('playHud').classList.toggle('playing', playing);
}

function disableFaint() {
  faintLimit = 0;
  for (const b of faintButtons) b.el.classList.remove('on');
}

function atMaxZoom() {
  return viewRadius <= MIN_R + 0.05;
}

const powerButtons = [1, 2, 4, 8].map((power) => ({ power, el: $(`pow${power}`) }));

function updateFaintButton() {
  const show = atMaxZoom() && !playing;
  $('faintRow').hidden = !show;
  for (const b of faintButtons) {
    b.el.hidden = !show;
    b.el.classList.toggle('on', faintLimit === b.mag);
  }
  const showPower = atMaxZoom();
  $('powerRow').hidden = !showPower;
  for (const b of powerButtons) {
    b.el.hidden = !showPower;
    b.el.classList.toggle('on', zoomPower === b.power);
  }
  const locked = zoomPower > 1;
  $('zoomIn').disabled = locked;
  $('zoomOut').disabled = locked;
}

function setRadius(next) {
  const wasMax = atMaxZoom();
  zoomPower = 1;
  viewRadius = Math.max(MIN_R, Math.min(46, next));
  if (wasMax && !atMaxZoom()) disableFaint();
  updateFaintButton();
}

function setPower(power) {
  zoomPower = power;
  viewRadius = MIN_R / power;
  updateFaintButton();
}

function viewBasis(altDeg, azDeg) {
  const alt = altDeg * Math.PI / 180;
  const az = azDeg * Math.PI / 180;
  const view = [
    Math.cos(alt) * Math.sin(az),
    Math.cos(alt) * Math.cos(az),
    Math.sin(alt),
  ];
  let ref = [0, 0, 1];
  let dot = view[2];
  if (Math.abs(dot) > 0.92) ref = [0, 1, 0];
  dot = view[0] * ref[0] + view[1] * ref[1] + view[2] * ref[2];
  let up = [ref[0] - view[0] * dot, ref[1] - view[1] * dot, ref[2] - view[2] * dot];
  const ul = Math.hypot(up[0], up[1], up[2]) || 1;
  up = [up[0] / ul, up[1] / ul, up[2] / ul];
  const right = [
    view[1] * up[2] - view[2] * up[1],
    view[2] * up[0] - view[0] * up[2],
    view[0] * up[1] - view[1] * up[0],
  ];
  return { view, right, up };
}

function azGap(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function panBy(dx, dy) {
  if (!dx && !dy) return;
  const pxR = Math.max(40, layout.radius / Math.max(0.1, layout.dpr));
  const north = Number(northEl.value) * Math.PI / 180;
  const cosN = Math.cos(north);
  const sinN = Math.sin(north);
  const alongRight = dx * cosN - dy * sinN;
  const alongUp = -dx * sinN - dy * cosN;
  const pix = Math.hypot(alongRight, alongUp);
  if (pix < 0.01) return;
  const total = Math.atan(pix / pxR);
  const sx = -alongRight / pix;
  const sy = -alongUp / pix;
  const steps = Math.max(1, Math.ceil(total / (2 * Math.PI / 180)));
  const ang = total / steps;
  for (let i = 0; i < steps; i++) {
    const { view, right, up } = viewBasis(centerAlt, centerAz);
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    const nv = [
      view[0] * c + (right[0] * sx + up[0] * sy) * s,
      view[1] * c + (right[1] * sx + up[1] * sy) * s,
      view[2] * c + (right[2] * sx + up[2] * sy) * s,
    ];
    const nlen = Math.hypot(nv[0], nv[1], nv[2]) || 1;
    const alt = Math.asin(Math.max(-1, Math.min(1, nv[2] / nlen))) * 180 / Math.PI;
    const az = Math.atan2(nv[0] / nlen, nv[1] / nlen) * 180 / Math.PI;
    if (centerAlt > 70 && alt < centerAlt && azGap(az, centerAz) > 90) {
      centerAlt = 90;
      break;
    }
    centerAlt = Math.max(-15, Math.min(90, alt));
    centerAz = az;
  }
}

function updateLabels() {
  const tilt = Number(tiltEl.value);
  $('tiltLabel').textContent = Math.abs(tilt) < 1
    ? '真東（緯度を保つ）'
    : (tilt > 0 ? `南へ ${tilt}°` : `北へ ${-tilt}°`);
  $('magLabel').textContent = `${magEl.value}等星`;
  $('northLabel').textContent = `${northEl.value}°`;
  const shade = Number(shadeEl.value);
  $('shadeLabel').textContent = `${shade > 0 ? '+' : ''}${shade}%`;
  const starSize = Math.round(Number(starSizeEl.value) * 10) / 10;
  $('starSizeLabel').textContent = `${Number.isInteger(starSize) ? starSize : starSize.toFixed(1)}倍`;
  hudText.hidden = !infoEl.checked;
  $('placeName').textContent = placeName;
  const kind = placeKindEl.value;
  $('cityPlace').hidden = kind !== 'city';
  $('japanPlace').hidden = kind !== 'japan';
  $('geoPlace').hidden = kind !== 'geo';
  const playingHere = hereMode();
  $('worldOpts').hidden = playingHere;
  $('hereOpts').hidden = !playingHere;
  $('whenLegend').textContent = playingHere ? '始めの日時（日本時間）' : '固定する瞬間（日本時間）';
}

function hud(here, utc) {
  const moon = moonRaDec(julianDate(utc));
  const wrapped = ((fraction % 1) + 1) % 1;
  const lap = !hereMode() && fraction >= 1 && wrapped === 0
    ? 100
    : Math.round(wrapped * 100);
  const clock = hereMode()
    ? `${formatJst(utc)} 日本時間`
    : `固定 ${formatJst(utc)} 日本時間`;
  const progress = hereMode() ? `1日 ${lap}%` : `一周 ${lap}%`;
  hudText.textContent = [
    placeName,
    clock,
    `${formatLatLon(here.lat, here.lon)}  ${onLand ? '陸上' : '海上'}  現地 ${formatSolar(utc, here.lon)}`,
    `${progress}　月 ${Math.round(moon.illum * 100)}%`,
  ].join('\n');
}

async function loadPref(code, pick) {
  const res = await fetch(`data/places/${code}.json`);
  if (!res.ok) throw new Error('places');
  towns = await res.json();
  if (pick) {
    const found = towns.find((t) => t[1] && t[1].includes(pick)) || towns.find((t) => t[0].includes(pick));
    if (found) chooseTown(found);
  }
}

function chooseTown(row) {
  const [city, town, lat, lon] = row;
  latEl.value = lat;
  lonEl.value = lon;
  placeName = `${prefEl.selectedOptions[0].textContent} ${city} ${town}`.replace(/\s+/g, ' ').trim();
  townEl.value = town || city;
  cityEl.value = '';
  townList.hidden = true;
  updateLabels();
  resetRoute();
  saveSettings();
}

function chooseCity() {
  const city = CITIES.find((row) => row[1] === cityEl.value);
  if (!city) return;
  latEl.value = city[2];
  lonEl.value = city[3];
  placeName = city[1];
  townEl.value = '';
  townList.hidden = true;
  updateLabels();
  resetRoute();
  saveSettings();
}

function locate() {
  const note = $('locateNote');
  const button = $('locate');
  if (!navigator.geolocation) {
    note.textContent = 'このブラウザでは現在地を取れません';
    return;
  }
  button.disabled = true;
  note.textContent = '位置を確認しています';
  navigator.geolocation.getCurrentPosition((pos) => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    latEl.value = Math.round(lat * 100000) / 100000;
    lonEl.value = Math.round(lon * 100000) / 100000;
    placeName = '現在地';
    townEl.value = '';
    townList.hidden = true;
    note.textContent = '';
    button.disabled = false;
    updateLabels();
    resetRoute();
    saveSettings();
  }, (err) => {
    note.textContent = err.code === 1
      ? '位置の使用が許可されていません'
      : '現在地を取得できませんでした';
    button.disabled = false;
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
}

function searchTowns() {
  const q = townEl.value.trim();
  townList.innerHTML = '';
  if (!q || !towns.length) {
    townList.hidden = true;
    return;
  }
  const starts = [];
  const rest = [];
  for (let i = 0; i < towns.length; i++) {
    const row = towns[i];
    const town = row[1] || '';
    const city = row[0] || '';
    if (town.startsWith(q) || city.startsWith(q)) starts.push(row);
    else if (`${city}${town}`.includes(q)) rest.push(row);
    if (starts.length >= 12) break;
  }
  const hits = starts.concat(rest).slice(0, 12);
  if (!hits.length) {
    townList.hidden = true;
    return;
  }
  for (const row of hits) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = `${row[0]} ${row[1]}`.trim();
    b.addEventListener('click', () => chooseTown(row));
    li.appendChild(b);
    townList.appendChild(li);
  }
  townList.hidden = false;
}

function addTracks(fileList) {
  for (const file of fileList) {
    if (!file.type.startsWith('audio/') && !/\.(mp3|m4a|wav|ogg)$/i.test(file.name)) continue;
    tracks.push({ name: file.name, url: URL.createObjectURL(file) });
  }
  if (tracks.length && audio.paused) playTrack(trackIndex);
  else updateTrackLabel();
}

function updateTrackLabel() {
  $('trackName').textContent = tracks.length
    ? tracks[trackIndex].name
    : '曲がまだありません';
}

function playTrack(index) {
  if (!tracks.length) return;
  trackIndex = (index + tracks.length) % tracks.length;
  audio.src = tracks[trackIndex].url;
  audio.play().catch(() => {});
  updateTrackLabel();
  $('musicToggle').textContent = '停止';
}

audio.addEventListener('ended', () => {
  if ($('shuffle').checked && tracks.length > 1) {
    let next = trackIndex;
    while (next === trackIndex) next = Math.floor(Math.random() * tracks.length);
    playTrack(next);
    return;
  }
  if (trackIndex < tracks.length - 1 || $('loop').checked) playTrack(trackIndex + 1);
  else $('musicToggle').textContent = '再生';
});

prefEl.addEventListener('change', async () => {
  cityEl.value = '';
  placeName = prefEl.selectedOptions[0].textContent;
  updateLabels();
  try { await loadPref(prefEl.value); }
  catch { hudText.textContent = '町名データを読めませんでした'; }
});
townEl.addEventListener('input', searchTowns);
cityEl.addEventListener('change', chooseCity);
placeKindEl.addEventListener('change', () => {
  updateLabels();
  saveSettings();
  if (placeKindEl.value === 'city') chooseCity();
  if (placeKindEl.value === 'geo') locate();
});
$('locate').addEventListener('click', locate);
latEl.addEventListener('change', () => { cityEl.value = ''; placeName = '指定した緯度経度'; updateLabels(); resetRoute(); saveSettings(); });
lonEl.addEventListener('change', () => { cityEl.value = ''; placeName = '指定した緯度経度'; updateLabels(); resetRoute(); saveSettings(); });
function whenToInput(date) {
  const t = new Date(date.getTime() + 9 * 3600000);
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${p(t.getUTCMonth() + 1)}-${p(t.getUTCDate())}T${p(t.getUTCHours())}:${p(t.getUTCMinutes())}`;
}

function readWhen() {
  if (whenEl.value && whenEl.value.includes('T')) {
    const date = jstInputToDate(whenEl.value);
    if (!Number.isNaN(date.getTime())) return date;
  }
  return new Date();
}

function setWhen(date) {
  whenEl.value = whenToInput(date);
  resetRoute();
  saveSettings();
}

whenEl.addEventListener('change', () => { resetRoute(); saveSettings(); });
$('whenNow').addEventListener('click', () => setWhen(new Date()));
$('whenPrev').addEventListener('click', () => setWhen(new Date(readWhen().getTime() - 86400000)));
$('whenNext').addEventListener('click', () => setWhen(new Date(readWhen().getTime() + 86400000)));
tiltEl.addEventListener('input', () => { updateLabels(); resetRoute(); saveSettings(); });
$('dir').addEventListener('change', () => { resetRoute(); saveSettings(); });
minutesEl.addEventListener('change', saveSettings);
dayMinutesEl.addEventListener('change', saveSettings);
playModeEl.addEventListener('change', () => { updateLabels(); resetRoute(); saveSettings(); });
magEl.addEventListener('input', () => { updateLabels(); saveSettings(); });
northEl.addEventListener('input', () => { updateLabels(); saveSettings(); });
shadeEl.addEventListener('input', () => { updateLabels(); saveSettings(); });
starSizeEl.addEventListener('input', () => { updateLabels(); saveSettings(); });
linesEl.addEventListener('change', saveSettings);
namesEl.addEventListener('change', saveSettings);
infoEl.addEventListener('change', () => { updateLabels(); saveSettings(); });

function togglePlay() {
  playing = !playing;
  if (playing) {
    disableFaint();
    lastTick = 0;
  }
  updateFaintButton();
  syncPlayButtons();
}

function horizonAlt() {
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, rect.width);
  const h = Math.max(1, rect.height);
  const focal = Math.max(w, h) / 2 / Math.tan(32 * Math.PI / 180);
  const margin = Math.min(64, Math.max(40, h * 0.055));
  const below = Math.max(12, h / 2 - margin);
  return Math.atan(below / focal) * 180 / Math.PI;
}

function lookSky(alt, az) {
  zoomPower = 1;
  viewRadius = 32;
  centerAlt = alt;
  centerAz = az;
  disableFaint();
  updateFaintButton();
}

$('play').addEventListener('click', togglePlay);
$('playHud').addEventListener('click', togglePlay);
$('restart').addEventListener('click', () => { fraction = 0; playing = false; syncPlayButtons(); updateFaintButton(); });
$('zoomIn').addEventListener('click', () => setRadius(viewRadius * 0.72));
$('zoomOut').addEventListener('click', () => setRadius(viewRadius * 1.28));
$('zenith').addEventListener('click', () => lookSky(90, 0));
$('lookN').addEventListener('click', () => lookSky(horizonAlt(), 0));
$('lookE').addEventListener('click', () => lookSky(horizonAlt(), 90));
$('lookS').addEventListener('click', () => lookSky(horizonAlt(), 180));
$('lookW').addEventListener('click', () => lookSky(horizonAlt(), 270));
$('full').addEventListener('click', () => {
  if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
  else document.exitFullscreen?.();
});
$('hide').addEventListener('click', () => document.body.classList.add('panel-hidden'));
$('panelToggle').addEventListener('click', () => document.body.classList.toggle('panel-hidden'));
$('hideButtons').addEventListener('click', () => document.body.classList.add('buttons-hidden'));
$('showButtons').addEventListener('click', () => document.body.classList.remove('buttons-hidden'));

for (const b of faintButtons) {
  b.el.addEventListener('click', () => chooseFaint(b));
}
for (const b of powerButtons) {
  b.el.addEventListener('click', () => setPower(b.power));
}

async function chooseFaint(button) {
  if (faintLimit === button.mag) {
    disableFaint();
    return;
  }
  faintLimit = button.mag;
  updateFaintButton();
  if (faint || faintLoading) return;
  faintLoading = true;
  button.el.textContent = '読込中';
  try {
    const res = await fetch('data/stars11.bin');
    if (!res.ok) throw new Error('missing');
    faint = decodeStars(await res.arrayBuffer());
    faintIndex = indexFaint(faint);
  } catch {
    faintLimit = 0;
    button.el.textContent = '読めません';
    updateFaintButton();
    return;
  } finally {
    faintLoading = false;
  }
  button.el.textContent = `${button.mag}等星`;
}

$('pickFiles').addEventListener('click', () => $('files').click());
$('files').addEventListener('change', () => { addTracks($('files').files); $('files').value = ''; });
$('pickDir').addEventListener('click', async () => {
  const dir = await window.showDirectoryPicker();
  const found = [];
  for await (const [, handle] of dir.entries()) {
    if (handle.kind !== 'file') continue;
    if (!/\.(mp3|m4a|wav|ogg)$/i.test(handle.name)) continue;
    found.push(await handle.getFile());
  }
  addTracks(found);
});
$('musicToggle').addEventListener('click', () => {
  if (!tracks.length) {
    $('files').click();
    return;
  }
  if (audio.paused) {
    if (!audio.src) playTrack(trackIndex);
    else audio.play().catch(() => {});
    $('musicToggle').textContent = '停止';
  } else {
    audio.pause();
    $('musicToggle').textContent = '再生';
  }
});
$('volume').addEventListener('input', () => { audio.volume = Number($('volume').value); saveSettings(); });

window.addEventListener('keydown', (e) => {
  if (e.target.closest('input, select, textarea')) return;
  if (e.code === 'Escape') {
    closeStar();
    return;
  }
  if (e.code === 'Space') {
    e.preventDefault();
    togglePlay();
  }
});
window.addEventListener('resize', () => renderer.resize());

const pointers = new Map();
canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 1) {
    pointerMoved = false;
    pointerPinched = false;
    canvas.dataset.x0 = String(e.clientX);
    canvas.dataset.y0 = String(e.clientY);
  }
  if (pointers.size === 1) {
    canvas.setPointerCapture(e.pointerId);
    canvas.dataset.drag = '1';
    canvas.dataset.x = String(e.clientX);
    canvas.dataset.y = String(e.clientY);
  }
});
canvas.addEventListener('pointermove', (e) => {
  if (!pointers.has(e.pointerId)) return;
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size >= 2) pointerPinched = true;
  if (pointers.size === 1) {
    const dx = e.clientX - Number(canvas.dataset.x0);
    const dy = e.clientY - Number(canvas.dataset.y0);
    if (dx * dx + dy * dy > 64) pointerMoved = true;
  }
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    const prev = Number(canvas.dataset.pinch || dist);
    if (canvas.dataset.pinch && zoomPower === 1) setRadius(viewRadius * (prev / dist));
    canvas.dataset.pinch = String(dist);
    return;
  }
  if (canvas.dataset.drag !== '1') return;
  const dx = e.clientX - Number(canvas.dataset.x);
  const dy = e.clientY - Number(canvas.dataset.y);
  canvas.dataset.x = String(e.clientX);
  canvas.dataset.y = String(e.clientY);
  panBy(dx, dy);
});
function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pointers.size < 2) delete canvas.dataset.pinch;
  if (pointers.size === 0) {
    delete canvas.dataset.drag;
    if (!pointerMoved && !pointerPinched) {
      const hit = renderer.pick(e.clientX, e.clientY, { stars, faint, faintIndex, sky });
      if (hit) openStar(hit);
      else closeStar();
    }
    pointerMoved = false;
    pointerPinched = false;
  }
}

const WINDS = ['北', '北北東', '北東', '東北東', '東', '東南東', '南東', '南南東', '南', '南南西', '南西', '西南西', '西', '西北西', '北西', '北北西'];

function formatRa(deg) {
  const hours = ((deg % 360) + 360) % 360 / 15;
  const h = Math.floor(hours);
  const m = Math.floor((hours - h) * 60);
  return `${h}時 ${String(m).padStart(2, '0')}分`;
}

function formatDec(deg) {
  const sign = deg < 0 ? '−' : '+';
  const a = Math.abs(deg);
  const d = Math.floor(a);
  const m = Math.round((a - d) * 60);
  const adj = m === 60 ? d + 1 : d;
  const min = m === 60 ? 0 : m;
  return `${sign}${adj}° ${String(min).padStart(2, '0')}′`;
}

function formatAlt(alt) {
  if (alt < 0) return `地平線の下 ${Math.abs(alt).toFixed(0)}°`;
  return `${alt.toFixed(0)}°`;
}

function formatAz(az) {
  return WINDS[Math.round(normDeg(az) / 22.5) % 16];
}

function renderFacts(rows) {
  const dl = $('starFacts');
  dl.replaceChildren();
  for (const [term, value] of rows) {
    const dt = document.createElement('dt');
    dt.textContent = term;
    const dd = document.createElement('dd');
    dd.textContent = value;
    if (term === '高度') dd.id = 'starAlt';
    if (term === '方位') dd.id = 'starAz';
    dl.append(dt, dd);
  }
}

function openStar(hit) {
  selected = hit;
  $('starTitle').textContent = hit.title;
  const sub = [];
  if (hit.constellation) sub.push(`${hit.constellation}座`);
  if (hit.kind === 'planet') sub.push('惑星');
  if (hit.color) sub.push(hit.color);
  $('starSub').textContent = sub.join(' · ');
  const rows = [];
  if (hit.kind === 'star') rows.push(['等級', `${hit.mag.toFixed(1)}等`]);
  if (hit.kind === 'moon') rows.push(['明るさ', `${Math.round(hit.illum * 100)}%`]);
  rows.push(
    ['赤経', formatRa(hit.ra)],
    ['赤緯', formatDec(hit.dec)],
    ['高度', ''],
    ['方位', ''],
  );
  renderFacts(rows);
  const card = $('starCard');
  card.hidden = false;
  requestAnimationFrame(() => card.classList.add('open'));
}

function closeStar() {
  selected = null;
  const card = $('starCard');
  card.classList.remove('open');
  const hide = () => {
    if (!card.classList.contains('open')) card.hidden = true;
  };
  card.addEventListener('transitionend', hide, { once: true });
  setTimeout(hide, 300);
}

function refreshStar(lat, lst, precess) {
  if (!selected) return;
  const base = raDecToVec(selected.ra, selected.dec);
  const eq = selected.ofDate ? base : apply3(precess, base);
  const h = apply3(horizontalMatrix(lat, lst), eq);
  const alt = Math.asin(Math.max(-1, Math.min(1, h[2]))) * 180 / Math.PI;
  const az = normDeg(Math.atan2(h[0], h[1]) * 180 / Math.PI);
  const altEl = $('starAlt');
  const azEl = $('starAz');
  if (altEl) altEl.textContent = formatAlt(alt);
  if (azEl) azEl.textContent = formatAz(az);
}

$('starClose').addEventListener('click', closeStar);
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (zoomPower > 1) return;
  setRadius(viewRadius * (e.deltaY > 0 ? 1.12 : 0.88));
}, { passive: false });

function frame(now) {
  if (playing) {
    const dt = lastTick ? Math.min(100, now - lastTick) : 0;
    lastTick = now;
    const minutes = hereMode()
      ? Math.max(1, Math.min(1440, Number(dayMinutesEl.value) || 30))
      : Math.max(1, Number(minutesEl.value) || 30);
    const step = dt / (minutes * 60000);
    if (!hereMode() && fraction + step >= Math.floor(fraction) + 1) {
      fraction = Math.floor(fraction) + 1;
      playing = false;
      lastTick = 0;
      syncPlayButtons();
      updateFaintButton();
    } else {
      fraction += step;
    }
  } else {
    lastTick = 0;
  }
  const utc = skyDate();
  const here = observer();
  onLand = land.length ? isLand(land, here.lat, here.lon) : true;
  const jd = julianDate(utc);
  const lst = gmstDeg(jd) + here.lon;
  const sun = sunRaDec(jd);
  const moon = moonRaDec(jd);
  const planets = {
    venus: planetRaDec('venus', jd),
    mars: planetRaDec('mars', jd),
    jupiter: planetRaDec('jupiter', jd),
    saturn: planetRaDec('saturn', jd),
  };
  layout = renderer.draw({
    jd,
    precess: precessionMatrix(jd),
    lat: here.lat,
    lst,
    magLimit: Number(magEl.value),
    viewRadius,
    centerAlt,
    centerAz,
    northRot: Number(northEl.value),
    shade: Number(shadeEl.value),
    starScale: Number(starSizeEl.value),
    showLines: linesEl.checked,
    showNames: namesEl.checked,
    stars,
    faint,
    faintIndex,
    showFaint: faintLimit > 0 && !!faint,
    faintLimit,
    selected,
    sky,
    onLand,
    sun: { ra: sun[0], dec: sun[1] },
    moon,
    planets,
  }) || layout;
  hud(here, utc);
  globe.draw({
    lat: here.lat,
    lon: here.lon,
    route: hereMode() ? null : flightLine(),
    progress: fraction,
  });
  refreshStar(here.lat, lst, precessionMatrix(jd));
  updateFaintButton();
  requestAnimationFrame(frame);
}

async function boot() {
  try {
    const [starBuf, skyJson, landJson] = await Promise.all([
      fetch('data/stars8.bin').then((r) => { if (!r.ok) throw new Error('stars'); return r.arrayBuffer(); }),
      fetch('data/sky.json').then((r) => { if (!r.ok) throw new Error('sky'); return r.json(); }),
      fetch('data/land.geojson').then((r) => { if (!r.ok) throw new Error('land'); return r.json(); }),
    ]);
    stars = decodeStars(starBuf);
    sky = skyJson;
    land = prepareLand(landJson);
    globe.setLand(land);
    hudText.textContent = '町名を選ぶと、その場所から一周します';
  } catch (err) {
    hudText.textContent = '星のデータを読めませんでした。ページを開き直してください。';
    console.error(err);
  }
  try { await loadPref(prefEl.value, saved.placeName ? '' : '丸の内'); }
  catch { /* 緯度経度のままで空は出る */ }
  if (saved.placeName) placeName = saved.placeName;
  updateLabels();
  requestAnimationFrame(() => {
    lookSky(horizonAlt(), 180);
    requestAnimationFrame(frame);
  });
}

boot();
