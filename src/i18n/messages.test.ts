import { describe, expect, it } from "vitest";
import {
  LOCALES,
  createT,
  messages,
  htmlLangForLocale,
  intlLocale,
  isTightScript,
  migrateLegacyLocaleDefault,
  parseLocalePreference,
  readSystemLangTag,
  resolveLocale,
  resolveLocaleFromSystem,
  resolveLocalePreference,
  t,
  type MessageKey,
} from "./index";

describe("i18n catalog", () => {
  it("every shipped locale has exactly the en key set", () => {
    const enKeys = Object.keys(messages.en).sort();
    for (const loc of LOCALES) {
      expect(Object.keys(messages[loc]).sort(), loc).toEqual(enKeys);
    }
  });

  it("ships the product locale set", () => {
    expect([...LOCALES].sort()).toEqual(
      [
        "de",
        "en",
        "es",
        "fil",
        "fr",
        "id",
        "it",
        "ja",
        "ko",
        "pt-BR",
        "ru",
        "ta",
        "uk",
        "zh",
        "zh-TW",
      ].sort(),
    );
  });

  it("registers every locale in the picker order used by Settings", () => {
    // English first — the rest are grouped by script in GeneralSection.
    expect(LOCALES[0]).toBe("en");
    expect(new Set(LOCALES).size).toBe(LOCALES.length);
  });

  it("interpolates variables", () => {
    expect(t("en", "project.trustFirst", { name: "Demo" })).toContain("Demo");
    expect(t("zh", "project.trustFirst", { name: "演示" })).toContain("演示");
    expect(t("ru", "sidebar.selectedCount", { n: 3 })).toContain("3");
  });

  it("createT binds locale (English is the product default)", () => {
    const tr = createT("en");
    expect(tr("sidebar.settings")).toBe("Settings");
    const zh = createT("zh");
    expect(zh("sidebar.settings")).toBe("设置");
    const ru = createT("ru");
    expect(ru("sidebar.settings")).toBe("Настройки");
  });

  it("keeps high-traffic Russian domains translated instead of falling back to English", () => {
    const keys: MessageKey[] = [
      "project.pin",
      "main.startTitle",
      "session.rename",
      "resources.title",
      "changes.title",
      "search.title",
      "tasks.title",
      "dashboard.title",
      "slash.settings",
      "settings.language",
      "account.signedIn",
      "prov.emptyTitle",
      "automations.title",
      "doctor.title",
      "ext.plugins.title",
      "ext.mcp.title",
      "ext.market.loading",
      "error.details",
    ];
    for (const key of keys) {
      expect(messages.ru[key], key).not.toBe(messages.en[key]);
    }
  });

  it("every value is a non-empty string", () => {
    for (const loc of LOCALES) {
      for (const [k, v] of Object.entries(messages[loc])) {
        expect(v.trim().length, `${loc}.${k}`).toBeGreaterThan(0);
      }
    }
  });

  it("non-Chinese catalogs do not copy Simplified Chinese values", () => {
    // A catalog value that equals `zh` and contains simplified-only Han
    // (无/设/渠/话/…) is never correct Japanese or Korean. Shared
    // shinjitai (保存, 国内, 独立) matches `zh` and differs from `zh-TW`
    // without using those characters, so it is not flagged. Language
    // names and Volcano product titles are deliberately Chinese.
    const exclude = new Set<MessageKey>([
      "settings.sttLanguage.zhCN",
      "settings.sttLanguage.zhTW",
      "settings.terminalFontPreview",
    ]);
    // Simplified forms that are not Japanese shinjitai / not Hangul-adjacent Han.
    const simplifiedOnly =
      /[无与为这们吗么还对从经现里后发长门页选项语说话请认问间开关东车来时户启钱钥锁队际网览视频图传输链接远程进让给把着该种样没汉汇义书买卖乐习乡乱亚产亩亲亿仅仑仓伦侦侧侨俭债倾偿儿党兰关兴养兽冈册写军农冯冲决况冻净准凉减几凤凭凯击凿划刘则刚创剂剑剥剧劝办务动励劲劳势勋区医华协单卖卫厅历厉压厌厕厢厦厨县参双变叙叠叶号叹吓吕吨听启吴呕员呛呜咏咙咛响哑哗哟唤啧啬啰啸喷喽嘱团园围设渠]/;
    const leaked: string[] = [];
    for (const loc of LOCALES) {
      if (loc === "en" || loc === "zh" || loc === "zh-TW") continue;
      for (const [k, v] of Object.entries(messages[loc])) {
        const key = k as MessageKey;
        if (exclude.has(key) || key.startsWith("prov.preset.volcanoArk.")) {
          continue;
        }
        if (v === messages.zh[key] && simplifiedOnly.test(v)) {
          leaked.push(`${loc}.${key}`);
        }
      }
    }
    expect(
      leaked,
      `${leaked.length} simplified-Chinese leaks, e.g. ${leaked.slice(0, 8).join(", ")}`,
    ).toEqual([]);
  });

  it("every locale keeps the placeholders its en string declares", () => {
    // `t()` substitutes by name, so a translation that drops `{name}` renders
    // without the value and one that renames it renders the literal braces.
    // Neither is a missing key, so nothing else catches it: `prHub.author`
    // read "作成者" with no author, and the Ukrainian
    // `--agent {name}` shipped as a command with no agent to copy.
    const named = /\{[A-Za-z_][A-Za-z0-9_]*\}/g;
    const placeholders = (s: string) =>
      [...s.matchAll(named)]
        .map((m) => m[0])
        .sort()
        .join(",");
    const broken: string[] = [];
    for (const loc of LOCALES) {
      if (loc === "en") continue;
      for (const [k, v] of Object.entries(messages.en)) {
        const want = placeholders(v);
        const got = placeholders(messages[loc][k as MessageKey]);
        if (want !== got) {
          broken.push(`${loc}.${k}: en has [${want}], ${loc} has [${got}]`);
        }
      }
    }
    expect(
      broken,
      `${broken.length} placeholder mismatches: ${broken.join("; ")}`,
    ).toEqual([]);
  });

  it("translates the always-visible chrome in every locale", () => {
    // These render on first paint in every session, so a locale that still
    // falls back to English here is not usable as a UI language.
    const keys: MessageKey[] = [
      "window.close",
      "common.cancel",
      "sidebar.settings",
      "sidebar.search",
      "sidebar.projects",
      "conn.ready",
      "perm.allowOnce",
      "tray.newChat",
      "error.action.retry",
      "kanban.column.done",
    ];
    for (const loc of LOCALES) {
      if (loc === "en") continue;
      for (const key of keys) {
        expect(messages[loc][key], `${loc}.${key}`).not.toBe(messages.en[key]);
      }
    }
  });

  it("keeps interpolation placeholders intact across locales", () => {
    // A dropped `{n}` silently prints a sentence with a hole in it.
    const cases: Array<[MessageKey, string[]]> = [
      ["sidebar.selectedCount", ["{n}"]],
      ["perm.autoDenyCountdown", ["{seconds}"]],
      ["compact.tokensRange", ["{before}", "{after}"]],
      ["tray.usageWithReset", ["{pct}", "{time}"]],
      ["app.quitBusy.message", ["{n}"]],
      ["fileCard.code", ["{ext}"]],
    ];
    for (const loc of LOCALES) {
      for (const [key, vars] of cases) {
        for (const v of vars) {
          expect(messages[loc][key], `${loc}.${key} missing ${v}`).toContain(v);
        }
      }
    }
  });

  it("type surface accepts known keys only", () => {
    const key: MessageKey = "composer.send";
    expect(t("en", key)).toBeTruthy();
  });
});

