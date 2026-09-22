/*
 * FinanceBro — parser y categorizador de gastos.
 *
 * FUENTE ÚNICA: este archivo se usa tal cual en la webapp (web/parser.js)
 * y en Google Apps Script (gas/Parser.gs). Editá solo shared/parser.js y
 * corré tools/sync-parser.ps1 para copiarlo a los otros dos lugares.
 *
 * Sin dependencias ni módulos: todo es global para que funcione en
 * navegador, Apps Script y Node (vía module.exports al final).
 */

var DEFAULT_CATEGORIES = [
  { id: 'super', name: 'Súper', emoji: '🛒', keywords: [
    'super', 'supermercado', 'coto', 'dia', 'carrefour', 'jumbo', 'disco', 'vea', 'changomas',
    'chango mas', 'walmart', 'la anonima', 'libertad', 'chino', 'almacen', 'verduleria', 'verdura',
    'fruta', 'carniceria', 'carne', 'polleria', 'fiambreria', 'dietetica', 'mayorista', 'makro',
    'vital', 'diarco', 'maxiconsumo', 'yaguar', 'mercaderia', 'compras super', 'huevos', 'leche'
  ] },
  { id: 'comida', name: 'Comida y delivery', emoji: '🍔', keywords: [
    'comida', 'almuerzo', 'cena', 'desayuno', 'merienda', 'cafe', 'cafecito', 'starbucks', 'havanna',
    'mcdonalds', 'mc donalds', 'mostaza', 'burger', 'burger king', 'pizza', 'pizzeria', 'empanadas',
    'sushi', 'rappi', 'pedidosya', 'pedidos ya', 'delivery', 'resto', 'restaurant', 'restaurante',
    'bodegon', 'parrilla', 'panaderia', 'facturas', 'medialunas', 'helado', 'heladeria', 'kiosco',
    'golosinas', 'alfajor', 'bar', 'birra', 'cerveza', 'vino', 'sandwich', 'milanesa', 'hamburguesa',
    'lomito', 'choripan', 'vianda', 'tostado', 'mate', 'yerba'
  ] },
  { id: 'transporte', name: 'Transporte', emoji: '🚗', keywords: [
    'uber', 'cabify', 'didi', 'taxi', 'remis', 'sube', 'colectivo', 'bondi', 'subte', 'tren', 'nafta',
    'combustible', 'ypf', 'shell', 'axion', 'puma', 'gnc', 'estacionamiento', 'cochera', 'peaje',
    'autopista', 'telepeaje', 'patente', 'seguro auto', 'mecanico', 'service auto', 'gomeria',
    'lavadero', 'vtv', 'micro', 'pasaje', 'bici', 'monopatin'
  ] },
  { id: 'vivienda', name: 'Vivienda y servicios', emoji: '🏠', keywords: [
    'alquiler', 'expensas', 'luz', 'edenor', 'edesur', 'epec', 'gas', 'metrogas', 'naturgy', 'camuzzi',
    'agua', 'aysa', 'internet', 'wifi', 'fibertel', 'personal', 'movistar', 'claro', 'telecentro',
    'telefono', 'celular', 'abl', 'municipal', 'arba', 'impuesto', 'impuestos', 'monotributo',
    'plomero', 'electricista', 'ferreteria', 'pintureria', 'limpieza', 'empleada', 'mantenimiento',
    'mudanza', 'seguro hogar'
  ] },
  { id: 'salud', name: 'Salud', emoji: '💊', keywords: [
    'farmacia', 'farmacity', 'remedio', 'remedios', 'medicamento', 'ibuprofeno', 'osde', 'swiss medical',
    'galeno', 'medife', 'omint', 'prepaga', 'obra social', 'medico', 'doctor', 'dentista', 'odontologo',
    'psicologo', 'terapia', 'analisis', 'laboratorio', 'kinesiologo', 'oculista', 'anteojos', 'lentes',
    'consulta', 'guardia', 'vacuna'
  ] },
  { id: 'ocio', name: 'Ocio y salidas', emoji: '🎉', keywords: [
    'cine', 'teatro', 'recital', 'show', 'entrada', 'entradas', 'boliche', 'fiesta', 'salida', 'juego',
    'juegos', 'steam', 'playstation', 'xbox', 'nintendo', 'museo', 'viaje', 'hotel', 'airbnb', 'vacaciones',
    'escapada', 'regalo', 'regalos', 'cumple', 'cumpleanos', 'libro', 'libros', 'futbol', 'cancha', 'padel',
    'bowling', 'karaoke', 'turismo', 'excursion'
  ] },
  { id: 'compras', name: 'Compras', emoji: '🛍️', keywords: [
    'ropa', 'zapatillas', 'zapatos', 'remera', 'pantalon', 'campera', 'buzo', 'jean', 'vestido', 'zara',
    'mercadolibre', 'mercado libre', 'meli', 'amazon', 'shein', 'temu', 'aliexpress', 'falabella', 'fravega',
    'garbarino', 'musimundo', 'electro', 'shopping', 'cosmetica', 'maquillaje', 'perfume', 'perfumeria',
    'peluqueria', 'corte de pelo', 'barberia', 'manicura', 'unas', 'depilacion', 'accesorios', 'bazar',
    'muebles', 'deco', 'easy', 'sodimac'
  ] },
  { id: 'suscripciones', name: 'Suscripciones', emoji: '📺', keywords: [
    'netflix', 'spotify', 'disney', 'disney+', 'hbo', 'max', 'star+', 'prime', 'prime video', 'youtube',
    'youtube premium', 'apple', 'icloud', 'apple music', 'google one', 'chatgpt', 'claude', 'paramount',
    'crunchyroll', 'flow', 'directv', 'dgo', 'suscripcion', 'membresia', 'gimnasio', 'gym', 'megatlon',
    'smartfit', 'patreon', 'canva', 'office', 'microsoft 365'
  ] },
  { id: 'educacion', name: 'Educación', emoji: '📚', keywords: [
    'curso', 'cursos', 'facultad', 'universidad', 'uba', 'colegio', 'escuela', 'cuota colegio', 'jardin',
    'matricula', 'clases', 'clase', 'profesor', 'ingles', 'idioma', 'udemy', 'coursera', 'platzi',
    'libreria', 'utiles', 'fotocopias', 'apuntes', 'taller', 'seminario'
  ] },
  { id: 'mascotas', name: 'Mascotas', emoji: '🐾', keywords: [
    'veterinaria', 'veterinario', 'vet', 'alimento perro', 'alimento gato', 'balanceado', 'pipeta',
    'antipulgas', 'peluqueria canina', 'petshop', 'pet shop', 'piedritas', 'arena gato', 'perro', 'gato',
    'mascota', 'paseador'
  ] },
  { id: 'otros', name: 'Otros', emoji: '📦', keywords: [] }
];

