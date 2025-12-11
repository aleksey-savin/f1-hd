# ==========================================
# PowerShell скрипт для отправки логов входа в систему
# Версия: 1.0
# Использование: запускать через групповые политики при входе пользователя
# ==========================================

param(
    [string]$ApiUrl = "https://your-domain.com/api/external/log/user-activity",
    [string]$ApiKey = "hd_your_api_key_here"
)

# Функция для логирования
function Write-Log {
    param([string]$Message, [string]$Level = "INFO")
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $logMessage = "[$timestamp] [$Level] $Message"
    Write-Output $logMessage

    # Логирование в файл (опционально)
    $logFile = "C:\Temp\login_log.txt"
    if (!(Test-Path "C:\Temp")) { New-Item -ItemType Directory -Path "C:\Temp" -Force }
    $logMessage | Out-File -FilePath $logFile -Append -Encoding UTF8
}

try {
    Write-Log "Начало выполнения скрипта входа"

    # Получение информации о компьютере и пользователе
    $computerName = $env:COMPUTERNAME
    $adUsername = $env:USERNAME
    $adDomain = $env:USERDOMAIN
    $timestamp = Get-Date -Format "yyyy-MM-ddTHH:mm:ss.fffZ"

    Write-Log "Пользователь: $adUsername, Компьютер: $computerName"

    # Получение информации из Active Directory
    try {
        Import-Module ActiveDirectory -ErrorAction Stop

        # Получение объекта пользователя из AD
        $adUser = Get-ADUser -Identity $adUsername -Properties objectGUID, GivenName, Surname -ErrorAction Stop

        $adGuid = $adUser.objectGUID.ToString()
        $firstName = $adUser.GivenName
        $lastName = $adUser.Surname

        Write-Log "Получены данные AD: $firstName $lastName (GUID: $adGuid)"

    } catch {
        Write-Log "Ошибка получения данных из AD: $($_.Exception.Message)" "ERROR"

        # Попытка получить имя пользователя из WMI
        try {
            $wmiUser = Get-WmiObject -Class Win32_UserAccount -Filter "Name='$adUsername'" | Select-Object -First 1
            if ($wmiUser) {
                $adGuid = $wmiUser.SID
                $firstName = $adUsername
                $lastName = ""
                Write-Log "Использованы данные WMI как альтернатива"
            } else {
                throw "Не удалось получить данные пользователя"
            }
        } catch {
            Write-Log "Критическая ошибка: не удалось получить данные пользователя" "ERROR"
            exit 1
        }
    }

    # Проверка обязательных полей
    if ([string]::IsNullOrEmpty($adGuid)) {
        Write-Log "Ошибка: GUID пользователя пуст" "ERROR"
        exit 1
    }

    if ([string]::IsNullOrEmpty($firstName)) {
        $firstName = $adUsername
        Write-Log "Предупреждение: Имя пользователя не найдено, используется логин" "WARN"
    }

    if ([string]::IsNullOrEmpty($lastName)) {
        $lastName = ""
    }

    # Формирование данных для отправки
    $logData = @{
        firstName = $firstName
        lastName = $lastName
        activeDirectoryObjectGUID = $adGuid
        activeDirectoryLogin = $adUsername
        computerName = $computerName
        action = "userLogin"
        timeStamp = $timestamp
    }

    $jsonData = $logData | ConvertTo-Json -Compress
    Write-Log "Подготовлены данные для отправки"

    # Отправка данных через HTTP API
    $headers = @{
        "Content-Type" = "application/json"
        "X-API-Key" = $ApiKey
    }

    Write-Log "Отправка данных на $ApiUrl"

    $response = Invoke-RestMethod -Uri $ApiUrl -Method POST -Body $jsonData -Headers $headers -TimeoutSec 30 -ErrorAction Stop

    if ($response.success) {
        Write-Log "Успешно отправлен лог входа (ID: $($response.data.id))"
    } else {
        Write-Log "Сервер вернул ошибку: $($response.message)" "ERROR"
        exit 1
    }

} catch {
    $errorMessage = "Ошибка выполнения скрипта: $($_.Exception.Message)"
    Write-Log $errorMessage "ERROR"

    # Дополнительная информация об ошибке для отладки
    Write-Log "Детали ошибки: $($_.Exception.GetType().Name)" "ERROR"
    Write-Log "Строка ошибки: $($_.InvocationInfo.ScriptLineNumber)" "ERROR"

    exit 1
}

Write-Log "Скрипт выполнен успешно"
exit 0
