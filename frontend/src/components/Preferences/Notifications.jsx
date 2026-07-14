import { useState } from 'react';

import Row from 'react-bootstrap/Row';
import Col from 'react-bootstrap/Col';
import Form from 'react-bootstrap/Form';
import Alert from 'react-bootstrap/Alert';

const PrefsNotifications = (props) => {
    let { byTelegram, byEmail, personal } = props.prefs.notify;

    const [attemptsInterval, setAttemptsInterval] = useState(
        props.prefs.notify.global.attemptsInterval
    );
    const [attempts, setAttempts] = useState(
        props.prefs.notify.global.attempts
    );

    const [emailNotifyIsActive, setEmailNotifyIsActive] = useState(
        byEmail?.isActive
    );
    const [host, setHost] = useState(byEmail?.host);
    const [port, setPort] = useState(byEmail?.port);
    const [user, setUser] = useState(byEmail?.user);
    const [pass, setPass] = useState(byEmail?.pass);
    const [isSecure, setIsSecure] = useState(byEmail?.isSecure);

    const [sendFromName, setSendFromName] = useState(byEmail?.sendFromName);
    const [sendFromEmail, setSendFromEmail] = useState(byEmail?.sendFromEmail);

    const attemptsChangeHandler = (event) => {
        setAttempts(event.target.value);
        props.prefs.notify.global.attempts = event.target.value;
    };

    const attemptsIntervalChangeHandler = (event) => {
        setAttemptsInterval(event.target.value);
        props.prefs.notify.global.attemptsInterval = event.target.value;
    };

    const emailNotifyIsActiveHandler = () => {
        setEmailNotifyIsActive(!emailNotifyIsActive);
        byEmail.isActive = !emailNotifyIsActive;
    };

    const hostChangeHandler = (event) => {
        setHost(event.target.value);
        byEmail.host = event.target.value;
    };

    const isSecureHandler = () => {
        setIsSecure(!isSecure);
        byEmail.isSecure = !isSecure;
    };

    const portChangeHandler = (event) => {
        setPort(event.target.value);
        byEmail.port = ++event.target.value;
    };

    const userChangeHandler = (event) => {
        setUser(event.target.value);
        byEmail.user = event.target.value;
    };

    const passChangeHandler = (event) => {
        setPass(event.target.value);
        byEmail.pass = event.target.value;
    };

    const sendFromNameHandler = (event) => {
        setSendFromName(event.target.value);
        byEmail.sendFromName = event.target.value;
    };

    const sendFromEmailHandler = (event) => {
        setSendFromEmail(event.target.value);
        byEmail.sendFromEmail = event.target.value;
    };

    const [telegramNotifyIsActive, setTelegramNotifyIsActive] = useState(
        byTelegram?.isActive
    );

    const [telegramSendToGroup, setTelegramSendToGroup] = useState(
        byTelegram?.sendToGroup
    );

    const [telegramChatId, setTelegramChatId] = useState(byTelegram?.chatId);

    const [personalNotifications, setPersonalNotifications] = useState({
        newTicket: personal?.newTicket,
        respStateUpdate: personal?.respStateUpdate,
        ticketStateUpdate: personal?.ticketStateUpdate,
        ticketNewComment: personal?.ticketNewComment,
        scheduledWorks: personal?.scheduledWorks,
    });

    const personalNotificationsHandler = (event) => {
        setPersonalNotifications({
            ...personalNotifications,
            [event.target.name]: !personalNotifications[event.target.name],
        });
        props.prefs.notify.personal = {
            ...personalNotifications,
            [event.target.name]: !personalNotifications[event.target.name],
        };
    };

    const telegramNotifyIsActiveHandler = () => {
        setTelegramNotifyIsActive(!telegramNotifyIsActive);
        if (byTelegram) {
            byTelegram.isActive = !telegramNotifyIsActive;
        } else {
            byTelegram = {
                isActive: !telegramNotifyIsActive,
            };
        }
    };

    const telegramSendToGroupHandler = () => {
        setTelegramSendToGroup(!telegramSendToGroup);
        byTelegram.sendToGroup = !telegramSendToGroup;
    };

    const telegramChatIdChangeHandler = (event) => {
        setTelegramChatId(event.target.value);
        if (byTelegram) {
            byTelegram.chatId = event.target.value;
        } else {
            byTelegram = {
                isActive: telegramNotifyIsActive,
                chatId: telegramChatId,
            };
        }
    };

    // Табло статусов сотрудников: закреплённое сообщение, которое бот
    // редактирует. messageId/lastText — служебные поля бота, backend их
    // из этого POST игнорирует.
    const statusBoard = props.prefs.statusBoard ?? {};
    const [statusBoardIsActive, setStatusBoardIsActive] = useState(
        !!statusBoard.isActive
    );
    const [statusBoardChatId, setStatusBoardChatId] = useState(
        statusBoard.chatId ?? ''
    );
    const [statusBoardThreadId, setStatusBoardThreadId] = useState(
        statusBoard.messageThreadId ?? ''
    );

    const ensureStatusBoard = () => {
        if (!props.prefs.statusBoard) {
            props.prefs.statusBoard = {
                isActive: false,
                chatId: '',
                messageThreadId: '',
            };
        }
        return props.prefs.statusBoard;
    };

    const statusBoardIsActiveHandler = () => {
        setStatusBoardIsActive(!statusBoardIsActive);
        ensureStatusBoard().isActive = !statusBoardIsActive;
    };

    const statusBoardChatIdHandler = (event) => {
        setStatusBoardChatId(event.target.value);
        ensureStatusBoard().chatId = event.target.value;
    };

    const statusBoardThreadIdHandler = (event) => {
        setStatusBoardThreadId(event.target.value);
        ensureStatusBoard().messageThreadId = event.target.value;
    };

    return (
        <>
            <Row className='border-bottom mb-3'>
                <Col xs='auto'>
                    <h1 className='display-6 mb-3'>Общие</h1>
                    <h4 className='mb-3'>Персональные уведомления</h4>
                    {!telegramNotifyIsActive && !emailNotifyIsActive && (
                        <Form.Group>
                            <Alert variant='warning'>
                                Для отправки уведомлений, активируйте отправку
                                через e-mail или Telegram
                            </Alert>
                        </Form.Group>
                    )}
                    <Form.Group className='mb-3 w-100'>
                        <Form.Check
                            type='switch'
                            label='Новая заявка'
                            name='newTicket'
                            checked={personalNotifications.newTicket}
                            value={personalNotifications.newTicket}
                            onChange={personalNotificationsHandler}
                            disabled={
                                !telegramNotifyIsActive && !emailNotifyIsActive
                            }
                        />
                    </Form.Group>
                    <Form.Group className='mb-3 w-100'>
                        <Form.Check
                            type='switch'
                            label='Изменение статуса ответственного за заявку'
                            name='respStateUpdate'
                            checked={personalNotifications.respStateUpdate}
                            value={personalNotifications.respStateUpdate}
                            onChange={personalNotificationsHandler}
                            disabled={
                                !telegramNotifyIsActive && !emailNotifyIsActive
                            }
                        />
                    </Form.Group>
                    <Form.Group className='mb-3 w-100'>
                        <Form.Check
                            type='switch'
                            label='Изменение статуса заявки'
                            name='ticketStateUpdate'
                            checked={personalNotifications.ticketStateUpdate}
                            value={personalNotifications.ticketStateUpdate}
                            onChange={personalNotificationsHandler}
                            disabled={
                                !telegramNotifyIsActive && !emailNotifyIsActive
                            }
                        />
                    </Form.Group>
                    <Form.Group className='mb-3 w-100'>
                        <Form.Check
                            type='switch'
                            label='Новые комментарии к заявке'
                            name='ticketNewComment'
                            checked={personalNotifications.ticketNewComment}
                            value={personalNotifications.ticketNewComment}
                            onChange={personalNotificationsHandler}
                            disabled={
                                !telegramNotifyIsActive && !emailNotifyIsActive
                            }
                        />
                    </Form.Group>
                    <Form.Group className='mb-3 w-100'>
                        <Form.Check
                            type='switch'
                            label='Запланированные работы'
                            name='scheduledWorks'
                            checked={personalNotifications.scheduledWorks}
                            value={personalNotifications.scheduledWorks}
                            onChange={personalNotificationsHandler}
                            disabled={
                                !telegramNotifyIsActive && !emailNotifyIsActive
                            }
                        />
                    </Form.Group>
                    <h4 className='mb-3'>Поведение при ошибке отправки</h4>
                    <Form.Group className='mb-3 w-100'>
                        <Form.Label>
                            Число попыток для повторной отправки уведомлений в
                            случае ошибки
                        </Form.Label>
                        <Form.Control
                            required
                            type='number'
                            value={attempts}
                            onChange={attemptsChangeHandler}
                        />
                    </Form.Group>
                    <Form.Group className='mb-3 w-100'>
                        <Form.Label>Интервал между попытками, мин</Form.Label>
                        <Form.Control
                            required
                            type='number'
                            value={attemptsInterval}
                            onChange={attemptsIntervalChangeHandler}
                        />
                    </Form.Group>
                </Col>
            </Row>
            <Row className='border-bottom mb-3'>
                <Col sm='auto'>
                    <h1 className='display-6 mb-3'>E-mail</h1>
                    <Form.Group className='mb-3 w-100'>
                        <Form.Check
                            type='switch'
                            label='Отправлять почтовые уведомления'
                            checked={emailNotifyIsActive}
                            value={emailNotifyIsActive}
                            onChange={emailNotifyIsActiveHandler}
                        />
                    </Form.Group>
                    <Form.Group className='mb-3 w-100'>
                        <Form.Label>SMTP-сервер</Form.Label>
                        <Form.Control
                            disabled={!emailNotifyIsActive}
                            required
                            type='text'
                            value={host}
                            onChange={hostChangeHandler}
                        />
                    </Form.Group>
                    <Form.Group className='mb-3 w-100'>
                        <Form.Check
                            type='switch'
                            label='SSL/TLS шифрование'
                            disabled={!emailNotifyIsActive}
                            checked={isSecure}
                            value={isSecure}
                            onChange={isSecureHandler}
                        />
                    </Form.Group>
                    <Form.Group className='mb-3 w-100'>
                        <Form.Label>Порт</Form.Label>
                        <Form.Control
                            disabled={!emailNotifyIsActive}
                            required
                            type='text'
                            value={port}
                            onChange={portChangeHandler}
                        />
                    </Form.Group>
                    <Form.Group className='mb-3 w-100'>
                        <Form.Label>Имя пользователя</Form.Label>
                        <Form.Control
                            disabled={!emailNotifyIsActive}
                            required
                            type='text'
                            value={user}
                            onChange={userChangeHandler}
                        />
                    </Form.Group>
                    <Form.Group className='mb-3 w-100'>
                        <Form.Label>Пароль</Form.Label>
                        <Form.Control
                            disabled={!emailNotifyIsActive}
                            required
                            type='password'
                            value={pass}
                            onChange={passChangeHandler}
                        />
                    </Form.Group>
                    <Form.Group className='mb-3 w-100'>
                        <Form.Label>Имя отправителя</Form.Label>
                        <Form.Control
                            disabled={!emailNotifyIsActive}
                            required
                            type='text'
                            value={sendFromName}
                            onChange={sendFromNameHandler}
                        />
                    </Form.Group>
                    <Form.Group className='mb-3 w-100'>
                        <Form.Label>Email отправителя</Form.Label>
                        <Form.Control
                            disabled={!emailNotifyIsActive}
                            required
                            type='email'
                            value={sendFromEmail}
                            onChange={sendFromEmailHandler}
                        />
                    </Form.Group>
                </Col>
            </Row>
            <Row>
                <Col xs='6'>
                    <h1 className='display-6 mb-3'>Telegram</h1>
                    <Form.Group className='mb-3 w-100'>
                        <Form.Check
                            type='switch'
                            label='Отправлять Telegram-уведомления'
                            checked={telegramNotifyIsActive}
                            value={telegramNotifyIsActive}
                            onChange={telegramNotifyIsActiveHandler}
                        />
                    </Form.Group>
                    <h4 className='mb-3'>Групповые уведомления</h4>
                    <Form.Group className='mb-3 w-100'>
                        <Form.Check
                            type='switch'
                            label='Отправлять уведомления в группу'
                            checked={telegramSendToGroup}
                            value={telegramSendToGroup}
                            onChange={telegramSendToGroupHandler}
                            disabled={!telegramNotifyIsActive}
                        />
                    </Form.Group>
                    <Form.Group className='mb-3 w-100'>
                        <Form.Label>Chat ID</Form.Label>
                        <Form.Control
                            disabled={
                                !telegramSendToGroup || !telegramNotifyIsActive
                            }
                            required
                            type='text'
                            value={telegramChatId}
                            onChange={telegramChatIdChangeHandler}
                        />
                    </Form.Group>
                    <Form.Group>
                        <Alert variant='light'>
                            Добавьте в группу бот{' '}
                            <a
                                href={`https://t.me/${import.meta.env.VITE_TG_BOT_NAME}`}
                            >
                                @{import.meta.env.VITE_TG_BOT_NAME}
                            </a>
                            , запустите его и скопируйте полученный ID чата в
                            поле выше.
                        </Alert>
                    </Form.Group>
                    <h4 className='mb-3'>Табло статусов сотрудников</h4>
                    <Form.Group className='mb-3 w-100'>
                        <Form.Check
                            type='switch'
                            label='Публиковать закреплённое табло статусов'
                            checked={statusBoardIsActive}
                            value={statusBoardIsActive}
                            onChange={statusBoardIsActiveHandler}
                        />
                    </Form.Group>
                    <Form.Group className='mb-3 w-100'>
                        <Form.Label>Chat ID группы табло</Form.Label>
                        <Form.Control
                            disabled={!statusBoardIsActive}
                            type='text'
                            value={statusBoardChatId}
                            placeholder='Пусто — группа уведомлений выше'
                            onChange={statusBoardChatIdHandler}
                        />
                    </Form.Group>
                    <Form.Group className='mb-3 w-100'>
                        <Form.Label>ID ветки (топика)</Form.Label>
                        <Form.Control
                            disabled={!statusBoardIsActive}
                            type='text'
                            value={statusBoardThreadId}
                            placeholder='Пусто — General или группа без веток'
                            onChange={statusBoardThreadIdHandler}
                        />
                    </Form.Group>
                    <Form.Group>
                        <Alert variant='light'>
                            Проще всего: добавьте бота в группу с правами
                            администратора (включая «Закрепление сообщений») и
                            отправьте команду <code>/status_board</code> в
                            нужной ветке — ID чата и ветки заполнятся
                            автоматически, табло появится и закрепится там же.
                            Если вы только что выполнили команду, обновите эту
                            страницу перед сохранением настроек. Ночью статусы,
                            кроме «отпуск» и «болею», сбрасываются на «не
                            указан».
                        </Alert>
                    </Form.Group>
                </Col>
            </Row>
        </>
    );
};

export default PrefsNotifications;