describe("resolveLocale", () => {
  it("keeps canonical ids unchanged", () => {
    expect(resolveLocale("zh-TW")).toBe("zh-TW");
    expect(resolveLocale("zh")).toBe("zh");
    expect(resolveLocale("ru")).toBe("ru");
    expect(resolveLocale("en")).toBe("en");
  });

  it("accepts case/alias variants of Traditional Chinese", () => {
    expect(resolveLocale("zh-tw")).toBe("zh-TW");
    expect(resolveLocale("zh_TW")).toBe("zh-TW");
    expect(resolveLocale("zh-Hant")).toBe("zh-TW");
    expect(resolveLocale(" ZH-HANT ")).toBe("zh-TW");
  });

  it("accepts case/alias variants of Simplified Chinese, Russian and English", () => {
    expect(resolveLocale("ZH")).toBe("zh");
    expect(resolveLocale("zh-CN")).toBe("zh");
    expect(resolveLocale("RU-RU")).toBe("ru");
    expect(resolveLocale("ru_RU")).toBe("ru");
    expect(resolveLocale("EN-US")).toBe("en");
  });

  it("keeps every shipped catalog id unchanged", () => {
    for (const loc of LOCALES) {
      expect(resolveLocale(loc), loc).toBe(loc);
    }
  });

  it("accepts regional and case variants of the added locales", () => {
    expect(resolveLocale("ja-JP")).toBe("ja");
    expect(resolveLocale("ko_KR")).toBe("ko");
    expect(resolveLocale("DE-AT")).toBe("de");
    expect(resolveLocale("pt")).toBe("pt-BR");
    expect(resolveLocale("pt-PT")).toBe("pt-BR");
    expect(resolveLocale("tl")).toBe("fil");
    expect(resolveLocale("in")).toBe("id");
    expect(resolveLocale("ta-LK")).toBe("ta");
  });

  it("falls back to the product default for unsupported languages", () => {
    expect(resolveLocale("he")).toBe("en");
    expect(resolveLocale("th-TH")).toBe("en");
    expect(resolveLocale("xx")).toBe("en");
  });

  it("treats empty or missing ids as follow-system", () => {
    const system = resolveLocalePreference("system");
    expect(resolveLocale("")).toBe(system);
    expect(resolveLocale(undefined)).toBe(system);
    expect(resolveLocale(null)).toBe(system);
    expect(resolveLocale("system")).toBe(system);
  });
});