var FALLBACK_CATEGORY = 'otros';

// Palabras que no describen el gasto: se ignoran al armar la descripción
// y al elegir la palabra que se "aprende".
var STOPWORDS = [
  'gaste', 'gasto', 'gastos', 'pague', 'pago', 'compre', 'compra', 'en', 'de', 'del', 'la', 'el', 'los',
  'las', 'un', 'una', 'unos', 'unas', 'con', 'para', 'por', 'y', 'a', 'al', 'mi', 'mis', 'hoy', 'ayer',
  'anteayer', 'antes', 'pesos', 'peso', 'ars', 'que', 'se', 'me', 'le', 'lo', 'es', 'fue', 'son', 'total'
];

function normalizeText(s) {
  return String(s == null ? '' : s)
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9ñ+#\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ---------- Fechas (siempre strings 'YYYY-MM-DD', sin zonas horarias) ---------- */

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function addDays(isoDate, delta) {
  var p = isoDate.split('-');
  var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2] + delta));
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

function daysInMonth(month) { // month = 'YYYY-MM'
  var p = month.split('-');
  return new Date(Date.UTC(+p[0], +p[1], 0)).getUTCDate();
}

function isValidDate(y, m, d) {
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= daysInMonth(y + '-' + pad2(m));
}

/* ---------- Montos ---------- */

var MULTIPLIERS = {
  k: 1000, mil: 1000, luca: 1000, lucas: 1000,
  palo: 1000000, palos: 1000000, millon: 1000000, millones: 1000000, m: 1000000
};

// Convierte "3.500", "12.000,50", "1,5", "1.5", "3500" a número.
function toNumber(raw, hasMultiplier) {
  var s = raw;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) {           // 12.000 / 12.000,50
    return parseFloat(s.replace(/\./g, '').replace(',', '.'));
  }
  if (!hasMultiplier && /^\d{1,3}(,\d{3})+$/.test(s)) {  // 12,000 (estilo inglés)
    return parseFloat(s.replace(/,/g, ''));
  }
  return parseFloat(s.replace(',', '.'));                 // 1,5 / 1.5 / 3500
}

var AMOUNT_RE = /(\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?)(?:\s*(k|mil|lucas?|palos?|millon(?:es)?|m)(?![a-z]))?/g;

