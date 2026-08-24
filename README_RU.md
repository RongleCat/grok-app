<p align="center">
  <img src="assets/logo.png" alt="Grok App Logo" width="128" height="128" />
</p>

<h1 align="center">Grok App</h1>

<p align="center"><strong>Современная настольная рабочая среда для локального Grok Build CLI</strong></p>
<p align="center"><em>Управление проектами · Потоковые сессии агента · Единый цикл работы с файлами и кодом · Мультиканальный Remote IM · Настольный компаньон и персонализация</em></p>
<p align="center"><a href="https://grok-app.com">https://grok-app.com</a></p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README_ZH.md">中文</a> ·
  <a href="./README_RU.md">Русский</a>
</p>

<p align="center">
  <a href="https://grok-app.com"><img src="https://img.shields.io/badge/website-grok--app.com-0ea5e9" alt="Website" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <a href="https://github.com/RongleCat/grok-app/stargazers"><img src="https://img.shields.io/github/stars/RongleCat/grok-app?style=social" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey" alt="Platforms" />
  <img src="https://img.shields.io/badge/Tauri-2-orange" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/note-unofficial-yellow" alt="Unofficial" />
</p>

<p align="center">
  <a href="https://x.com/cgnot996"><img src="https://img.shields.io/badge/X-铁柱AGI%20%40cgnot996-black?logo=x&logoColor=white" alt="X 铁柱AGI" /></a>
  <img src="https://img.shields.io/badge/WeChat-铁柱AGI-07C160?logo=wechat&logoColor=white" alt="WeChat 铁柱AGI" />
</p>

<p align="center">
  <img src="assets/wechat/mp-search-scan.png" alt="WeChat Search 铁柱AGI — отсканируйте, чтобы подписаться" width="420" />
  &nbsp;&nbsp;
  <img src="assets/wechat/community-group-qr.png" alt="QR-код группы WeChat — отсканируйте, чтобы присоединиться" width="200" />
</p>

---