describe("resolveLocaleFromSystem", () => {
  it("maps English tags to en", () => {
    expect(resolveLocaleFromSystem("en")).toBe("en");
    expect(resolveLocaleFromSystem("en-US")).toBe("en");
    expect(resolveLocaleFromSystem("en_GB")).toBe("en");
    expect(resolveLocaleFromSystem("en-AU")).toBe("en");
  });

  it("maps Russian tags to ru", () => {
    expect(resolveLocaleFromSystem("ru")).toBe("ru");
    expect(resolveLocaleFromSystem("ru-RU")).toBe("ru");
    expect(resolveLocaleFromSystem("ru_RU")).toBe("ru");
    expect(resolveLocaleFromSystem("ru_RU.UTF-8")).toBe("ru");
  });

  it("maps Simplified Chinese tags to zh", () => {
    expect(resolveLocaleFromSystem("zh")).toBe("zh");
    expect(resolveLocaleFromSystem("zh-CN")).toBe("zh");
    expect(resolveLocaleFromSystem("zh_CN")).toBe("zh");
    expect(resolveLocaleFromSystem("zh-Hans")).toBe("zh");
    expect(resolveLocaleFromSystem("zh-Hans-CN")).toBe("zh");
    expect(resolveLocaleFromSystem("zh-SG")).toBe("zh");
    expect(resolveLocaleFromSystem("zh_CN.UTF-8")).toBe("zh");
  });

  it("maps Traditional Chinese tags to zh-TW", () => {
    expect(resolveLocaleFromSystem("zh-TW")).toBe("zh-TW");
    expect(resolveLocaleFromSystem("zh_TW")).toBe("zh-TW");
    expect(resolveLocaleFromSystem("zh-Hant")).toBe("zh-TW");
    expect(resolveLocaleFromSystem("zh-Hant-TW")).toBe("zh-TW");
    expect(resolveLocaleFromSystem("zh-HK")).toBe("zh-TW");
    expect(resolveLocaleFromSystem("zh-MO")).toBe("zh-TW");
    expect(resolveLocaleFromSystem("zh_TW.UTF-8")).toBe("zh-TW");
  });

  it("maps the added OS languages to their catalog", () => {
    // A user on a Japanese or German desktop must land in that language
    // without visiting Settings.
    expect(resolveLocaleFromSystem("ja-JP")).toBe("ja");
    expect(resolveLocaleFromSystem("ja_JP.UTF-8")).toBe("ja");
    expect(resolveLocaleFromSystem("ko-KR")).toBe("ko");
    expect(resolveLocaleFromSystem("de-DE")).toBe("de");
    expect(resolveLocaleFromSystem("de_AT")).toBe("de");
    expect(resolveLocaleFromSystem("es-MX")).toBe("es");
    expect(resolveLocaleFromSystem("fr-CA")).toBe("fr");
    expect(resolveLocaleFromSystem("it-IT")).toBe("it");
    expect(resolveLocaleFromSystem("uk-UA")).toBe("uk");
    expect(resolveLocaleFromSystem("id-ID")).toBe("id");
    expect(resolveLocaleFromSystem("fil-PH")).toBe("fil");
    expect(resolveLocaleFromSystem("ta-IN")).toBe("ta");
  });

  it("folds every Portuguese variant into pt-BR", () => {
    expect(resolveLocaleFromSystem("pt")).toBe("pt-BR");
    expect(resolveLocaleFromSystem("pt-BR")).toBe("pt-BR");
    expect(resolveLocaleFromSystem("pt-PT")).toBe("pt-BR");
    expect(resolveLocaleFromSystem("pt_BR.UTF-8")).toBe("pt-BR");
  });

  it("falls back to en for unsupported or empty tags", () => {
    expect(resolveLocaleFromSystem("he-IL")).toBe("en");
    expect(resolveLocaleFromSystem("th-TH")).toBe("en");
    expect(resolveLocaleFromSystem("")).toBe("en");
    expect(resolveLocaleFromSystem("   ")).toBe("en");
    expect(resolveLocaleFromSystem(undefined)).toBe("en");
    expect(resolveLocaleFromSystem(null)).toBe("en");
  });
});