function findAmounts(text) {
  var out = [];
  var m;
  AMOUNT_RE.lastIndex = 0;
  while ((m = AMOUNT_RE.exec(text)) !== null) {
    // Evita tomar números pegados a letras ("covid19", "4g").
    var before = text.charAt(m.index - 1);
    var after = text.charAt(m.index + m[0].length);
    if (!m[1] && /[a-z]/.test(before)) continue;
    if (!m[3] && /[a-z]/.test(after)) continue;
    var mult = m[3] ? MULTIPLIERS[m[3]] : 1;
    var value = toNumber(m[2], !!m[3]) * mult;
    if (!isFinite(value) || value <= 0) continue;
    out.push({
      value: Math.round(value * 100) / 100,
      start: m.index,
      end: m.index + m[0].length,
      strong: !!(m[1] || m[3]) // tiene $ o multiplicador → casi seguro es el monto
    });
  }
  return out;
}

/* ---------- Categorías ---------- */

function findCategory(query, categories) {
  var q = normalizeText(query).replace(/^#/, '');
  if (!q) return null;
  for (var i = 0; i < categories.length; i++) {
    if (normalizeText(categories[i].id) === q || normalizeText(categories[i].name) === q) return categories[i].id;
  }
  for (var j = 0; j < categories.length; j++) {
    var n = normalizeText(categories[j].name);
    if (n.indexOf(q) === 0 || normalizeText(categories[j].id).indexOf(q) === 0) return categories[j].id;
  }
  return null;
}

// ¿La palabra/frase clave aparece en el texto como palabra completa?
// Palabras de 4+ letras también matchean plurales/derivados por prefijo ("cafes" → "cafe").
function keywordMatches(padded, tokens, kw) {
  if (!kw) return false;
  if (kw.indexOf(' ') >= 0) return padded.indexOf(' ' + kw + ' ') >= 0;
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (t === kw) return true;
    if (kw.length >= 4 && t.indexOf(kw) === 0 && t.length - kw.length <= 2) return true;
  }
  return false;
}

/*
 * rules: [{ keyword, category }] aprendidas por el usuario (tienen prioridad).
 * Gana la coincidencia más larga (más específica).
 */
function categorize(description, rules, categories) {
  categories = categories || DEFAULT_CATEGORIES;
  var text = normalizeText(description);
  var tokens = text.split(' ');
  var padded = ' ' + text + ' ';
  var validIds = {};
  for (var c = 0; c < categories.length; c++) validIds[categories[c].id] = true;

  var best = null;
  var list = rules || [];
  for (var i = 0; i < list.length; i++) {
    var kw = normalizeText(list[i].keyword);
    if (validIds[list[i].category] && keywordMatches(padded, tokens, kw) && (!best || kw.length > best.len)) {
      best = { id: list[i].category, len: kw.length, source: 'rule' };
    }
  }
  if (best) return best;

  // Las categorías sin keywords propias (personalizadas) heredan las de la categoría por defecto con el mismo id.
  var defaultsById = {};
  for (var d = 0; d < DEFAULT_CATEGORIES.length; d++) defaultsById[DEFAULT_CATEGORIES[d].id] = DEFAULT_CATEGORIES[d].keywords;
  for (var k = 0; k < categories.length; k++) {
    var kws = categories[k].keywords || defaultsById[categories[k].id] || [];
    for (var w = 0; w < kws.length; w++) {
      var nk = normalizeText(kws[w]);
      if (keywordMatches(padded, tokens, nk) && (!best || nk.length > best.len)) {
        best = { id: categories[k].id, len: nk.length, source: 'keyword' };
      }
    }
  }
  if (best) return best;
  var fallback = validIds[FALLBACK_CATEGORY] ? FALLBACK_CATEGORY : categories[categories.length - 1].id;
  return { id: fallback, len: 0, source: 'fallback' };
}

// Palabra que se guarda como regla cuando el usuario corrige una categoría.
function learnKeyword(description) {
  var tokens = normalizeText(description).split(' ');
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (t.length >= 3 && STOPWORDS.indexOf(t) < 0 && !/^\d/.test(t) && t.charAt(0) !== '#') return t;
  }
  return null;
}

/* ---------- Parser principal ---------- */

/*
 * parseExpense('uber 8k ayer', { today: '2026-09-22', rules: [...], categories: [...] })
 * → { ok, amount, description, category, categorySource, date, error }
 */
