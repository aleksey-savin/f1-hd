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

// Все значения, которые правила считают секретами, — сырьём, без игнор-листа.
// Наружу модуля не уходит: scanText превращает их в замаскированные находки,
// redactSecrets заменяет в тексте. Правила одни на оба пути.
const collectSecretValues = (text) => {
  if (!text || typeof text !== "string") {
    return [];
  }

  const values = []; // [{ category, value }]
  const seen = new Set(); // дедуп по значению (между правилами)

  const push = (category, rawValue) => {
    const value = String(rawValue).trim();
    if (value.length < 6 || isPlaceholder(value) || seen.has(value)) {
      return;
    }
    seen.add(value);
    values.push({ category, value });
  };

  // 1) Правила с известными форматами секретов
  for (const rule of PATTERN_RULES) {
    const regex = new RegExp(rule.regex.source, rule.regex.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      push(rule.id, match[1] !== undefined ? match[1] : match[0]);
      if (match.index === regex.lastIndex) {
        regex.lastIndex++;
      }
    }
  }

  // 2) Пароль-подобные значения рядом с ключевыми словами (RU/EN) — даже без «:»/«=».
  PROXIMITY_KEYWORDS.lastIndex = 0;
  let km;
  while ((km = PROXIMITY_KEYWORDS.exec(text)) !== null) {
    const start = Math.max(0, km.index - 30);
    const end = Math.min(text.length, km.index + km[0].length + 40);
    const windowText = text.slice(start, end);

    PASSWORDLIKE_TOKEN.lastIndex = 0;
    let pm;
    while ((pm = PASSWORDLIKE_TOKEN.exec(windowText)) !== null) {
      // Срезаем ведущую/замыкающую пунктуацию — иначе ловим «…ABCDEF.» с точкой.
      const token = pm[0].replace(
        /^[^A-Za-z0-9@#$%^&*!?+=]+|[^A-Za-z0-9@#$%^&*!?+=]+$/g,
        "",
      );
      if (looksLikePassword(token)) {
        push("password-near-keyword", token);
      }
    }

    if (km.index === PROXIMITY_KEYWORDS.lastIndex) {
      PROXIMITY_KEYWORDS.lastIndex++;
    }
  }

  // 3) «Сложные» токены (буква + цифра + сильный спецсимвол) в любом месте текста.
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
      push("password-like", token);
    }
  }

  // 4) Высокоэнтропийные одиночные токены, не пойманные правилами выше.
  const tokenRegex = /\b[A-Za-z0-9+/_-]{24,}={0,2}\b/g;
  let tokenMatch;
  while ((tokenMatch = tokenRegex.exec(text)) !== null) {
    const token = tokenMatch[0];
    if (seen.has(token)) {
      continue;
    }
    if (
      /[A-Za-z]/.test(token) &&
      /\d/.test(token) &&
      !isPlaceholder(token) &&
      shannonEntropy(token) >= 4.0
    ) {
      push("high-entropy-token", token);
    }
  }

  return values;
};

// Сканирует одну строку. location — где найдено ("title" | "content").
// ignoredHashes — хэши значений, помеченных модератором как «не секрет».
const scanText = (text, location = "content", ignoredHashes = []) => {
  const ignored = new Set((ignoredHashes || []).map(String));
  return collectSecretValues(text)
    .map(({ category, value }) => ({
      category,
      location,
      maskedSnippet: maskSecret(value),
      hash: hashValue(value),
    }))
    .filter((finding) => !ignored.has(finding.hash));
};

const REDACTED = "[секрет скрыт]";
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Заменяет найденные секреты в тексте — для выдачи ИИ-агенту (MCP). Длинные
// значения первыми: короткий пароль внутри длинного токена не должен оставить
// хвост токена на виду.
const redactSecrets = (text) => {
  if (!text || typeof text !== "string") {
    return { text: "", count: 0 };
  }
  const values = collectSecretValues(text)
    .map(({ value }) => value)
    .sort((a, b) => b.length - a.length);
  if (!values.length) {
    return { text, count: 0 };
  }
  let count = 0;
  const pattern = new RegExp(values.map(escapeRegExp).join("|"), "g");
  const redacted = text.replace(pattern, () => {
    count += 1;
    return REDACTED;
  });
  return { text: redacted, count };
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

module.exports = { scanText, scanNote, shannonEntropy, maskSecret, hashValue, redactSecrets };
