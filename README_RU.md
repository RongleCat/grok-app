<p align="center">
  <img src="assets/logo.png" alt="Grok App" width="128" height="128" />
</p>

<h1 align="center">Grok App</h1>

<p align="center"><strong>Настольная рабочая среда для локального Grok Build</strong></p>
<p align="center"><em>Сессии, проекты, медиа и автоматизации — для настоящего <code>grok</code> CLI</em></p>
<p align="center"><a href="https://grok-app.com/">https://grok-app.com/</a></p>

<p align="center">
  <a href="./README.md">English</a> ·
  <a href="./README_ZH.md">中文</a> ·
  <a href="./README_RU.md">Русский</a>
</p>

<p align="center">
  <a href="https://grok-app.com/"><img src="https://img.shields.io/badge/website-grok--app.com-0ea5e9" alt="Website" /></a>
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
> ## Примечание
>
> **Grok App не является официальным продуктом xAI.** Приложение превращает локальный [Grok Build](https://x.ai) CLI (`grok agent stdio`) в настольную рабочую среду: сессии, проекты, разрешения, предпросмотр медиа и запланированные задачи.
>
> Для полноценной работы агента необходим установленный и авторизованный **Grok Build CLI**. Если CLI отсутствует, его можно установить через мастер первого запуска. Для разработки только интерфейса можно использовать `GROK_APP_ACP=mock`.

---

## Содержание

1. [Обзор](#обзор)
2. [Возможности](#возможности)
3. [Скриншоты](#скриншоты)
4. [Установка и первый запуск](#установка-и-первый-запуск)
5. [macOS: «повреждено» / Gatekeeper](#macos-повреждено--gatekeeper)
6. [Linux: пустое/чёрное окно (WebKit)](#linux-пустоечёрное-окно-webkit)
7. [Linux: sandbox / user namespaces (Ubuntu 24.04+)](#linux-sandbox--user-namespaces-ubuntu-2404)
8. [Пути конфигурации](#пути-конфигурации)
9. [Разработка и сборка](#разработка-и-сборка)
10. [Документация и участие в разработке](#документация-и-участие-в-разработке)
11. [Участники](#участники)
12. [Автор проекта](#автор-проекта)

---

## Обзор

CLI `grok` очень мощный в терминале, но в повседневной работе также нужны сессии для нескольких проектов, удобное управление разрешениями, богатый предпросмотр, запланированные задачи и многоязычный интерфейс.

**Grok App** предоставляет такую рабочую среду:

1. Установите приложение и подготовьте Grok Build CLI  
2. Добавьте проект / создайте новую сессию  
3. Подключите агента и общайтесь в режиме Ask или YOLO  
4. Просматривайте артефакты, создавайте автоматизации, управляйте аккаунтом и relay-провайдерами в Settings  

**Стек:** Tauri 2 + Rust · React + TypeScript + Vite · Tailwind CSS

---

## Возможности

| Область | Что доступно |
|------|----------------|
| **Настоящие Build-сессии** | По умолчанию `grok agent stdio` (ACP); FSM сессии контролируется приложением; опциональный удалённый ACP |
| **Проекты и сессии** | Доверенные каталоги, виртуализированная боковая панель, архив / orphan-сессии, fork и rewind; **импорт / открытие CLI-сессий** (понятные пути в independent mode) |
| **Параллельные сессии** | Активные ответы продолжают поступать после переключения чата; лимиты процессов и освобождение простаивающих процессов |
| **Git worktrees** | Связанные worktree отображаются в чипе проекта; рабочий каталог можно переключить одним нажатием (скрыто для не-git проектов) |
| **Разрешения** | Ask по умолчанию; разрешить один раз / на сессию / запретить; YOLO; уровень разрешений **для каждого проекта** |
| **Plan / Goal** | Закреплённый прогресс выполнения; Markdown-план и шаги в панели ресурсов; ввод Goal |
| **Slash · Extensions** | Палитра slash-команд, Skills; Settings → Extensions для MCP / Plugins |
| **Composer** | Очередь последующих сообщений во время работы агента; вставка скриншотов; индикатор использования контекста |
| **Медиа и файлы** | Предпросмотр изображений / видео / PDF / Office / кода; **редактирование и сохранение** текста в Resources; Changes (diff сессии + git рабочей области) |
| **Работа агента** | Отмена зависшего выполнения; структурированные ошибки; экспорт **диагностического ZIP**; состояние не становится «ready», пока открыты инструменты/разрешения |
| **Автоматизации** | Список запланированных задач; создание естественным языком из чата (скрытая служебная разметка, без JSON в UI) |
| **Аккаунт и квота** | Переключение нескольких аккаунтов, официальный вход, квота SuperGrok + heatmap, локальная статистика custom provider |
| **Пользовательские relay** | Независимый профиль агента `GROK_HOME` (при необходимости сохраняет `~/.grok` нетронутым) |
| **Безопасность** | Опциональное системное хранилище ключей для API keys (`secrets.json` 0600 используется как fallback); блокировки записи хранилища; подтверждения внутри приложения |
| **i18n** | Упрощённый китайский / традиционный китайский / английский / русский + системный tray |
| **Пакеты** | macOS ARM / Intel · Windows x64 (установщик + portable) · Linux x64 (AppImage / deb / rpm) |

---

## Скриншоты

> Из текущей development-сборки для macOS.

| Рабочая среда · SuperGrok | Аккаунт и квота |
|:---:|:---:|
| ![Workbench](assets/screenshots/workbench.png) | ![Account](assets/screenshots/account.png) |

| Светлая тема | Сессия и медиа |
|:---:|:---:|
| ![Light](assets/screenshots/light.png) | ![Chat](assets/screenshots/chat.png) |

---

## Установка и первый запуск

### 1. Загрузка

Установочные файлы доступны на официальном сайте [grok-app.com](https://grok-app.com/) или в [GitHub Releases](https://github.com/RongleCat/grok-app/releases):

| Платформа | Файл |
|----------|----------|
| macOS Apple Silicon | `Grok_*_aarch64.dmg` |
| macOS Intel | `Grok_*_x64.dmg` |
| Windows x64 | установщик `*-setup.exe` + `*-portable.zip` |
| Linux x64 | AppImage / `.deb` / `.rpm` |

Имя продукта в пакете — **Grok** (совпадает с заголовком окна).

**Arch / Manjaro / EndeavourOS:** **AppImage** не зависит от конкретного дистрибутива (`chmod +x`, затем запуск). Официальный CI не публикует отдельный AUR-пакет. На некоторых системах **Wayland (например, Hyprland) + AMD** стандартный AppImage может показывать чёрное окно — используйте **`.deb` / `.rpm`** (системный WebKit) либо решение из раздела [Linux: пустое/чёрное окно](#linux-пустоечёрное-окно-webkit).

> **Для готовых пакетов инструменты сборки не нужны.** Node / pnpm / Rust требуются только при [сборке из исходников](#разработка-и-сборка). Не запускайте `pnpm install && tauri build`, если вам нужно просто пользоваться приложением.

#### Проверка загрузки

Каждый релиз содержит файл `SHA256SUMS`. После загрузки:

```bash
# macOS / Linux
shasum -a 256 -c SHA256SUMS --ignore-missing
# Windows (PowerShell)
Get-FileHash .\Grok_*_x64-setup.exe -Algorithm SHA256
```

Сравните хеш PowerShell с соответствующей строкой в `SHA256SUMS`.

#### Windows SmartScreen

Community / неподписанные Windows-сборки при первом запуске показывают SmartScreen «Windows protected your PC / Unknown publisher». Нажмите **More info → Run anyway** и при сомнениях проверьте контрольную сумму выше. Release CI может подписывать установщики Authenticode, если настроены secrets `WINDOWS_CERTIFICATE` + `WINDOWS_CERTIFICATE_PASSWORD` (см. `docs/BUILD.md`); у подписанной сборки отображается имя издателя из сертификата.

#### Автоматическое обновление в приложении

Тихое обновление через **Settings → About** работает только для **подписанных production-сборок** (встроенный ключ Tauri updater + соответствующие подписанные архивы rolling release). Неподписанные community-сборки, локальные `pnpm dev` / debug-бинарники и некоторые типы Linux-пакетов (например, не-AppImage) используют путь **GitHub open-release / скачать установщик** и не получают тихие обновления внутри приложения. Полная матрица и checklist для мейнтейнера: [docs/desktop-auto-update.md](./docs/desktop-auto-update.md).

### 2. Первый запуск

1. Запустите приложение → **Setup wizard** проверит наличие CLI и при необходимости установит его (поддерживаются несколько зеркал)  
2. Необязательно: официальный вход / API key / custom relay. Этот шаг можно пропустить. Если локальный `grok` CLI уже авторизован, выберите **Use existing CLI sign-in** — повторная авторизация не требуется  
3. **Add project** → подтвердите доверие к каталогу  
4. **Connect agent** → начинайте чат после состояния Ready  
5. По умолчанию разрешения работают в режиме **Ask**; используйте YOLO только для выполнения без постоянных подтверждений  

### 3. Требования

- Локальный **Grok Build CLI** (`grok`) версии **0.2.112 или новее**, обычно `~/.grok/bin/grok` либо доступный через `PATH`. Старые версии CLI отклоняют необходимые приложению флаги (после установки один раз выполните `grok update`, затем полностью перезапустите приложение)  
- Windows: `%USERPROFILE%\.grok\bin\grok.exe` или `PATH`; **WebView2 Runtime** (предустановлен в Windows 11; при необходимости установщик добавит его)  

### 4. Сети с ограниченным доступом (например, материковый Китай)

Сервисы Grok (`auth.x.ai` / `grok.com` / `cli-chat-proxy.grok.com`) могут быть недоступны напрямую. Если вход зависает или каждое сообщение завершается ошибкой `NETWORK_PROVIDER`:

1. **Settings → Runtime → Network**: задайте proxy (System / Manual, например `http://127.0.0.1:7890`), затем используйте **Test connection**, чтобы проверить все три endpoint  
2. Предпочитайте **System HTTP** или **Manual** `http://127.0.0.1:7890` (mixed-port Clash / Surge), а не TUN. Приложение обрабатывает loopback PAC и передаёт `HTTP_PROXY` процессам агента. TUN нужен только если трафик нельзя маршрутизировать иначе  
3. Если `grok` CLI уже авторизован, используйте существующий вход через setup wizard (или переключите **Session data mode** в *shared*) вместо Browser OAuth  
4. Скрипты запуска и вручную экспортированные переменные `HTTP_PROXY` не нужны — приложение само передаёт настроенный proxy всем процессам агента  

---

## macOS: «повреждено» / Gatekeeper

Официальные GitHub Releases начиная с **v0.2.19** подписываются Developer ID и проходят **Apple notarization**. Откройте `.dmg` и перетащите Grok в Applications обычным способом.

Если Gatekeeper всё равно блокирует приложение (fork / старая неподписанная сборка или оставшийся quarantine-флаг):

```bash
xattr -cr /Applications/Grok.app
open /Applications/Grok.app
```

**Также можно:**

- Finder: **правый клик** → **Open** → подтвердить  
- **System Settings → Privacy & Security** → **Open Anyway**  

Загружайте приложение только с [grok-app.com](https://grok-app.com/) или из официальных [Releases](https://github.com/RongleCat/grok-app/releases) этого репозитория.

---

## Linux: пустое/чёрное окно (WebKit)

На некоторых рабочих столах **Wayland** (особенно **Hyprland + AMD**) официальный **AppImage** может открываться полностью чёрным. Сам host-процесс продолжает работать (media server, agent ACP, auth), но встроенный WebKitGTK ничего не рисует. В логах часто встречается:

```text
Could not create default EGL display: EGL_BAD_PARAMETER
```

Это известный класс проблем **Tauri 2 + AppImage + WebKitGTK**: AppImage содержит WebKit, собранный в CI-контейнере (Ubuntu 22.04), который может конфликтовать с более новым Mesa/DRI на хосте. `.deb` / `.rpm` используют **системный** WebKit и обычно работают на той же машине. См. issue [#539](https://github.com/RongleCat/grok-app/issues/539) и [заметки Tauri о графике в Linux](https://v2.tauri.app/develop/debug/linux-graphics/).

**Пробуйте по порядку:**

1. **Предпочтительно `.deb` или `.rpm`** из того же Release (системный WebKit). На Arch можно преобразовать пакет через `debtap` или распаковать `.deb` и запустить бинарник.
2. **Запустить AppImage с системным WebKit** (подтверждено для Arch + Hyprland + AMD):

```bash
# однократная распаковка
./Grok_*.AppImage --appimage-extract
# либо: bash scripts/run-linux-appimage-system-webkit.sh ./Grok_*.AppImage

export LD_LIBRARY_PATH=/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}
export WEBKIT_EXEC_PATH=/usr/lib/webkit2gtk-4.1
export WEBKIT_DISABLE_DMABUF_RENDERER=1
export WEBKIT_DISABLE_COMPOSITING_MODE=1
export GDK_BACKEND=x11
unset APPDIR APPIMAGE
./squashfs-root/usr/bin/grok-app
```

На Debian/Ubuntu multiarch используйте `/usr/lib/x86_64-linux-gnu` и `/usr/lib/x86_64-linux-gnu/webkit2gtk-4.1`, если указанных выше путей нет. При необходимости установите системный WebKit (`webkit2gtk-4.1` на Arch; `libwebkit2gtk-4.1-0` на Debian/Ubuntu).

3. Быстрая попытка только с переменной окружения (может помочь для NVIDIA/DMABUF; **обычно недостаточно** при EGL-ошибке выше):

```bash
WEBKIT_DISABLE_DMABUF_RENDERER=1 ./Grok_*.AppImage
```

---

## Linux: sandbox / user namespaces (Ubuntu 24.04+)

В **Ubuntu 24.04+** (и некоторых других дистрибутивах) ядро может использовать:

```text
kernel.apparmor_restrict_unprivileged_userns = 1
```

Стандартный sandbox агента Grok (`--sandbox workspace`) использует **bubblewrap**, которому нужны unprivileged user namespaces. Если ядро блокирует их, агент сразу завершается, а приложение может показать **Agent process ended** / `SANDBOX_BLOCKED` (в stderr часто присутствует `bwrap: setting up uid map: Permission denied`). См. issue [#541](https://github.com/RongleCat/grok-app/issues/541).

**Исправление с сохранением sandbox:**

```bash
sudo sysctl -w kernel.apparmor_restrict_unprivileged_userns=0
echo 'kernel.apparmor_restrict_unprivileged_userns=0' | sudo tee /etc/sysctl.d/99-userns.conf
```

**Обход без sudo:** **Settings → Runtime → Sandbox → off** (bubblewrap не используется; ОС-уровень изоляции отключается).

Doctor также показывает эту проблему, если sysctl ограничен, а sandbox не установлен в `off`.

---

## Пути конфигурации

Каталог данных по умолчанию (можно переопределить через **`GROK_APP_HOME`**):

| Платформа | Типичный путь |
|----------|----------------|
| macOS | `~/Library/Application Support/com.grokapp.grok-app/` |
| Windows | `%APPDATA%\grokapp\grok-app\` |
| Fallback | `~/.grok-app/` |

```text
<app-data>/
  projects.json
  sessions_index.json
  settings.json
  secrets.json          # metadata (+ fallback для API key); предпочтительно системное хранилище
  automations.json
  projects/
  sessions/
  logs/
  agent-home/           # GROK_HOME в independent mode
```

API keys предпочтительно хранятся в системном secret store (macOS Keychain / Windows Credential Manager / Linux Secret Service). Если оно недоступно, используется `secrets.json` с режимом `0600`. Не добавляйте секреты в git.

Собственная конфигурация Grok Build остаётся в **`~/.grok`** (CLI login, `auth.json`, …).  
В режиме **shared** сессии могут использовать `~/.grok`; режим **independent** использует `agent-home/`.

---

## Разработка и сборка

```bash
# Требуется: Node 22+, pnpm 9, Rust stable, Xcode CLT (macOS)
pnpm install

pnpm dev                 # полное приложение (по умолчанию реальный CLI)
pnpm dev:ui              # только frontend
GROK_APP_ACP=mock pnpm dev

pnpm typecheck && pnpm test
cd src-tauri && cargo test

pnpm build
```

Windows (необязательно): дважды щёлкните [`install-latest.cmd`](./install-latest.cmd), чтобы fast-forward `origin/main` и тихо поставить неподписанный рядом стоящий **grok-app-latest** (официальный **Grok** не заменяется). Нужны VS Build Tools + Rust MSVC; подробности в [docs/BUILD.md](./docs/BUILD.md).

Кросс-компиляция и выпуск: [docs/BUILD.md](./docs/BUILD.md).

Релиз (сначала добавьте соответствующий раздел в `CHANGELOG.md`):

```bash
./scripts/release-tag.sh 0.1.1
./scripts/release-tag.sh 0.1.1 --push
```

---

## Документация и участие в разработке

| Для кого / что | Ссылка |
|----------|------|
| AI-агенты / правила продукта | [`docs/llm-wiki/`](./docs/llm-wiki/) |
| Сборка и релиз | [docs/BUILD.md](./docs/BUILD.md) |
| История изменений | [CHANGELOG.md](./CHANGELOG.md) |
| Участие в разработке | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| Кодекс поведения | [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) |
| Безопасность | [SECURITY.md](./SECURITY.md) |

Issues и PR приветствуются.

## Участники

<!-- CONTRIBUTORS:START -->
Спасибо всем, кто внёс вклад в Grok App. Все участники GitHub — люди (по числу коммитов, обновлено 2026-08-21).

<p align="center">
  <a href="https://github.com/RongleCat" title="RongleCat"><img src="https://github.com/RongleCat.png?size=96" width="72" height="72" alt="RongleCat" style="border-radius:50%" /></a>
  <a href="https://github.com/sonnemusk" title="sonnemusk"><img src="https://github.com/sonnemusk.png?size=96" width="72" height="72" alt="sonnemusk" style="border-radius:50%" /></a>
  <a href="https://github.com/AlexZander85" title="AlexZander85"><img src="https://github.com/AlexZander85.png?size=96" width="72" height="72" alt="AlexZander85" style="border-radius:50%" /></a>
  <a href="https://github.com/Yy-702" title="Yy-702"><img src="https://github.com/Yy-702.png?size=96" width="72" height="72" alt="Yy-702" style="border-radius:50%" /></a>
  <a href="https://github.com/shiaho777" title="shiaho777"><img src="https://github.com/shiaho777.png?size=96" width="72" height="72" alt="shiaho777" style="border-radius:50%" /></a>
  <a href="https://github.com/zhangxaochen" title="zhangxaochen"><img src="https://github.com/zhangxaochen.png?size=96" width="72" height="72" alt="zhangxaochen" style="border-radius:50%" /></a>
  <a href="https://github.com/enderzcx" title="enderzcx"><img src="https://github.com/enderzcx.png?size=96" width="72" height="72" alt="enderzcx" style="border-radius:50%" /></a>
  <a href="https://github.com/1llum1n4t1s" title="1llum1n4t1s"><img src="https://github.com/1llum1n4t1s.png?size=96" width="72" height="72" alt="1llum1n4t1s" style="border-radius:50%" /></a>
  <a href="https://github.com/jason920612" title="jason920612"><img src="https://github.com/jason920612.png?size=96" width="72" height="72" alt="jason920612" style="border-radius:50%" /></a>
  <a href="https://github.com/oykb58246" title="oykb58246"><img src="https://github.com/oykb58246.png?size=96" width="72" height="72" alt="oykb58246" style="border-radius:50%" /></a>
  <a href="https://github.com/ynjmxn" title="ynjmxn"><img src="https://github.com/ynjmxn.png?size=96" width="72" height="72" alt="ynjmxn" style="border-radius:50%" /></a>
  <a href="https://github.com/ChenYCL" title="ChenYCL"><img src="https://github.com/ChenYCL.png?size=96" width="72" height="72" alt="ChenYCL" style="border-radius:50%" /></a>
  <a href="https://github.com/erict16" title="erict16"><img src="https://github.com/erict16.png?size=96" width="72" height="72" alt="erict16" style="border-radius:50%" /></a>
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
  <a href="https://github.com/Dmao233" title="Dmao233"><img src="https://github.com/Dmao233.png?size=96" width="72" height="72" alt="Dmao233" style="border-radius:50%" /></a>
  <a href="https://github.com/fannnzhang" title="fannnzhang"><img src="https://github.com/fannnzhang.png?size=96" width="72" height="72" alt="fannnzhang" style="border-radius:50%" /></a>
  <a href="https://github.com/hermes87666" title="hermes87666"><img src="https://github.com/hermes87666.png?size=96" width="72" height="72" alt="hermes87666" style="border-radius:50%" /></a>
  <a href="https://github.com/jchacker5" title="jchacker5"><img src="https://github.com/jchacker5.png?size=96" width="72" height="72" alt="jchacker5" style="border-radius:50%" /></a>
  <a href="https://github.com/MaxxxDong" title="MaxxxDong"><img src="https://github.com/MaxxxDong.png?size=96" width="72" height="72" alt="MaxxxDong" style="border-radius:50%" /></a>
  <a href="https://github.com/rkhrkh" title="rkhrkh"><img src="https://github.com/rkhrkh.png?size=96" width="72" height="72" alt="rkhrkh" style="border-radius:50%" /></a>
  <a href="https://github.com/Sixmin" title="Sixmin"><img src="https://github.com/Sixmin.png?size=96" width="72" height="72" alt="Sixmin" style="border-radius:50%" /></a>
  <a href="https://github.com/sk1935" title="sk1935"><img src="https://github.com/sk1935.png?size=96" width="72" height="72" alt="sk1935" style="border-radius:50%" /></a>
  <a href="https://github.com/tisrop" title="tisrop"><img src="https://github.com/tisrop.png?size=96" width="72" height="72" alt="tisrop" style="border-radius:50%" /></a>
  <a href="https://github.com/XancelZC" title="XancelZC"><img src="https://github.com/XancelZC.png?size=96" width="72" height="72" alt="XancelZC" style="border-radius:50%" /></a>
</p>

[Полный граф участников →](https://github.com/RongleCat/grok-app/graphs/contributors)
<!-- CONTRIBUTORS:END -->


## Лицензия

[MIT](./LICENSE) © RongleCat

---

## Автор проекта

| Канал | Ссылка |
|---------|------|
| **X / Twitter** | [铁柱AGI @cgnot996](https://x.com/cgnot996) |
| **WeChat Official Account** | поиск **「铁柱AGI」** (QR-код слева вверху) |
| **Группа WeChat** | отсканируйте QR-код справа вверху |

[linux.do](https://linux.do/) 学AI，上L站

Если Grok App оказался полезен, поставьте репозиторию звезду ⭐