describe("intlLocale / htmlLangForLocale", () => {
  it("gives every catalog a usable Intl tag", () => {
    for (const loc of LOCALES) {
      const tag = intlLocale(loc);
      expect(tag, loc).toBeTruthy();
      // Must not throw — this tag reaches every date and number formatter.
      expect(() => new Intl.DateTimeFormat(tag)).not.toThrow();
      expect(() => new Intl.NumberFormat(tag)).not.toThrow();
    }
  });

  it("routes catalogs with thin ICU data to a data-complete tag", () => {
    expect(intlLocale("zh")).toBe("zh-CN");
    expect(intlLocale("zh-TW")).toBe("zh-TW");
    expect(intlLocale("ja")).toBe("ja-JP");
    expect(intlLocale("ko")).toBe("ko-KR");
    expect(intlLocale("de")).toBe("de-DE");
  });

  it("accepts raw settings strings and unknown ids", () => {
    expect(intlLocale("ja_JP")).toBe("ja-JP");
    expect(intlLocale("pt-PT")).toBe("pt-BR");
    expect(intlLocale("he")).toBe("en");
    expect(intlLocale(null)).toBe("en");
    expect(intlLocale("")).toBe("en");
  });

  it("keeps html lang honest even where Intl data is borrowed", () => {
    expect(htmlLangForLocale("zh")).toBe("zh-CN");
    expect(htmlLangForLocale("zh-TW")).toBe("zh-TW");
    expect(htmlLangForLocale("ja")).toBe("ja");
    expect(htmlLangForLocale("pt-BR")).toBe("pt-BR");
    expect(htmlLangForLocale("de")).toBe("de");
  });

  it("marks Chinese and Japanese tight-script, but not Korean", () => {
    expect(isTightScript("ja")).toBe(true);
    expect(isTightScript("zh-TW")).toBe(true);
    // Korean spaces its words, so it must keep the separator.
    expect(isTightScript("ko-KR")).toBe(false);
    expect(isTightScript("en")).toBe(false);
    expect(isTightScript("ru")).toBe(false);
    expect(isTightScript(null)).toBe(false);
  });
});