> [!NOTE]
> **О Grok App:** Это настольный клиент и рабочая среда с открытым исходным кодом для локального [Grok Build](https://x.ai) CLI (`grok agent stdio`). Проект **не является официальным продуктом xAI**. Приложение не содержит встроенных моделей: все рассуждения, вызовы инструментов и выполнение задач осуществляются напрямую через установленный у вас `grok` CLI.
>
> Для полноценного использования возможностей агента требуется установленный и авторизованный Grok Build CLI. Встроенный мастер первого запуска поможет с установкой CLI, а для автономной разработки интерфейса доступен режим `GROK_APP_ACP=mock`.

---

## Содержание

- [✨ Главные особенности](#-главные-особенности)
- [🛠️ Обзор возможностей](#️-обзор-возможностей)
- [📸 Скриншоты](#-скриншоты)
- [🚀 Быстрый старт и установка](#-быстрый-старт-и-установка)
- [💡 Особенности платформ и устранение неполадок](#-особенности-платформ-и-устранение-неполадок)
- [📂 Пути конфигурации и данных](#-пути-конфигурации-и-данных)
- [💻 Сборка из исходников и разработка](#-сборка-из-исходников-и-разработка)
- [🤝 Сообщество и участие в проекте](#-сообщество-и-участие-в-проекте)
- [👥 Участники](#-участники)
- [📄 Лицензия и автор](#-лицензия-и-автор)

---

## ✨ Главные особенности

- ⚡ **Нативные Build-сессии** — Глубокая интеграция с `grok agent stdio` через протокол ACP. Гибкие уровни разрешений (Ask по умолчанию, однократно, на всю сессию и полностью автономный режим YOLO); по умолчанию включена модель Grok 4.6 Extra High (`xhigh`).
- 🗂️ **Рабочая среда для нескольких проектов** — Изолированные пространства проектов, канбан-доска статусов агентов, быстрое переключение Git Worktree, ветвление (Fork) сессий из любого ответа ассистента и прикрепление других диалогов в качестве контекста.
- 📝 **Файлы, код и генерация контента** — Встроенный редактор CodeMirror 6 с мгновенной синхронизацией с диском, визуальный просмотр изменений Git Diff, поддержка мультимедиа (изображения, видео, аудио, PDF, документы Office) и генерация изображений/видео через Imagine.
- 📲 **Мультиканальный Remote IM** — Единый мост для подключения агента к Telegram, Discord, Slack, Feishu/Lark, DingTalk, WeCom, личному WeChat, QQ, Matrix, LINE и Weibo; мобильное веб-зеркало с защитой по токену и локальный REST API.
- 🐾 **Настольный компаньон и интерактивность** — Интерактивный плавающий питомец поверх окон с реакцией на статус работы агента, поддержкой кастомизации и всплывающими подсказками.
- 🔐 **Локальная приватность и кастомные relay** — Ключи API надёжно хранятся в системном хранилище ключей ОС. Мониторинг квоты SuperGrok и тепловая карта расхода, поддержка сторонних шлюзов (OpenRouter, DeepSeek, AI98PRO и др.) и 15 встроенных языков интерфейса.

---

## 🛠️ Обзор возможностей

### 1. Рабочая среда и управление сессиями
- **Проекты и рабочие области**: Система доверенных каталогов, изоляция проектов, виртуализированный быстрый список сессий, архивация, перенос сессий между проектами и импорт сессий из CLI.
- **Параллельные задачи**: Многопоточная работа нескольких сессий с фоновым приёмом данных; интеллектуальное управление процессами и освобождение простаивающих ресурсов; наглядный канбан (Требует внимания / В процессе / Завершено).
- **Интеграция с Git Worktree**: Автоматическое обнаружение связанных Git worktree для мгновенного переключения рабочих каталогов внутри сессии.
- **Ветвление и прикрепление контекста**: Создание новой ветки обсуждения из любого ответа ассистента с сохранением релевантной истории; вложение до 3 сторонних сессий через команду `/attach-chat` или перетаскиванием.

### 2. Взаимодействие с агентом и потоковая лента
- **Структурированная лента**: Рассуждения модели, запуск инструментов и финальные ответы отображаются в реальном времени в хронологическом порядке.
- **Продвинутый Composer**: Очередь сообщений при занятом агенте; комбинация `Ctrl+Enter` для направления текущего хода мыслей; быстрый фокус при наборе текста; история промптов; цитирование фрагментов кода и комментарии.
- **Гибкий контроль доступа**: Интерактивное подтверждение Ask по умолчанию; разрешение на один раз, на всю сессию, проектные правила по умолчанию или режим YOLO для работы без пауз; поддержка песочницы рабочей области.
- **Отслеживание планов и целей**: Постоянное отображение многоэтапного плана и прогресса целей (Plan / Goal) с подробным Markdown-отчётом в панели ресурсов.

### 3. Файлы, медиа и центр создания контента
- **Встроенный редактор кода и текста**: CodeMirror 6 с вкладками, прямой правкой и сохранением на диск, а также мгновенной перезагрузкой при изменении файлов агентом.
- **Визуализация изменений (Diff)**: Просмотр правок сессии и Git Diff рабочей области с возможностью выборочного или пакетного применения, отклонения и отката изменений.
- **Поддержка всех типов медиа**: Нативный просмотр изображений, аудио, видео, PDF и документов Microsoft Word, Excel и PowerPoint; экспорт красивых карточек сессий в PNG.
- **Генерация медиаконтента**: Создание изображений и видео прямо из поля ввода с помощью навыка Imagine; встроенный боковой браузер с режимом Design Mode для инспекции локальных веб-страниц.

### 4. Экосистема расширений и автоматизация
- **Slash-команды и навыки**: Полное соответствие набору команд Grok Build, быстрый вызов навыков и создание собственных сценариев автоматизации (`/workflow`).
- **Центр расширений и плагинов**: Управление серверами Model Context Protocol (MCP), каталог плагинов (совместимый со спецификацией OpenAI), пользовательские агенты, навыки и хуки.
- **Плагин ChatCut**: Встроенная поддержка рекомендуемого плагина Codex с автоматическим обновлением токенов OAuth и бесшовной связью с внешним браузером.
- **Планировщик задач**: Удобный просмотр запланированных задач и создание периодических автоматизаций через диалог на естественном языке.

### 5. Удалённый доступ и совместная работа
- **Подключение к 11+ мессенджерам**: Управляйте агентом на рабочем столе удалённо со смартфона через любимый мессенджер (команды `/p` для смены проекта, `/r` для продолжения сессии).
- **Мобильное веб-зеркало**: Легковесное веб-приложение для мобильных устройств с доступом по токену; поддержка Cloudflare Quick Tunnel для безопасной связи без белого IP.
- **Локальный Session API**: Стандартные REST-эндпоинты (`GET /v1/sessions`, `POST /v1/sessions/{id}/turns`) для автоматизации скриптами и интеграции сторонних утилит.

### 6. Учётные записи, шлюзы и персонализация
- **Мультиаккаунт и контроль квот**: Быстрое переключение между профилями, официальный вход, прогресс-бар квоты SuperGrok, тепловая карта расходов и локальный учёт сторонних провайдеров.
- **Настройка провайдеров и relay**: Независимый режим конфигурации или безопасный совместный режим (сохраняет оригинальный `~/.grok`); готовые пресеты для OpenRouter, DeepSeek, AI98PRO и др.
- **Визуальная кастомизация**: Светлая, тёмная и системная темы; поддержка скинов, обоев, шрифтов интерфейса и терминала.
- **Интернационализация**: 15 встроенных языков с автоматическим определением языка операционной системы при первом запуске.

---

## 📸 Скриншоты

| 🖥️ Рабочая среда и сессии | 📊 Учётная запись и тепловая карта |
|:---:|:---:|
| ![Workbench](assets/screenshots/workbench.png) | ![Account](assets/screenshots/account.png) |

| ☀️ Светлая тема | 💬 Медиа и интерактивный диалог |
|:---:|:---:|
| ![Light](assets/screenshots/light.png) | ![Chat](assets/screenshots/chat.png) |

---

## 🚀 Быстрый старт и установка

### 1. Загрузка готовых пакетов

Загрузите установочный файл для вашей операционной системы с официального сайта [grok-app.com](https://grok-app.com) или со страницы [GitHub Releases](https://github.com/RongleCat/grok-app/releases):

| Платформа | Формат пакета | Описание |
|:---|:---|:---|
| **macOS (Apple Silicon)** | `Grok_*_aarch64.dmg` | Для компьютеров Mac с процессорами M1/M2/M3/M4 |
| **macOS (Intel)** | `Grok_*_x64.dmg` | Для компьютеров Mac на базе процессоров Intel |
| **Windows (x64)** | `*-setup.exe` / `*-portable.zip` | Установщик и портативная версия |
| **Linux (x64)** | `AppImage` / `.deb` / `.rpm` | Универсальный AppImage, пакеты для Debian/Ubuntu и Fedora/RHEL |

> 💡 **Примечание**: Имя приложения в системе — **Grok**. Для запуска готовых пакетов не требуется установка Node.js, pnpm или Rust.

#### Проверка контрольной суммы
Каждый релиз сопровождается файлом `SHA256SUMS`. Проверить целостность загруженного файла можно следующими командами:
```bash
# macOS / Linux
shasum -a 256 -c SHA256SUMS --ignore-missing

# Windows (PowerShell)
Get-FileHash .\Grok_*_x64-setup.exe -Algorithm SHA256
```

---

### 2. Первый запуск и настройка

1. **Запуск**: Откройте Grok App. Мастер первого запуска автоматически проверит наличие установленного Grok Build CLI (поддерживается быстрая установка с нескольких зеркал).
2. **Авторизация / Шлюзы (необязательно)**: Войдите в официальный аккаунт, укажите API-ключ или настройте кастомный relay. Если ваш локальный CLI `grok` уже авторизован, просто выберите **Использовать текущий вход CLI**.
3. **Добавление проекта**: Выберите и подтвердите доверие к рабочей папке вашего проекта.
4. **Подключение агента**: Выберите режим **Ask** или **YOLO** и приступайте к разработке!

#### Системные требования
- Установленный **Grok Build CLI** (`grok`) версии **0.2.112 или новее** (для обновления выполните `grok update` в терминале).
- Для Windows требуется **WebView2 Runtime** (в Windows 11 предустановлен; в более ранних версиях установщик предложит инсталляцию).
- Linux AppImage: системные `libEGL.so.1`, WebKitGTK 4.1 и Ayatana — см. [библиотеки runtime](#linux-библиотеки-runtime-appimage).

#### Настройка сетевого прокси
Если сервисы Grok недоступны напрямую из-за ограничений сети:
- Перейдите в **Settings → Runtime → Network** и укажите параметры HTTP/SOCKS прокси (например, `http://127.0.0.1:7890`).
- Нажмите **Test connection**, чтобы проверить доступность эндпоинтов (`auth.x.ai`, `grok.com` и др.). Настройки прокси автоматически применяются ко всем процессам агента.

---

## 💡 Особенности платформ и устранение неполадок

### macOS Gatekeeper / Сообщение «Программа повреждена»
Официальные релизы начиная с версии **v0.2.19** подписаны сертификатом Apple Developer ID и прошли **нотаризацию Apple**.
Если система Gatekeeper всё равно блокирует запуск (например, при использовании неофициальных сборок или сохранении атрибутов карантина):

```bash
xattr -cr /Applications/Grok.app
open /Applications/Grok.app
```
*Или перейдите в **Системные настройки → Конфиденциальность и безопасность** и нажмите **Подтвердить вход**.*

---

### Предупреждение Windows SmartScreen
При запуске неподписанных сборок сообщества Windows SmartScreen может вывести предупреждение. Нажмите **Подробнее → Выполнить в любом случае**. Вы также можете сверить контрольную сумму файла с `SHA256SUMS`.

---

### Linux: библиотеки runtime (AppImage)

Официальный AppImage **не** содержит системные EGL / WebKit / tray-библиотеки. На **чистой Debian / Ubuntu** процесс может сразу завершиться:

```text
error while loading shared libraries: libEGL.so.1: cannot open shared object file
```

Установите runtime-пакеты, которые уже ожидает `.deb`, плюс EGL/GLES (проверено на **Debian 13 (trixie) x86_64**, официальный `Grok_0.2.26_amd64.AppImage`):

```bash
sudo apt-get install -y libegl1 libgles2 libwebkit2gtk-4.1-0 libayatana-appindicator3-1
```

Затем `chmod +x` и запустите AppImage (или распакованный `usr/bin/grok-app`). В `.deb` уже указаны `libwebkit2gtk-4.1-0` и `libgtk-3-0`.

Это **отсутствие shared library при старте**, а не чёрное окно Wayland / `EGL_BAD_PARAMETER` из раздела [графика в Linux](#особенности-графики-в-linux-webkitgtk--wayland). См. issue [#899](https://github.com/RongleCat/grok-app/issues/899).

---

### Особенности графики в Linux (WebKitGTK / Wayland)
Если процесс вообще не стартует и в выводе `libEGL.so.1: cannot open shared object file`, это отсутствие системной библиотеки — см. [библиотеки runtime](#linux-библиотеки-runtime-appimage).

В некоторых окружениях Wayland (например, Hyprland на видеокартах AMD) пакет AppImage может испытывать сложности взаимодействия с драйверами Mesa:
- **Рекомендуется**: Использовать системные пакеты **`.deb`** или **`.rpm`**, скомпонованные с системной версией WebKitGTK.
- При использовании AppImage можно запустить приложение с отключением аппаратного композитинга:
```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./Grok_*.AppImage
```

---

### Песочница рабочей области в Linux (Ubuntu 24.04+)
В дистрибутивах Ubuntu 24.04+ по умолчанию ограничены непривилегированные пользовательские пространства имён, что может препятствовать запуску песочницы bubblewrap:
- **Вариант 1 (рекомендуется, сохраняет изоляцию)**: Разрешить непривилегированные пространства имён
```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/99-userns.conf
```
- **Вариант 2**: В меню **Settings → Runtime → Sandbox** переключить режим песочницы в значение **off**.

---

## 📂 Пути конфигурации и данных

Каталог данных по умолчанию (можно переопределить переменной окружения **`GROK_APP_HOME`**):

| Операционная система | Стандартный путь |
|:---|:---|
| **macOS** | `~/Library/Application Support/com.grokapp.grok-app/` |
| **Windows** | `%APPDATA%\grokapp\grok-app\` |
| **Linux** | `~/.grok-app/` |

Структура каталога:
```text
<app-data>/
  projects.json          # Реестр проектов
  sessions_index.json    # Индекс метаданных сессий
  settings.json          # Настройки приложения
  secrets.json           # Метаданные ключей (приоритет системного хранилища, 0600 fallback)
  automations.json       # Расписания автоматизаций
  projects/              # Данные конкретных проектов
  sessions/              # Сохранённая история сессий
  logs/                  # Логи диагностики
  agent-home/            # GROK_HOME для независимого режима
```

---

## 💻 Сборка из исходников и разработка

Если вы хотите внести свой вклад в проект или собрать Grok App самостоятельно:

### Требования к окружению
- **Node.js**: `v22.0.0` или выше
- **pnpm**: `v9.0.0` или выше
- **Rust**: стабильная ветка (Stable Toolchain)
- **Инструменты сборки**: macOS Xcode CLT / Windows MSVC / Linux build-essential & webkit2gtk

### Процесс разработки
```bash
# 1. Установка зависимостей
pnpm install

# 2. Запуск приложения в режиме разработки (Tauri + Vite HMR)
pnpm dev

# 3. Запуск только веб-интерфейса (для вёрстки и тестов UI)
pnpm dev:ui

# 4. Запуск с эмуляцией бекенда (без локального CLI)
GROK_APP_ACP=mock pnpm dev

# 5. Проверка типов и запуск тестов
pnpm typecheck && pnpm test
cd src-tauri && cargo test

# 6. Сборка релизного пакета
pnpm build
```

`pnpm dev` подмешивает `src-tauri/tauri.dev.conf.json` (`identifier` `com.grokapp.desktop.dev`, имя **Grok Dev`), поэтому его можно запускать рядом с установленным **Grok**. Сессии по-прежнему общие, если не задан `GROK_APP_HOME`. Голый `tauri dev` без `--config` берёт официальный identifier и перехватывает установленный экземпляр.

Windows (необязательно): дважды щёлкните [`install-latest.cmd`](./install-latest.cmd), чтобы fast-forward `origin/main` и тихо поставить неподписанный рядом стоящий **grok-app-latest** (официальный **Grok** не заменяется). Нужны VS Build Tools + Rust MSVC; подробности в [docs/BUILD.md](./docs/BUILD.md).

Подробное руководство по кросс-компиляции и выпуску релизов см. в [docs/BUILD.md](./docs/BUILD.md).

---

## 🤝 Сообщество и участие в проекте

Мы рады любым предложениям, сообщениям об ошибках и Pull Request!

| Документ | Описание |
|:---|:---|
| 📖 **Правила и гайды для агентов** | [`docs/llm-wiki/`](./docs/llm-wiki/) |
| 🛠️ **Руководство по сборке** | [docs/BUILD.md](./docs/BUILD.md) |
| 📝 **Журнал изменений** | [CHANGELOG.md](./CHANGELOG.md) |
| 💡 **Руководство по участию** | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| 🛡️ **Кодекс поведения** | [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) |
| 🔒 **Политика безопасности** | [SECURITY.md](./SECURITY.md) |

---

## 👥 Участники

<!-- CONTRIBUTORS:START -->
Спасибо всем, кто внёс вклад в Grok App. Все участники GitHub — люди (по числу коммитов, обновлено 2026-08-24).

<p align="center">
  <a href="https://github.com/RongleCat" title="RongleCat"><img src="https://github.com/RongleCat.png?size=96" width="72" height="72" alt="RongleCat" style="border-radius:50%" /></a>
  <a href="https://github.com/sonnemusk" title="sonnemusk"><img src="https://github.com/sonnemusk.png?size=96" width="72" height="72" alt="sonnemusk" style="border-radius:50%" /></a>
  <a href="https://github.com/zhangxaochen" title="zhangxaochen"><img src="https://github.com/zhangxaochen.png?size=96" width="72" height="72" alt="zhangxaochen" style="border-radius:50%" /></a>
  <a href="https://github.com/AlexZander85" title="AlexZander85"><img src="https://github.com/AlexZander85.png?size=96" width="72" height="72" alt="AlexZander85" style="border-radius:50%" /></a>
  <a href="https://github.com/Yy-702" title="Yy-702"><img src="https://github.com/Yy-702.png?size=96" width="72" height="72" alt="Yy-702" style="border-radius:50%" /></a>
  <a href="https://github.com/shiaho777" title="shiaho777"><img src="https://github.com/shiaho777.png?size=96" width="72" height="72" alt="shiaho777" style="border-radius:50%" /></a>
  <a href="https://github.com/Dmao233" title="Dmao233"><img src="https://github.com/Dmao233.png?size=96" width="72" height="72" alt="Dmao233" style="border-radius:50%" /></a>
  <a href="https://github.com/enderzcx" title="enderzcx"><img src="https://github.com/enderzcx.png?size=96" width="72" height="72" alt="enderzcx" style="border-radius:50%" /></a>
  <a href="https://github.com/ynjmxn" title="ynjmxn"><img src="https://github.com/ynjmxn.png?size=96" width="72" height="72" alt="ynjmxn" style="border-radius:50%" /></a>
  <a href="https://github.com/1llum1n4t1s" title="1llum1n4t1s"><img src="https://github.com/1llum1n4t1s.png?size=96" width="72" height="72" alt="1llum1n4t1s" style="border-radius:50%" /></a>
  <a href="https://github.com/erict16" title="erict16"><img src="https://github.com/erict16.png?size=96" width="72" height="72" alt="erict16" style="border-radius:50%" /></a>
  <a href="https://github.com/jason920612" title="jason920612"><img src="https://github.com/jason920612.png?size=96" width="72" height="72" alt="jason920612" style="border-radius:50%" /></a>
  <a href="https://github.com/oykb58246" title="oykb58246"><img src="https://github.com/oykb58246.png?size=96" width="72" height="72" alt="oykb58246" style="border-radius:50%" /></a>
  <a href="https://github.com/ChenYCL" title="ChenYCL"><img src="https://github.com/ChenYCL.png?size=96" width="72" height="72" alt="ChenYCL" style="border-radius:50%" /></a>
  <a href="https://github.com/1parado" title="1parado"><img src="https://github.com/1parado.png?size=96" width="72" height="72" alt="1parado" style="border-radius:50%" /></a>
  <a href="https://github.com/sutongwuyanzu" title="sutongwuyanzu"><img src="https://github.com/sutongwuyanzu.png?size=96" width="72" height="72" alt="sutongwuyanzu" style="border-radius:50%" /></a>
  <a href="https://github.com/a70win-wq" title="a70win-wq"><img src="https://github.com/a70win-wq.png?size=96" width="72" height="72" alt="a70win-wq" style="border-radius:50%" /></a>
  <a href="https://github.com/lunar-me" title="lunar-me"><img src="https://github.com/lunar-me.png?size=96" width="72" height="72" alt="lunar-me" style="border-radius:50%" /></a>
  <a href="https://github.com/falser101" title="falser101"><img src="https://github.com/falser101.png?size=96" width="72" height="72" alt="falser101" style="border-radius:50%" /></a>
  <a href="https://github.com/salasebas" title="salasebas"><img src="https://github.com/salasebas.png?size=96" width="72" height="72" alt="salasebas" style="border-radius:50%" /></a>
  <a href="https://github.com/Sdefendre" title="Sdefendre"><img src="https://github.com/Sdefendre.png?size=96" width="72" height="72" alt="Sdefendre" style="border-radius:50%" /></a>
  <a href="https://github.com/yuhaouno" title="yuhaouno"><img src="https://github.com/yuhaouno.png?size=96" width="72" height="72" alt="yuhaouno" style="border-radius:50%" /></a>
  <a href="https://github.com/2530185073" title="2530185073"><img src="https://github.com/2530185073.png?size=96" width="72" height="72" alt="2530185073" style="border-radius:50%" /></a>
  <a href="https://github.com/86208620" title="86208620"><img src="https://github.com/86208620.png?size=96" width="72" height="72" alt="86208620" style="border-radius:50%" /></a>
  <a href="https://github.com/apple-ouyang" title="apple-ouyang"><img src="https://github.com/apple-ouyang.png?size=96" width="72" height="72" alt="apple-ouyang" style="border-radius:50%" /></a>
  <a href="https://github.com/fannnzhang" title="fannnzhang"><img src="https://github.com/fannnzhang.png?size=96" width="72" height="72" alt="fannnzhang" style="border-radius:50%" /></a>
  <a href="https://github.com/hermes87666" title="hermes87666"><img src="https://github.com/hermes87666.png?size=96" width="72" height="72" alt="hermes87666" style="border-radius:50%" /></a>
  <a href="https://github.com/jchacker5" title="jchacker5"><img src="https://github.com/jchacker5.png?size=96" width="72" height="72" alt="jchacker5" style="border-radius:50%" /></a>
  <a href="https://github.com/KronixDev" title="KronixDev"><img src="https://github.com/KronixDev.png?size=96" width="72" height="72" alt="KronixDev" style="border-radius:50%" /></a>
  <a href="https://github.com/MaxxxDong" title="MaxxxDong"><img src="https://github.com/MaxxxDong.png?size=96" width="72" height="72" alt="MaxxxDong" style="border-radius:50%" /></a>
  <a href="https://github.com/praxstack" title="praxstack"><img src="https://github.com/praxstack.png?size=96" width="72" height="72" alt="praxstack" style="border-radius:50%" /></a>
  <a href="https://github.com/rkhrkh" title="rkhrkh"><img src="https://github.com/rkhrkh.png?size=96" width="72" height="72" alt="rkhrkh" style="border-radius:50%" /></a>
  <a href="https://github.com/Sixmin" title="Sixmin"><img src="https://github.com/Sixmin.png?size=96" width="72" height="72" alt="Sixmin" style="border-radius:50%" /></a>
  <a href="https://github.com/sk1935" title="sk1935"><img src="https://github.com/sk1935.png?size=96" width="72" height="72" alt="sk1935" style="border-radius:50%" /></a>
  <a href="https://github.com/tisrop" title="tisrop"><img src="https://github.com/tisrop.png?size=96" width="72" height="72" alt="tisrop" style="border-radius:50%" /></a>
  <a href="https://github.com/XancelZC" title="XancelZC"><img src="https://github.com/XancelZC.png?size=96" width="72" height="72" alt="XancelZC" style="border-radius:50%" /></a>
</p>

[Полный граф участников →](https://github.com/RongleCat/grok-app/graphs/contributors)
<!-- CONTRIBUTORS:END -->

---

## 📄 Лицензия и автор

Проект распространяется под лицензией [MIT License](./LICENSE).

### Связь с автором и сообщество

| Канал связи | Ссылка |
|:---|:---|
| 𝕏 **X (Twitter)** | [@cgnot996 (铁柱AGI)](https://x.com/cgnot996) |
| 📢 **WeChat Official Account** | Поиск **「铁柱AGI」** или QR-код слева вверху |
| 💬 **Группа WeChat** | QR-код сообщества справа вверху |
| 🐧 **Сообщество Linux.do** | [linux.do](https://linux.do/) — Изучайте AI на L-Station |

⭐ **Если Grok App делает вашу разработку удобнее и быстрее, пожалуйста, поставьте звезду репозиторию на GitHub!**
