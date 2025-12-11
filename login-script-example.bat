@echo off
REM ==========================================
REM Скрипт для отправки логов входа в систему
REM Версия: 1.0
REM ==========================================

REM Настройки API
set API_URL=https://your-domain.com/api/external/log/user-activity
set API_KEY=hd_your_api_key_here

REM Получение информации о пользователе и компьютере
set COMPUTER_NAME=%COMPUTERNAME%
set AD_USERNAME=%USERNAME%
set AD_DOMAIN=%USERDOMAIN%
set TIMESTAMP=%date% %time%

REM Получение GUID пользователя из Active Directory
for /f "tokens=2 delims={}" %%i in ('dsquery user -samid %AD_USERNAME% ^| dsget user -objectguid -q') do set AD_GUID=%%i

REM Получение полного имени пользователя из Active Directory
for /f "skip=1 tokens=*" %%i in ('dsquery user -samid %AD_USERNAME% ^| dsget user -fn -ln -q') do (
    set USER_INFO=%%i
    goto :parse_name
)

:parse_name
REM Парсинг имени и фамилии (предполагается формат "Имя Фамилия")
for /f "tokens=1,2" %%a in ("%USER_INFO%") do (
    set FIRST_NAME=%%a
    set LAST_NAME=%%b
)

REM Проверка обязательных данных
if "%AD_GUID%"=="" (
    echo ERROR: Не удалось получить GUID пользователя
    exit /b 1
)

if "%FIRST_NAME%"=="" (
    echo ERROR: Не удалось получить имя пользователя
    exit /b 1
)

REM Формирование JSON для отправки
set JSON_DATA={^
"firstName": "%FIRST_NAME%",^
"lastName": "%LAST_NAME%",^
"activeDirectoryObjectGUID": "%AD_GUID%",^
"activeDirectoryLogin": "%AD_USERNAME%",^
"computerName": "%COMPUTER_NAME%",^
"action": "userLogin",^
"timeStamp": "%TIMESTAMP%"^
}

REM Отправка данных через curl (требует установки curl)
curl -X POST "%API_URL%" ^
     -H "Content-Type: application/json" ^
     -H "X-API-Key: %API_KEY%" ^
     -d "%JSON_DATA%" ^
     --connect-timeout 10 ^
     --max-time 30 ^
     --silent ^
     --show-error

REM Проверка результата
if %ERRORLEVEL% EQU 0 (
    echo SUCCESS: Лог входа отправлен успешно
) else (
    echo ERROR: Ошибка отправки лога входа (код: %ERRORLEVEL%)
)

REM Логирование в локальный файл (опционально)
echo %TIMESTAMP% - %AD_USERNAME% (%FIRST_NAME% %LAST_NAME%) - %COMPUTER_NAME% - Result: %ERRORLEVEL% >> C:\Temp\login_log.txt

exit /b %ERRORLEVEL%
