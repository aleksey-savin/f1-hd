const crypto = require("crypto");

// Поиск утечек секретов в заметках базы знаний без ИИ — только регулярные
// выражения и оценка энтропии Шеннона. Корпус правил основан на общеизвестных
// форматах (gitleaks / detect-secrets), плюс эвристика «присваивание секрета»,
// «пароль рядом с ключевым словом» и высокоэнтропийные токены. Сырой секрет
// наружу не отдаём — только тип правила, место (title/content), замаскированный
// фрагмент и хэш значения (для дедупа и игнор-листа).

// Правила с известными форматами секретов. Если у правила есть группа захвата,
// в качестве значения берём её (для «присваиваний» — само значение справа).
const PATTERN_RULES = [
  {
    id: "private-key-block",
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  { id: "aws-access-key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "google-api-key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: "stripe-key", regex: /\b(?:sk|rk)_(?:live|test)_[0-9A-Za-z]{16,}\b/g },
  { id: "slack-token", regex: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/g },
  { id: "github-token", regex: /\bgh[pousr]_[0-9A-Za-z]{36,}\b/g },
  {
    id: "jwt",
    regex:
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
  },
  {
    id: "generic-api-key",
    // ключ: значение / ключ = "значение" (в т.ч. русские «пароль», «логин»)
    regex:
      /(?:api[_-]?key|secret|token|passwd|password|pwd|client[_-]?secret|пароль|логин)\s*[:=]\s*["']?([^\s"'<>]{8,})["']?/gi,
  },
];

// Ключевые слова, рядом с которыми ищем «пароль-подобные» значения даже без
// явного присваивания (RU + EN). Ловит «Пароль от роутера R00tP@$$-pass».
const PROXIMITY_KEYWORDS =
  /(?:парол\w*|пасс\w*|логин\w*|секрет\w*|ключ\w*|токен\w*|password|passwd|pwd|pass|login|secret|api[_-]?key|token|credential)/gi;

// Пароль-подобный токен: 6–40 символов из набора, допускающего спецсимволы
const PASSWORDLIKE_TOKEN = /[A-Za-z0-9@#$%^&*!?_.+/=-]{6,40}/g;

// Эвристика «похоже на пароль»: есть буква и (цифра или «сильный» спецсимвол).
// Слабые разделители (_ . - /) не считаем — иначе сработают сами ключевые слова
// вроде api_key / client_secret и версии вроде v1.2.3.
const looksLikePassword = (token) =>
  /[A-Za-z]/.test(token) && (/[0-9]/.test(token) || /[@#$%^&*!?+=]/.test(token));

// «Сложный» токен: буква + цифра + сильный спецсимвол. Похоже на пароль даже без
// ключевого слова рядом — ловит таблицы «логин/пароль» (Kap2022#, Mis2025$ …).
// Письма и URL исключаем (там тоже бывают буква+цифра+символ).
const COMPLEX_TOKEN = /[A-Za-z0-9@#$%^&*!?+=_./-]{6,40}/g;
const looksLikeComplexSecret = (token) =>
  /[A-Za-z]/.test(token) &&
  /[0-9]/.test(token) &&
  /[@#$%^&*!?+=]/.test(token);
const looksLikeEmail = (token) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(token);
const looksLikeUrl = (token) => /:\/\//.test(token);

// Хэш значения — для дедупа и игнор-листа. Сырой секрет не храним.
const hashValue = (value) =>
  crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 16);

// Очевидные заглушки — не считаем секретами
const PLACEHOLDER_PATTERNS = [
  /^x+$/i,
  /^<.*>$/,
  /example/i,
  /changeme/i,
  /placeholder/i,
  /your[_-]?(?:key|token|secret|password|api)/i,
  /^(?:test|demo|sample|dummy|none|null|undefined)$/i,
  /^\*+$/,
  /^(.)\1+$/, // все символы одинаковые (aaaaaaaa, 00000000)
];

const isPlaceholder = (value) =>
  PLACEHOLDER_PATTERNS.some((re) => re.test(value));

// Энтропия Шеннона (бит на символ) — мера «случайности» строки
const shannonEntropy = (str) => {
  if (!str) return 0;
  const freq = {};
  for (const ch of str) {
    freq[ch] = (freq[ch] || 0) + 1;
  }
  return Object.values(freq).reduce((entropy, count) => {
    const p = count / str.length;
    return entropy - p * Math.log2(p);
  }, 0);
};

// Маскируем секрет: оставляем первые/последние 4 символа, середину — точками
const maskSecret = (value) => {
  const str = String(value);
  if (str.length <= 8) {
    return str.slice(0, 1) + "•".repeat(Math.max(str.length - 1, 0));
  }
  const head = str.slice(0, 4);
  const tail = str.slice(-4);
  return `${head}${"•".repeat(Math.min(str.length - 8, 12))}${tail}`;
};

// Сканирует одну строку. location — где найдено ("title" | "content").
// ignoredHashes — хэши значений, помеченных модератором как «не секрет».
const scanText = (text, location = "content", ignoredHashes = []) => {
  if (!text || typeof text !== "string") {
    return [];
  }

  const findings = [];
  const foundValues = new Set(); // дедуп по значению (между правилами)
  const ignored = new Set((ignoredHashes || []).map(String));

  const pushFinding = (category, rawValue) => {
    const value = String(rawValue).trim();
    if (value.length < 6 || isPlaceholder(value)) {
      return;
    }
    if (foundValues.has(value)) {
      return; // значение уже найдено другим правилом
    }
    foundValues.add(value);
    const hash = hashValue(value);
    if (ignored.has(hash)) {
      return; // модератор пометил это значение как «не секрет»
    }
    findings.push({
      category,
      location,
      maskedSnippet: maskSecret(value),
      hash,
    });
  };

  // 1) Правила с известными форматами секретов
  for (const rule of PATTERN_RULES) {
    const regex = new RegExp(rule.regex.source, rule.regex.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      const value = match[1] !== undefined ? match[1] : match[0];
      pushFinding(rule.id, value);
      if (match.index === regex.lastIndex) {
        regex.lastIndex++;
      }
    }
  }

  // 2) Пароль-подобные значения рядом с ключевыми словами (RU/EN) — даже без «:»/«=».
  // Берём окно вокруг каждого ключевого слова и ищем в нём пароль-подобные токены.
  PROXIMITY_KEYWORDS.lastIndex = 0;
  let km;
  while ((km = PROXIMITY_KEYWORDS.exec(text)) !== null) {
    const start = Math.max(0, km.index - 30);
    const end = Math.min(text.length, km.index + km[0].length + 40);
    const windowText = text.slice(start, end);

    PASSWORDLIKE_TOKEN.lastIndex = 0;
    let pm;
    while ((pm = PASSWORDLIKE_TOKEN.exec(windowText)) !== null) {
      // Срезаем ведущую/замыкающую пунктуацию (точки, скобки, кавычки), оставляя
      // буквы, цифры и «сильные» спецсимволы. Иначе ловим «…ABCDEF.» с точкой и
      // дублируем находки точных правил (другое значение → другой хэш).
      const token = pm[0].replace(
        /^[^A-Za-z0-9@#$%^&*!?+=]+|[^A-Za-z0-9@#$%^&*!?+=]+$/g,
        "",
      );
      if (looksLikePassword(token)) {
        pushFinding("password-near-keyword", token);
      }
    }

    if (km.index === PROXIMITY_KEYWORDS.lastIndex) {
      PROXIMITY_KEYWORDS.lastIndex++;
    }
  }

  // 3) «Сложные» токены (буква + цифра + сильный спецсимвол) в любом месте текста —
  // ловит таблицы логин/пароль, где значение не сопровождается ключевым словом.
  COMPLEX_TOKEN.lastIndex = 0;
  let complexMatch;
  while ((complexMatch = COMPLEX_TOKEN.exec(text)) !== null) {
    const token = complexMatch[0].replace(
      /^[^A-Za-z0-9@#$%^&*!?+=]+|[^A-Za-z0-9@#$%^&*!?+=]+$/g,
      "",
    );
    if (
      looksLikeComplexSecret(token) &&
      !token.includes("/") && // пути/URL — не пароли
      !looksLikeEmail(token) &&
      !looksLikeUrl(token)
    ) {
      pushFinding("password-like", token);
    }
  }

  // 4) Высокоэнтропийные одиночные токены, не пойманные правилами выше.
  // Требуем смешанный состав (буквы + цифры) и высокий порог энтропии.
  const tokenRegex = /\b[A-Za-z0-9+/_-]{24,}={0,2}\b/g;
  let tokenMatch;
  while ((tokenMatch = tokenRegex.exec(text)) !== null) {
    const token = tokenMatch[0];
    if (foundValues.has(token)) {
      continue;
    }
    const hasLetter = /[A-Za-z]/.test(token);
    const hasDigit = /\d/.test(token);
    if (
      hasLetter &&
      hasDigit &&
      !isPlaceholder(token) &&
      shannonEntropy(token) >= 4.0
    ) {
      pushFinding("high-entropy-token", token);
    }
  }

  return findings;
};

// Сканирует заметку (заголовок + plainText без markdown-разметки).
// ignoredHashes — список «не секрет» из note.secretsScan.ignoredHashes.
const scanNote = (note, ignoredHashes = []) => {
  if (!note) {
    return [];
  }
  const findings = [
    ...scanText(note.title, "title", ignoredHashes),
    ...scanText(note.plainText, "content", ignoredHashes),
  ];
  // Ограничиваем размер, чтобы не раздувать документ на «бинарных» заметках
  return findings.slice(0, 25);
};

module.exports = { scanText, scanNote, shannonEntropy, maskSecret, hashValue };