function parseExpense(input, opts) {
  opts = opts || {};
  var categories = opts.categories || DEFAULT_CATEGORIES;
  var today = opts.today;
  var original = String(input == null ? '' : input).trim();
  // Minúsculas y sin tildes, pero conservando . , $ / # para montos y fechas.
  var text = original.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  var result = { ok: false, amount: null, description: '', category: null, categorySource: null, date: today, error: null };
  if (!text) { result.error = 'Escribí un gasto, por ejemplo: café 3500'; return result; }

  // Categoría forzada con #
  var forced = null;
  text = text.replace(/#([a-z0-9ñ+]+)/g, function (_, tag) {
    var id = findCategory(tag, categories);
    if (id) forced = id;
    return ' ';
  });

  // Fecha: dd/mm o dd/mm/aaaa
  text = text.replace(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, function (all, d, m, y) {
    var year = y ? (+y < 100 ? 2000 + (+y) : +y) : (today ? +today.slice(0, 4) : new Date().getFullYear());
    if (!isValidDate(year, +m, +d)) return all;
    var iso = year + '-' + pad2(+m) + '-' + pad2(+d);
    // Sin año y en el futuro → era del año pasado ("28/12" escrito en enero).
    if (!y && today && iso > today) iso = (year - 1) + '-' + pad2(+m) + '-' + pad2(+d);
    result.date = iso;
    return ' ';
  });

  // Fechas relativas
  if (today) {
    if (/\b(anteayer|antes de ayer|antesdeayer)\b/.test(text)) result.date = addDays(today, -2);
    else if (/\bayer\b/.test(text)) result.date = addDays(today, -1);
  }
  text = text.replace(/\b(anteayer|antes de ayer|antesdeayer|ayer|hoy)\b/g, ' ');

  // Monto: el que tiene $ o multiplicador; si no, el más grande.
  var amounts = findAmounts(text);
  if (!amounts.length) {
    result.error = 'No encontré el monto. Ejemplo: café 3500';
    return result;
  }
  var chosen = null;
  for (var i = 0; i < amounts.length; i++) {
    if (amounts[i].strong && (!chosen || !chosen.strong || amounts[i].value > chosen.value)) chosen = amounts[i];
  }
  if (!chosen) {
    for (var j = 0; j < amounts.length; j++) if (!chosen || amounts[j].value > chosen.value) chosen = amounts[j];
  }
  result.amount = chosen.value;
  text = text.slice(0, chosen.start) + ' ' + text.slice(chosen.end);

  // Descripción: lo que queda, sin palabras de relleno al principio/final.
  var words = text.replace(/[$]/g, ' ').replace(/[^a-z0-9ñ+\s.,&'-]/g, ' ').split(/\s+/).filter(Boolean);
  while (words.length && STOPWORDS.indexOf(words[0]) >= 0) words.shift();
  while (words.length && STOPWORDS.indexOf(words[words.length - 1]) >= 0) words.pop();
  var description = words.join(' ').replace(/^[.,\-\s]+|[.,\-\s]+$/g, '');
  description = restoreAccents(description, original);

  var cat;
  if (forced) cat = { id: forced, source: 'tag' };
  else cat = categorize(description, opts.rules, categories);

  if (!description) {
    for (var c = 0; c < categories.length; c++) if (categories[c].id === cat.id) description = categories[c].name;
  }
  result.description = description.charAt(0).toUpperCase() + description.slice(1);
  result.category = cat.id;
  result.categorySource = cat.source;
  result.ok = true;
  return result;
}

// Recupera las tildes/ñ del texto original para cada palabra de la descripción ("cafe" → "café").
function restoreAccents(description, original) {
  if (!description) return description;
  var origWords = original.split(/\s+/);
  var map = {};
  for (var i = 0; i < origWords.length; i++) {
    var w = origWords[i].replace(/^[^\wÀ-ÿ]+|[^\wÀ-ÿ]+$/g, '');
    var key = w.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    if (key && !map[key]) map[key] = w.toLowerCase();
  }
  return description.split(' ').map(function (w) { return map[w] || w; }).join(' ');
}

/* ---------- Formato ---------- */

function formatARS(n) {
  var neg = n < 0;
  var abs = Math.abs(n);
  var hasCents = Math.round(abs * 100) % 100 !== 0;
  var parts = (hasCents ? abs.toFixed(2) : String(Math.round(abs))).split('.');
  var int = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + '$' + int + (hasCents ? ',' + parts[1] : '');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    DEFAULT_CATEGORIES: DEFAULT_CATEGORIES, parseExpense: parseExpense, categorize: categorize,
    learnKeyword: learnKeyword, normalizeText: normalizeText, findCategory: findCategory,
    addDays: addDays, daysInMonth: daysInMonth, formatARS: formatARS
  };
}