describe("parseLocalePreference / resolveLocalePreference", () => {
  it("keeps system and canonical locales", () => {
    expect(parseLocalePreference("system")).toBe("system");
    expect(parseLocalePreference("System")).toBe("system");
    expect(parseLocalePreference("en")).toBe("en");
    expect(parseLocalePreference("ru")).toBe("ru");
    expect(parseLocalePreference("zh")).toBe("zh");
    expect(parseLocalePreference("zh-TW")).toBe("zh-TW");
  });

  it("normalizes aliases and invalid values", () => {
    expect(parseLocalePreference("zh-cn")).toBe("zh");
    expect(parseLocalePreference("zh-hant")).toBe("zh-TW");
    expect(parseLocalePreference("ru-ru")).toBe("ru");
    expect(parseLocalePreference("ja-jp")).toBe("ja");
    expect(parseLocalePreference("pt-pt")).toBe("pt-BR");
    expect(parseLocalePreference("he")).toBe("en");
  });

  it("treats a missing preference as follow-system", () => {
    expect(parseLocalePreference("")).toBe("system");
    expect(parseLocalePreference(undefined)).toBe("system");
    expect(parseLocalePreference(null)).toBe("system");
  });

  it("resolves system preference via an explicit lang tag", () => {
    expect(resolveLocalePreference("system", "zh-CN")).toBe("zh");
    expect(resolveLocalePreference("system", "zh-TW")).toBe("zh-TW");
    expect(resolveLocalePreference("system", "ru-RU")).toBe("ru");
    expect(resolveLocalePreference("system", "en-US")).toBe("en");
    expect(resolveLocalePreference("system", "de")).toBe("de");
    expect(resolveLocalePreference("system", "ja-JP")).toBe("ja");
    expect(resolveLocalePreference("system", "he-IL")).toBe("en");
  });

  it("returns explicit preferences unchanged", () => {
    expect(resolveLocalePreference("zh", "en-US")).toBe("zh");
    expect(resolveLocalePreference("ru", "en-US")).toBe("ru");
    expect(resolveLocalePreference("en", "zh-CN")).toBe("en");
    expect(resolveLocalePreference("zh-TW", "en")).toBe("zh-TW");
  });

  it("lifts the factory English default to follow-system once", () => {
    expect(migrateLegacyLocaleDefault("en")).toBe("system");
    expect(migrateLegacyLocaleDefault("EN")).toBe("system");
    expect(migrateLegacyLocaleDefault("  en  ")).toBe("system");
    expect(migrateLegacyLocaleDefault("ru")).toBeNull();
    expect(migrateLegacyLocaleDefault("zh")).toBeNull();
    expect(migrateLegacyLocaleDefault("zh-TW")).toBeNull();
    expect(migrateLegacyLocaleDefault("system")).toBeNull();
  });

  it("maps catalog locales to html lang tags", () => {
    expect(htmlLangForLocale("zh")).toBe("zh-CN");
    expect(htmlLangForLocale("zh-TW")).toBe("zh-TW");
    expect(htmlLangForLocale("ru")).toBe("ru");
    expect(htmlLangForLocale("en")).toBe("en");
  });

  it("prefers Host boot OS lang over navigator when present", () => {
    const g = globalThis as { window?: { __GROK_BOOT_OS_LANG__?: string } };
    const prev = g.window;
    g.window = { __GROK_BOOT_OS_LANG__: "zh-CN" };
    expect(readSystemLangTag()).toBe("zh-CN");
    g.window = prev;
  });
});
